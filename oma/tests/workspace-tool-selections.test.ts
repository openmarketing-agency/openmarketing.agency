/** Exercises the console's tool-selection transport through a disposable workspace socket. */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  importWorkspaceToolSelections,
  readWorkspaceToolSelections,
  WorkspaceRequestError,
  writeWorkspaceToolSelection,
} from "../lib/server/agent-workspace";

test("uses the private workspace socket for reads, writes, and a matching migration acknowledgment", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "oma-selections-"));
  const socketPath = join(directory, "workspace.sock");
  const originalSocket = process.env.OMA_WORKSPACE_SOCKET;
  const selectionPath = "/workspace/tool-selections";
  const selection = { workspace: ["public-search"], campaigns: { seo: ["google_analytics", "public-search"] } };
  const removedPublicTool = { workspace: [], campaigns: { seo: ["google_analytics"] } };
  const migrationId = "a".repeat(64);
  const calls: { method?: string; path?: string; body?: unknown }[] = [];
  let responseBody: unknown = selection;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
    calls.push({ method: request.method, path: request.url, body });
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(responseBody));
  });

  t.after(async () => {
    if (originalSocket === undefined) delete process.env.OMA_WORKSPACE_SOCKET;
    else process.env.OMA_WORKSPACE_SOCKET = originalSocket;
    if (server.listening) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    rmSync(directory, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(socketPath, resolve));
  process.env.OMA_WORKSPACE_SOCKET = socketPath;

  await assert.rejects(writeWorkspaceToolSelection("../seo", "google_analytics", true), { status: 422 });
  await assert.rejects(writeWorkspaceToolSelection("seo", "invalid/path", true), { status: 422 });
  assert.deepEqual(await readWorkspaceToolSelections(), selection);
  assert.deepEqual(await writeWorkspaceToolSelection("seo", "google_analytics", true), selection);
  responseBody = removedPublicTool;
  assert.deepEqual(await writeWorkspaceToolSelection(null, "public-search", false), removedPublicTool);
  responseBody = { migrationId };
  await importWorkspaceToolSelections({ migrationId, ...selection });
  assert.deepEqual(calls, [
    { method: "GET", path: selectionPath, body: undefined },
    { method: "PUT", path: selectionPath, body: { campaignId: "seo", slug: "google_analytics", selected: true } },
    { method: "PUT", path: selectionPath, body: { campaignId: null, slug: "public-search", selected: false } },
    { method: "POST", path: selectionPath + "/import", body: { migrationId, ...selection } },
  ]);

  responseBody = { migrationId: "b".repeat(64) };
  await assert.rejects(importWorkspaceToolSelections({ migrationId, ...selection }), {
    status: 502, message: /did not confirm/,
  });
  responseBody = { migrationId: false };
  await assert.rejects(importWorkspaceToolSelections({ migrationId, ...selection }), {
    status: 502, message: /did not confirm/,
  });
  responseBody = { workspace: null, campaigns: null };
  await assert.rejects(readWorkspaceToolSelections(), { status: 502, message: /invalid tool selections/ });

  delete process.env.OMA_WORKSPACE_SOCKET;
  await assert.rejects(readWorkspaceToolSelections(), (error: unknown) =>
    error instanceof WorkspaceRequestError && error.status === 503);
});
