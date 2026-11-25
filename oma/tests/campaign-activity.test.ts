/** Verifies the console binds native activity reads to the authenticated user's campaign chat scope. */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { getDb } from "../lib/db";
import { campaignActivityQuery, readCampaignActivity } from "../lib/server/campaign-activity";

const campaign = "fixture";
const user = "00000000-0000-4000-8000-000000000001";
const oldSession = "00000000-0000-4000-8000-000000000002";
const differentSession = "00000000-0000-4000-8000-000000000003";

const hash = (id: string) => createHash("sha256").update(JSON.stringify([user, id])).digest("hex").slice(0, 32);

test("validates activity query shapes and rejects caller-supplied ownership", () => {
  assert.deepEqual(campaignActivityQuery.parse({}), { offset: 0 });
  assert.deepEqual(campaignActivityQuery.parse({ category: "worker", agent: "fixture__writer", offset: "30" }),
    { category: "worker", agent: "fixture__writer", offset: 30 });
  for (const query of [
    { legacySessions: [differentSession] }, { offset: "-1" }, { agent: "../other" },
    { kind: "session", ref: "a", profile: "default", view: "message" },
    { kind: "task-log", ref: "a", profile: "", view: "message", message: "1" },
  ]) assert.equal(campaignActivityQuery.safeParse(query).success, false);
});

test("reads the selected campaign over the workspace socket and strips upstream-only fields", async (t) => {
  const folder = await mkdtemp(join(tmpdir(), "oma-agent-feed-"));
  const socket = join(folder, "ws");
  const environment = { OMA_WORKSPACE_SOCKET: socket, OMA_DATA_DIR: folder };
  const previous = Object.entries(environment).map(([name]) => [name, process.env[name]] as const);
  const processScope = globalThis as typeof globalThis & { omaDatabase?: DatabaseSync };
  let input: unknown;
  const server = createServer(async (request, response) => {
    const body = [];
    for await (const chunk of request) body.push(chunk);
    input = JSON.parse(Buffer.concat(body).toString("utf8"));
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/workspace/campaigns/fixture/activity");
    const result = "kind" in (input as object) ? { text: "Run output", nextOffset: null, rawPath: "private" }
      : { entries: [], nextOffset: null, partial: true, rawPath: "private" };
    response.end(JSON.stringify(result));
  });
  t.after(async () => {
    processScope.omaDatabase?.close();
    delete processScope.omaDatabase;
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(folder, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(socket, resolve));
  Object.assign(process.env, environment);
  const db = getDb();
  db.exec("CREATE TABLE chat_threads (id TEXT NOT NULL, user_id TEXT NOT NULL, campaign_id TEXT, session_id TEXT NOT NULL)");
  const add = db.prepare("INSERT INTO chat_threads VALUES (?, ?, ?, ?)");
  add.run(oldSession, user, campaign, oldSession);
  add.run(differentSession, user, "other", differentSession);
  add.run(differentSession, "different-user", campaign, differentSession);

  assert.deepEqual(await readCampaignActivity(user, campaign, campaignActivityQuery.parse({})), {
    entries: [], nextOffset: null, partial: true,
  });
  assert.deepEqual(input, { offset: 0, chatPrefix: `oma_${hash(campaign)}_`, legacySessions: [oldSession] });
  assert.deepEqual(await readCampaignActivity(user, campaign,
    campaignActivityQuery.parse({ kind: "task-log", profile: "", ref: "t_fixture.log", offset: "24000" })),
  { text: "Run output", nextOffset: null });
  assert.deepEqual(input, { kind: "task-log", profile: "", ref: "t_fixture.log", offset: 24000,
    chatPrefix: `oma_${hash(campaign)}_`, legacySessions: [oldSession] });
});
