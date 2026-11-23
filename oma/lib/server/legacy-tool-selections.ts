/** Copies selected toolkits from the legacy SQLite schema before removing its selection table. */

import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { getDb, legacyToolSelectionsSchemaVersion, sqliteSchemaVersion, writeTransaction } from "../db";
import { validToolkitSlug } from "../tool-catalog";

type LegacyRow = {
  user_id: string;
  playbook_id: string;
  agent_id: string;
  toolkit_slug: string;
};

export type LegacyToolSelections = { migrationId: string; workspace: string[]; campaigns: Record<string, string[]> };

const campaignIdPattern = /^[a-z0-9]+(?:[-_][a-z0-9]+|__[a-z0-9]+)*$/;
const legacySpecialists = new Set(["researcher", "writer", "humanizer", "verifier", "publisher"]);
const processScope = globalThis as typeof globalThis & { omaToolSelectionMigration?: Promise<void> };

function legacyRows(db: DatabaseSync): LegacyRow[] | undefined {
  if (db.prepare("PRAGMA user_version").get()?.user_version !== legacyToolSelectionsSchemaVersion) return;
  const exists = db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'tool_assignments'").get();
  if (!exists) return [];

  return db.prepare(`
    SELECT user_id, playbook_id, agent_id, toolkit_slug FROM tool_assignments
    ORDER BY user_id, playbook_id, agent_id, toolkit_slug
  `).all() as LegacyRow[];
}

function digest(rows: LegacyRow[]): string {
  const tuples = rows.map(({ user_id, playbook_id, agent_id, toolkit_slug }) => [user_id, playbook_id, agent_id, toolkit_slug]);
  return createHash("sha256").update(JSON.stringify(tuples)).digest("hex");
}

function buildImport(rows: LegacyRow[], migrationId: string): LegacyToolSelections {
  const workspace = new Set<string>();
  const campaigns = new Map<string, Set<string>>();

  for (const { playbook_id: campaignId, agent_id: scope, toolkit_slug: slug } of rows) {
    if (!validToolkitSlug(slug)) throw new Error("A legacy tool selection has an invalid toolkit. The SQLite table was kept.");

    if (campaignId === "workspace" && scope === "connections") {
      workspace.add(slug);
      continue;
    }

    if (campaignId.length > 64 || !campaignIdPattern.test(campaignId) ||
        (scope !== "campaign" && !(campaignId === "seo" && legacySpecialists.has(scope)))) {
      throw new Error("A legacy tool selection has an invalid scope. The SQLite table was kept.");
    }

    const tools = campaigns.get(campaignId) ?? new Set<string>();
    tools.add(slug);
    campaigns.set(campaignId, tools);
  }

  return { migrationId, workspace: [...workspace], campaigns: Object.fromEntries(
    [...campaigns].map(([campaignId, tools]) => [campaignId, [...tools]]),
  ) };
}

async function migrate(importSelections: (data: LegacyToolSelections) => Promise<void>): Promise<void> {
  const db = getDb();
  if (db.prepare("PRAGMA user_version").get()?.user_version !== legacyToolSelectionsSchemaVersion) return;
  const rows = writeTransaction(db, () => legacyRows(db));
  if (!rows) return;

  const migrationId = digest(rows);
  if (rows.length) {
    // The workspace persists a receipt for this snapshot, so a lost response can be retried safely.
    await importSelections(buildImport(rows, migrationId));
  }

  writeTransaction(db, () => {
    const latest = legacyRows(db);
    if (!latest) return;
    if (digest(latest) !== migrationId) {
      throw new Error("Legacy tool selections changed during import. Retry to complete the migration.");
    }
    db.exec(`DROP TABLE IF EXISTS tool_assignments; PRAGMA user_version = ${sqliteSchemaVersion};`);
  });
}

/** Import the legacy snapshot and retire the table only after a successful workspace acknowledgement. */
export function migrateLegacyToolSelections(importSelections: (data: LegacyToolSelections) => Promise<void>): Promise<void> {
  processScope.omaToolSelectionMigration ??= migrate(importSelections).finally(() => {
    delete processScope.omaToolSelectionMigration;
  });
  return processScope.omaToolSelectionMigration;
}
