/** Opens the installation's SQLite database and migrates local identity and integration storage. */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const processScope = globalThis as typeof globalThis & { omaDatabase?: DatabaseSync };

export const sqliteSchemaVersion = 8;
export const legacyToolSelectionsSchemaVersion = 3;

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

function createAnalyticsTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_analytics (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scope TEXT NOT NULL CHECK (scope IN ('campaigns', 'playbooks')),
      target_id TEXT NOT NULL,
      layout TEXT CHECK (layout IS NULL OR json_valid(layout)),
      generated_at INTEGER,
      attempt TEXT,
      lease_until INTEGER,
      PRIMARY KEY (user_id, scope, target_id)
    ) STRICT;
  `);
}

function initializeSchema(db: DatabaseSync): void {
  writeTransaction(db, () => {
    const version = db.prepare("PRAGMA user_version").get()?.user_version;
    if (version === sqliteSchemaVersion) return;
    if (version === 5 || version === 6 || version === 7) {
      // Existing transcript copies are left intact. Only legacy session IDs are used to reopen chats.
      createAnalyticsTable(db);
      db.exec(`PRAGMA user_version = ${sqliteSchemaVersion}`);
      return;
    }
    if (version === 4 || version === legacyToolSelectionsSchemaVersion) {
      if (!db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = 'agent_setup_complete'").get()) {
        db.exec("ALTER TABLE users ADD COLUMN agent_setup_complete INTEGER NOT NULL DEFAULT 0 CHECK (agent_setup_complete IN (0, 1))");
      }
      createAnalyticsTable(db);
      // Keep version 3 until the workspace acknowledges the legacy tool selection import.
      if (version === 4) db.exec(`PRAGMA user_version = ${sqliteSchemaVersion}`);
      return;
    }
    if (version !== 0) throw new Error("This SQLite database uses a different schema. Start OMA with a fresh data directory.");

    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY NOT NULL,
        slot INTEGER NOT NULL DEFAULT 1 UNIQUE CHECK (slot = 1),
        email TEXT NOT NULL,
        hashed_password TEXT NOT NULL,
        session_version INTEGER NOT NULL DEFAULT 0,
        agent_setup_complete INTEGER NOT NULL DEFAULT 0 CHECK (agent_setup_complete IN (0, 1)),
        onboarding_state TEXT CHECK (onboarding_state IS NULL OR json_valid(onboarding_state))
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
    `);
    createAnalyticsTable(db);
    db.exec(`PRAGMA user_version = ${sqliteSchemaVersion}`);
  });
}

export function getDb(): DatabaseSync {
  if (processScope.omaDatabase) return processScope.omaDatabase;

  const directory = process.env.OMA_DATA_DIR || "data";
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(directory, "oma.sqlite"), { timeout: 5000, enableForeignKeyConstraints: true });

  try {
    initializeSchema(db);
    db.exec("PRAGMA journal_mode = WAL");
  } catch (error) {
    db.close();
    throw error;
  }
  return processScope.omaDatabase = db;
}
