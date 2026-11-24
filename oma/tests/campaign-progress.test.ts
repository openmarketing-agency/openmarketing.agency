/** Verifies campaign monitoring through the private socket without exposing native task or publication payloads. */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readCampaignProgress, readCampaignTaskActivity } from "../lib/server/campaign-progress";

test("loads task activity and current publication statuses, even when one source is unavailable", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "oma-progress-"));
  const socket = join(directory, "workspace.sock");
  const previous = process.env.OMA_WORKSPACE_SOCKET;
  const calls: string[] = [];
  let publicationsAvailable = true;
  const publicationId = "a".repeat(32);
  const publication = { id: publicationId, revision: 1, status: "pending_approval", platform: "x", kind: "post",
    created_at: "test", updated_at: "test", account: { id: "fixture", name: "Campaign account" },
    content: { text: "Publication text stays in Approvals" }, approval: null, result: null, task_id: null };
  const server = createServer((request, response) => {
    const path = request.url ?? "";
    calls.push(path);
    if (path.endsWith("/progress")) {
      response.end(JSON.stringify({
        board: { state: "ready", tasks: [{
          id: "t_fixture", title: "Draft outline", status: "running", assignee: "writer", createdAt: 1,
          startedAt: 2, completedAt: null, summary: "", failure: "", claim_lock: "private",
        }] },
        schedule: { state: "ready", jobs: [] },
      }));
    } else if (path.endsWith("/tasks/t_fixture")) {
      response.end(JSON.stringify({
        body: "Outline the campaign", result: "", blockReason: "", events: [{ id: 1, kind: "claimed", at: 2 }],
        runs: [{ id: 2, profile: "writer", status: "running", outcome: "", summary: "", error: "", startedAt: 2,
          endedAt: null, metadata: "private" }],
      }));
    } else if (publicationsAvailable && path.endsWith("/publications?limit=6")) {
      response.end(JSON.stringify({ campaign_id: "example", publications: [publication], next_cursor: null }));
    } else {
      response.writeHead(503).end(JSON.stringify({ message: "Unavailable" }));
    }
  });
  t.after(async () => {
    if (previous === undefined) delete process.env.OMA_WORKSPACE_SOCKET;
    else process.env.OMA_WORKSPACE_SOCKET = previous;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(socket, resolve));
  process.env.OMA_WORKSPACE_SOCKET = socket;

  const snapshot = await readCampaignProgress("example");
  assert.equal(snapshot.board.state, "ready");
  assert.ok(snapshot.board.state === "ready" && snapshot.board.tasks[0].id === "t_fixture");
  assert.deepEqual(snapshot.publications, {
    state: "ready", items: [{ id: publicationId, status: "pending_approval", platform: "x", account: "Campaign account" }],
    skipped: 0,
  });
  const activity = await readCampaignTaskActivity("example", "t_fixture");
  assert.equal(activity.runs[0].status, "running");
  assert.equal(activity.events[0].kind, "claimed");
  assert.doesNotMatch(JSON.stringify({ snapshot, activity }), /private|Publication text stays/);
  publicationsAvailable = false;
  assert.deepEqual((await readCampaignProgress("example")).publications, { state: "unavailable" });
  assert.ok(calls.every((path) => path.startsWith("/workspace/campaigns/example/")));
});
