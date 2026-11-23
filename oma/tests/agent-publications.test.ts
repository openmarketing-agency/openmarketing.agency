/** Verifies publication previews and exact-revision approvals against the v0.1.20 workspace contract. */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { approveCampaignPublication, listCampaignPublications } from "../lib/server/agent-publications";

test("projects native drafts and submits the displayed revision with the operator ID", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "oma-publication-"));
  const socket = join(directory, "workspace.sock");
  const original = process.env.OMA_WORKSPACE_SOCKET;
  const id = "a".repeat(32);
  const base = "/workspace/campaigns/demo/publications";
  const draft = {
    id, revision: 2, status: "pending_approval", platform: "x", kind: "reply",
    account: { id: "test-account", name: "Fixture" },
    content: { text: "Exact text", media: [{ asset_id: "asset", kind: "image", alt_text: "Dark clouds" }] },
    target: { id: "response-to", author_handle: "@reader", text: "Original post" },
  };
  const calls: Array<{ method?: string; path?: string; body?: unknown }> = [];
  const server = createServer(async (request, response) => {
    if (request.method === "GET") {
      calls.push({ method: request.method, path: request.url });
      response.end(JSON.stringify({ campaign_id: "demo", publications: [draft], next_cursor: 1 }));
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    calls.push({ method: request.method, path: request.url, body: JSON.parse(body) });
    if (JSON.parse(body).revision !== draft.revision) {
      response.writeHead(409).end(JSON.stringify({ message: "This publication changed. Review the new revision." }));
      return;
    }
    response.end(JSON.stringify({ ...draft, status: "approved", task_id: "fixture-task" }));
  });
  t.after(async () => {
    if (original === undefined) delete process.env.OMA_WORKSPACE_SOCKET;
    else process.env.OMA_WORKSPACE_SOCKET = original;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(socket, resolve));
  process.env.OMA_WORKSPACE_SOCKET = socket;

  const page = await listCampaignPublications("demo", 5);
  assert.equal(page.skipped, 0);
  assert.equal(page.nextCursor, 1);
  const [preview] = page.publications;
  assert.equal(preview.account.displayName, "Fixture");
  assert.deepEqual(preview.content.media, [{ assetId: "asset", kind: "image", url: "", alt: "Dark clouds" }]);
  assert.equal(preview.target?.providerId, "response-to");
  assert.equal(preview.target?.author, "@reader");
  await assert.rejects(approveCampaignPublication("demo", id, { revision: 1, approver: "operator" }),
    /Review the new revision/);
  await approveCampaignPublication("demo", preview.id, { revision: preview.revision, approver: "operator" });
  assert.deepEqual(calls, [
    { method: "GET", path: base + "?before=5" },
    { method: "POST", path: base + "/" + id + "/approve", body: { revision: 1, approver: "operator" } },
    { method: "POST", path: base + "/" + id + "/approve", body: { revision: 2, approver: "operator" } },
  ]);
});
