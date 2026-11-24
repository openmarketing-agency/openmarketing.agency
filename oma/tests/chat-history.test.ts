/** Verifies Hermes transcript authority, scope isolation, and read-only compatibility with old chat links. */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { getDb } from "../lib/db";
import { loadChatHistory, loadOlderChatMessages, sendNativeChatTurn } from "../lib/server/chat-history";

test("Hermes supplies history and owns new conversations while retired SQLite links stay read-only", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "oma-native-chat-"));
  const environment = {
    OMA_DATA_DIR: directory, OMA_AGENT_URL: "http://vm:8642/p/specialist/v1",
    OMA_AGENT_API_KEY: "fixture-gateway-key", OMA_WORKSPACE_SOCKET: join(directory, "workspace.sock"),
  };
  const previous = Object.entries(environment).map(([name]) => [name, process.env[name]] as const);
  Object.assign(process.env, environment);
  const workspace = createServer((request, response) => {
    assert.equal(request.url, "/workspace");
    response.end(JSON.stringify({
      skipped: 0, brands: [], playbooks: [], agents: [],
      campaigns: ["launch", "reviews"].map((id) => ({
        id, name: id, description: "", playbookId: "", version: "", orchestrator: "",
        agentIds: [], goals: [], plans: [], board: "",
      })),
    }));
  });
  const processScope = globalThis as typeof globalThis & { omaDatabase?: DatabaseSync };
  t.after(async () => {
    processScope.omaDatabase?.close();
    delete processScope.omaDatabase;
    if (workspace.listening) await new Promise<void>((resolve) => workspace.close(() => resolve()));
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => workspace.once("error", reject).listen(environment.OMA_WORKSPACE_SOCKET, resolve));

  const db = getDb();
  const owner = "chat-owner";
  assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE name IN ('chat_threads', 'chat_turns')").all().length, 0);
  // The previous implementation recorded these links. Its transcript rows must never be read again.
  db.exec(`
    CREATE TABLE chat_threads (id TEXT, user_id TEXT, campaign_id TEXT, session_id TEXT);
    CREATE TABLE chat_turns (message TEXT);
    INSERT INTO chat_turns VALUES ('Stale console copy');
    PRAGMA user_version = 6;
  `);
  const oldThread = randomUUID();
  const oldSession = randomUUID();
  db.prepare("INSERT INTO chat_threads VALUES (?, ?, ?, ?)").run(oldThread, owner, "launch", oldSession);
  db.close();
  delete processScope.omaDatabase;
  const reopened = getDb();

  const saved = new Map<string, { title: string; text: string }>([
    [oldSession, { title: "Legacy launch", text: "Agent-owned older answer" }],
    [randomUUID(), { title: "Unrelated session", text: "Private" }],
  ]);
  const requests: Array<{ endpoint: string; session?: string; turnId?: string | null }> = [];
  t.mock.method(globalThis, "fetch", async (url: string, request: RequestInit) => {
    assert.ok(url.startsWith("http://vm:8642/p/default/"));
    assert.equal(new Headers(request.headers).get("Authorization"), "Bearer fixture-gateway-key");
    const endpoint = new URL(url);
    if (endpoint.pathname.endsWith("/v1/runs")) {
      const { session_id, input } = JSON.parse(String(request.body));
      requests.push({ endpoint: "new run", session: session_id, turnId: new Headers(request.headers).get("Idempotency-Key") });
      saved.set(session_id, { title: "Latest " + session_id.slice(-6), text: input });
      return Response.json({ run_id: "run_fixture" }, { status: 202 });
    }
    if (endpoint.pathname.endsWith("/api/sessions")) {
      const offset = endpoint.searchParams.get("offset");
      assert.equal(endpoint.searchParams.get("source"), "api_server");
      requests.push({ endpoint: "sessions " + offset });
      const entries = Array.from(saved, ([id, { title }]) => ({ id, title }));
      return Response.json({ data: offset === "0" ? entries.slice(0, 2) : entries.slice(2), has_more: offset === "0" });
    }
    assert.match(endpoint.pathname, /\/api\/sessions\/[^/]+\/messages$/);
    assert.equal(endpoint.searchParams.get("order"), "latest");
    assert.equal(endpoint.searchParams.get("include_compacted"), "true");
    const session = endpoint.pathname.split("/").at(-2)!;
    requests.push({ endpoint: "transcript", session });
    const entry = saved.get(session);
    if (!entry) return Response.json({}, { status: 404 });
    const data = [
      { id: 1, role: "user", content: entry.text },
      ...(entry.text.startsWith("Current launch") ? [{
        id: 5, role: "user", display_kind: "steer", content: "[Native steering wrapper]",
        display_content: "Focus on replies\n\nCampaign ID: launch",
      }] : []),
      { id: 2, role: "assistant", content: "Agent answer fixture-gateway-key", reasoning: "Private reasoning" },
      { id: 3, role: "assistant", content: "Private prompt", display_kind: "hidden" },
      { id: 4, role: "tool", content: "Private tool output" },
    ];
    return Response.json({ data });
  });

  const threadId = randomUUID();
  const turnId = randomUUID();
  await sendNativeChatTurn(owner, { threadId, turnId, message: "Current launch", campaignId: "launch" });
  await sendNativeChatTurn(owner, { threadId, turnId, message: "Current launch", campaignId: "launch" });
  assert.deepEqual(requests[0], requests[1]);
  assert.match(requests[0].session ?? "", /^oma_[a-f0-9]{32}_/);
  await sendNativeChatTurn(owner, { threadId, turnId: randomUUID(), message: "Workspace message" });
  assert.notEqual(requests[0].session, requests[2].session);
  const launch = await loadChatHistory(owner, "launch", threadId);
  assert.deepEqual(launch.chats.map(({ id }) => id), [oldThread, threadId]);
  assert.deepEqual(launch.active?.messages.map(({ text }) => text), ["Current launch", "Focus on replies", "Agent answer [redacted]"]);
  assert.ok(requests.some(({ endpoint }) => endpoint === "sessions 200"));
  assert.deepEqual((await loadChatHistory(owner)).chats.map(({ id }) => id), [threadId]);
  assert.deepEqual((await loadChatHistory(owner, "reviews", threadId)).active?.messages, []);
  assert.deepEqual((await loadChatHistory("another-account", "launch", threadId)).chats, []);

  const older = await loadOlderChatMessages(owner, oldThread, 0, "launch");
  assert.equal(older.messages[0].text, "Agent-owned older answer");
  assert.deepEqual((await loadOlderChatMessages(owner, oldThread, 0)).messages, []);
  assert.equal(reopened.prepare("SELECT count(*) AS count FROM chat_threads").get()?.count, 1);
  assert.equal(reopened.prepare("SELECT message FROM chat_turns").get()?.message, "Stale console copy");
});
