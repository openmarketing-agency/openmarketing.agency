/** Verifies that SQLite retires saved selections only after a confirmed workspace import. */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";

import { getDb } from "../lib/db";
import { migrateLegacyToolSelections, type LegacyToolSelections } from "../lib/server/legacy-tool-selections";

const owner = "85a44d44-317d-4790-aa12-7b542a144284";
const processScope = globalThis as typeof globalThis & { omaDatabase?: DatabaseSync };

function database(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "oma-tool-selections-"));
  const previous = process.env.OMA_DATA_DIR;
  process.env.OMA_DATA_DIR = directory;
  t.after(() => {
    processScope.omaDatabase?.close();
    delete processScope.omaDatabase;
    if (previous === undefined) delete process.env.OMA_DATA_DIR;
    else process.env.OMA_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  });
  return { path: join(directory, "oma.sqlite"), db: getDb() };
}

function legacyDatabase(t: TestContext) {
  const { db, path } = database(t);
  db.exec(`
    CREATE TABLE tool_assignments (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      playbook_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      toolkit_slug TEXT NOT NULL,
      PRIMARY KEY (user_id, playbook_id, agent_id, toolkit_slug)
    ) STRICT;
    PRAGMA user_version = 3;
  `);
  db.prepare("INSERT INTO users (id, email, hashed_password) VALUES (?, ?, ?)").run(owner, "test@example.test", "fixture-hash");
  db.close();
  delete processScope.omaDatabase;
  return { path, db: getDb() };
}

function version(db: DatabaseSync) {
  return db.prepare("PRAGMA user_version").get()?.user_version;
}

function hasLegacyTable(db: DatabaseSync) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'tool_assignments'").get());
}

test("fresh SQLite installs use version 5 without a selection table", async (t) => {
  const { db } = database(t);
  const importSelections = t.mock.fn(async () => {});
  await migrateLegacyToolSelections(importSelections);
  assert.equal(version(db), 5);
  assert.equal(hasLegacyTable(db), false);
  assert.equal(importSelections.mock.callCount(), 0);
});

test("upgrades a version 4 account and leaves its agent setup pending", (t) => {
  const { db } = database(t);
  db.exec("ALTER TABLE users DROP COLUMN agent_setup_complete; PRAGMA user_version = 4;");
  db.prepare("INSERT INTO users (id, email, hashed_password) VALUES (?, ?, ?)").run(owner, "test@example.test", "fixture-hash");
  db.close();
  delete processScope.omaDatabase;

  const upgraded = getDb();
  assert.equal(version(upgraded), 5);
  assert.deepEqual({ ...upgraded.prepare("SELECT id, agent_setup_complete FROM users").get() }, {
    id: owner, agent_setup_complete: 0,
  });
});

test("retires an empty version 3 table without reaching the workspace", async (t) => {
  const { db } = legacyDatabase(t);
  assert.equal(version(db), 3);
  assert.equal(hasLegacyTable(db), true);
  await migrateLegacyToolSelections(async () => assert.fail("Empty SQLite selections do not need an import"));
  assert.equal(version(db), 5);
  assert.equal(hasLegacyTable(db), false);
  assert.equal(db.prepare("SELECT id FROM users").get()?.id, owner);
});

test("upgrades version 3 when its legacy table is already absent", async (t) => {
  const { db } = legacyDatabase(t);
  db.exec("DROP TABLE tool_assignments");
  await migrateLegacyToolSelections(async () => assert.fail("There are no selections to import"));
  assert.equal(version(db), 5);
});

test("merges saved campaign and specialist selections and preserves account data", async (t) => {
  const { db } = legacyDatabase(t);
  const insert = db.prepare("INSERT INTO tool_assignments VALUES (?, ?, ?, ?)");
  insert.run(owner, "workspace", "connections", "notion");
  insert.run(owner, "seo", "campaign", "googleanalytics");
  insert.run(owner, "seo", "researcher", "googleanalytics");
  insert.run(owner, "seo", "writer", "notion");
  insert.run(owner, "no-longer-listed", "campaign", "slack");
  db.prepare(`INSERT INTO mcp_integrations
    (id, user_id, name, url, transport, is_enabled, auth_type, created_at, updated_at)
    VALUES ('fixture', ?, 'Fixture', 'https://example.test/mcp', 'streamable_http', 1, 'none', 0, 0)`
  ).run(owner);

  const importSelections = t.mock.fn(async (payload: LegacyToolSelections) => {
    assert.equal(version(db), 3);
    assert.equal(hasLegacyTable(db), true);
    assert.match(payload.migrationId, /^[a-f0-9]{64}$/);
    assert.deepEqual(payload.workspace, ["notion"]);
    assert.deepEqual(payload.campaigns, { "no-longer-listed": ["slack"], seo: ["googleanalytics", "notion"] });
  });
  await migrateLegacyToolSelections(importSelections);
  await migrateLegacyToolSelections(importSelections);
  assert.equal(importSelections.mock.callCount(), 1);
  assert.equal(version(db), 5);
  assert.equal(hasLegacyTable(db), false);
  assert.equal(db.prepare("SELECT email FROM users WHERE id = ?").get(owner)?.email, "test@example.test");
  assert.equal(db.prepare("SELECT id FROM mcp_integrations WHERE user_id = ?").get(owner)?.id, "fixture");
});

test("keeps the old table after a refused import and retries the same snapshot", async (t) => {
  const { db } = legacyDatabase(t);
  db.prepare("INSERT INTO tool_assignments VALUES (?, ?, ?, ?)").run(owner, "seo", "researcher", "slack");
  let firstId: string | undefined;
  await assert.rejects(migrateLegacyToolSelections(async ({ migrationId }) => {
    firstId = migrationId;
    throw new Error("The workspace could not confirm the import");
  }), /could not confirm/);
  assert.equal(version(db), 3);
  assert.equal(hasLegacyTable(db), true);
  await migrateLegacyToolSelections(async ({ migrationId }) => assert.equal(migrationId, firstId));
  assert.equal(version(db), 5);
  assert.equal(hasLegacyTable(db), false);
});

test("shares pending work and keeps changed rows written from a separate SQLite connection", async (t) => {
  const { db, path } = legacyDatabase(t);
  db.prepare("INSERT INTO tool_assignments VALUES (?, ?, ?, ?)").run(owner, "seo", "campaign", "slack");
  const { promise, resolve } = Promise.withResolvers<void>();
  const importSelections = t.mock.fn(() => promise);
  const first = migrateLegacyToolSelections(importSelections);
  const second = migrateLegacyToolSelections(importSelections);
  assert.equal(first, second);
  assert.equal(importSelections.mock.callCount(), 1);

  const writer = new DatabaseSync(path);
  try {
    writer.prepare("INSERT INTO tool_assignments VALUES (?, ?, ?, ?)").run(owner, "seo", "campaign", "notion");
  } finally {
    writer.close();
    resolve();
  }

  await assert.rejects(first, /changed during import/);
  assert.equal(version(db), 3);
  assert.equal(db.prepare("SELECT count(*) AS count FROM tool_assignments").get()?.count, 2);
  await migrateLegacyToolSelections(async ({ campaigns }) => assert.deepEqual(campaigns.seo, ["notion", "slack"]));
  assert.equal(version(db), 5);
});

test("accepts a concurrent completion from a separate SQLite connection", async (t) => {
  const { db, path } = legacyDatabase(t);
  db.prepare("INSERT INTO tool_assignments VALUES (?, ?, ?, ?)").run(owner, "seo", "campaign", "slack");

  await migrateLegacyToolSelections(async () => {
    const other = new DatabaseSync(path);
    try {
      // Completion by another console after acknowledging the same workspace receipt.
      other.exec("BEGIN IMMEDIATE; DROP TABLE tool_assignments; PRAGMA user_version = 5; COMMIT");
    } finally {
      other.close();
    }
  });
  assert.equal(version(db), 5);
  assert.equal(hasLegacyTable(db), false);
});

test("keeps invalid legacy selections for recovery", async (t) => {
  const { db } = legacyDatabase(t);
  db.prepare("INSERT INTO tool_assignments VALUES (?, ?, ?, ?)").run(owner, "seo", "unknown-scope", "notion");
  const importSelections = t.mock.fn(async () => {});
  await assert.rejects(migrateLegacyToolSelections(importSelections), /invalid scope/);
  assert.equal(version(db), 3);
  assert.equal(hasLegacyTable(db), true);
  assert.equal(importSelections.mock.callCount(), 0);
});
