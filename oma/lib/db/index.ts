/** Opens the installation's SQLite database and applies schema changes before serving requests. */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const processScope = globalThis as typeof globalThis & { omaDatabase?: DatabaseSync };

export function writeTransaction<T>(db: DatabaseSync, write: () => T): T {
  // Acquire the write lock before reading anything that influences the update.
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = write();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function migrate(db: DatabaseSync): void {
  writeTransaction(db, () => {
    const version = db.prepare("PRAGMA user_version").get()?.user_version;
    if (version === 3) return;
    if (version !== 0 && version !== 1 && version !== 2) throw new Error("This SQLite database requires a newer version of OMA.");

    if (version === 0) db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY NOT NULL,
        slot INTEGER NOT NULL DEFAULT 1 UNIQUE CHECK (slot = 1),
        email TEXT NOT NULL,
        hashed_password TEXT NOT NULL,
        session_version INTEGER NOT NULL DEFAULT 0
      ) STRICT;

      CREATE TABLE refresh_tokens (
        jti TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER,
        replaced_by_jti TEXT
      ) STRICT;
      CREATE INDEX refresh_tokens_expiry ON refresh_tokens(expires_at);

      CREATE TABLE mcp_integrations (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        transport TEXT NOT NULL,
        is_enabled INTEGER NOT NULL CHECK (is_enabled IN (0, 1)),
        auth_type TEXT NOT NULL,
        auth_credentials_encrypted TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (user_id, url)
      ) STRICT;

      CREATE TABLE tool_assignments (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        playbook_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        toolkit_slug TEXT NOT NULL,
        PRIMARY KEY (user_id, playbook_id, agent_id, toolkit_slug)
      ) STRICT;

    `);
    if (version !== 2) db.exec(`
      CREATE TABLE marketing_workspaces (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        onboarding TEXT NOT NULL,
        campaign TEXT,
        next_at INTEGER,
        lease_until INTEGER NOT NULL DEFAULT 0,
        lease_token TEXT
      ) STRICT;
    `);
    if (version === 2) {
      db.exec(`
        UPDATE marketing_workspaces SET onboarding = json_remove(onboarding, '$.pending')
        WHERE json_extract(onboarding, '$.pending.kind') = 'finalize';

        UPDATE marketing_workspaces
        SET campaign = json_set(campaign, '$.report.outputs', json_array(
              json_object('role', 'Writer', 'text', json_extract(campaign, '$.report.draft')),
              json_object('role', 'Verifier', 'text', json_extract(campaign, '$.report.review'))
            ), '$.report.sources', json_array(json_object(
              'toolkit', 'google_search_console', 'resource', json_extract(campaign, '$.report.property')
            )))
        WHERE json_type(campaign, '$.report') = 'object';
      `);
      db.prepare(`
        UPDATE marketing_workspaces
        SET campaign = json_remove(json_set(campaign,
            '$.brief.playbook.steps', json(?),
            '$.brief.playbook.sources', json_array(json_object(
              'toolkit', 'google_search_console', 'resource', json_extract(campaign, '$.brief.playbook.property')
            )),
            '$.status', CASE WHEN json_extract(campaign, '$.status') = 'paused' THEN 'paused' ELSE 'waiting' END
          ), '$.brief.playbook.property', '$.report.property', '$.report.draft', '$.report.review', '$.work', '$.notice'),
          next_at = CASE WHEN json_extract(campaign, '$.status') = 'paused' THEN NULL ELSE ? END,
          lease_until = 0, lease_token = NULL
        WHERE json_type(campaign, '$.brief.playbook.property') = 'text'
      `).run(JSON.stringify([
        { profile: "oma-campaign-researcher", role: "Researcher", task: "Identify SEO opportunities from Search Console evidence." },
        { profile: "oma-campaign-creator", role: "Writer", task: "Use the research and brand brief to produce an actionable draft." },
        { profile: "oma-campaign-reviewer", role: "Verifier", task: "Check the draft against the evidence and recommend revisions." },
      ]), Date.now());
    }
    db.exec("PRAGMA user_version = 3");
  });
}

export function getDb(): DatabaseSync {
  if (processScope.omaDatabase) return processScope.omaDatabase;

  const directory = process.env.OMA_DATA_DIR || "data";
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(directory, "oma.sqlite"), { timeout: 5000, enableForeignKeyConstraints: true });

  try {
    db.exec("PRAGMA journal_mode = WAL");
    migrate(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return processScope.omaDatabase = db;
}
