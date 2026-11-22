/** Verifies single-account registration, session rotation, and workspace data on an isolated SQLite file. */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { getDb } from "../lib/db";
import { controlPlane } from "../lib/server/control-plane";

const directory = mkdtempSync(join(tmpdir(), "oma-test-"));
process.env.OMA_DATA_DIR = directory;
after(() => {
  getDb().close();
  rmSync(directory, { recursive: true, force: true });
});

function request(path: string, method: string, body?: object, token?: string) {
  const url = new URL(path, "http://oma.test/api/v1/");
  const headers = new Headers();
  if (body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return controlPlane(new Request(url, { method, headers, body: body && JSON.stringify(body) }), path.split("/"));
}

test("concurrent signup creates one account and login requires its password", async (t) => {
  const password = "test-password";
  const emails = ["one@example.test", "two@example.test"];
  const responses = await Promise.all(emails.map(email => request("auth/register", "POST", { email, password })));
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  const [winner] = responses.filter(response => response.status === 201);
  const user = await winner.json();
  assert.deepEqual(Object.keys(user).sort(), ["email", "id"]);
  assert.equal((await request("auth/jwt/login", "POST", { username: user.email, password: "wrong-password" })).status, 400);

  const login = await request("auth/jwt/login", "POST", { username: user.email, password });
  assert.equal(login.status, 200);
  const pair = await login.json();
  const profile = await request("users/me", "GET", undefined, pair.access_token);
  assert.deepEqual(await profile.json(), user);

  const refresh = await request("auth/jwt/refresh", "POST", { refresh_token: pair.refresh_token });
  assert.equal(refresh.status, 200);
  const successor = await refresh.json();
  assert.equal((await request("auth/jwt/refresh", "POST", { refresh_token: pair.refresh_token })).status, 401);
  assert.equal((await request("auth/jwt/refresh", "POST", { refresh_token: successor.refresh_token })).status, 401);

  const assignment = "tool-assignments/seo/researcher/googleanalytics";
  for (let i = 0; i < 2; i++) {
    assert.equal((await request(assignment, "PUT", undefined, successor.access_token)).status, 204);
  }
  const assignments = await request("tool-assignments", "GET", undefined, successor.access_token);
  assert.deepEqual(await assignments.json(), [{
    playbook_id: "seo", agent_id: "researcher", toolkit_slug: "googleanalytics",
  }]);

  const socketPath = join(directory, "mock-workspace.sock");
  const workspace = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      brands: [], playbooks: [], agents: [], skipped: 0,
      campaigns: ["seo", "editorial"].map((id) => ({
        id, name: id, description: "", playbookId: "", version: "", orchestrator: "",
        agentIds: [], goals: [], plans: [], board: "",
      })),
    }));
  });
  await new Promise<void>((resolve, reject) => workspace.once("error", reject).listen(socketPath, resolve));
  const previousSocket = process.env.OMA_WORKSPACE_SOCKET;
  process.env.OMA_WORKSPACE_SOCKET = socketPath;
  t.after(async () => {
    if (previousSocket === undefined) delete process.env.OMA_WORKSPACE_SOCKET;
    else process.env.OMA_WORKSPACE_SOCKET = previousSocket;
    workspace.closeAllConnections();
    await new Promise<void>((resolve) => workspace.close(() => resolve()));
  });
  const token = successor.access_token;
  const editorial = "tool-assignments/editorial/campaign/googleanalytics";
  const seo = "tool-assignments/seo/campaign/googleanalytics";
  const global = "tool-assignments/workspace/connections/googleanalytics";
  for (const endpoint of [editorial, editorial, seo, global]) {
    assert.equal((await request(endpoint, "PUT", undefined, token)).status, 204);
  }
  assert.equal((await request("tool-assignments/unknown/campaign/googleanalytics", "PUT", undefined, token)).status, 404);
  assert.equal((await request(editorial, "PUT")).status, 401);
  assert.equal((await request(seo, "DELETE", undefined, token)).status, 204);
  const remaining = await request("tool-assignments", "GET", undefined, token);
  assert.deepEqual(await remaining.json(), [
    { playbook_id: "editorial", agent_id: "campaign", toolkit_slug: "googleanalytics" },
    { playbook_id: "workspace", agent_id: "connections", toolkit_slug: "googleanalytics" },
  ]);

  const integration = { name: "Example MCP", url: "https://example.test/mcp" };
  const created = await request("mcp-integrations", "POST", integration, successor.access_token);
  assert.equal(created.status, 201);
  assert.equal((await request("mcp-integrations", "POST", integration, successor.access_token)).status, 409);
  const { id } = await created.json();
  const updated = await request(`mcp-integrations/${id}`, "PATCH", { is_enabled: false }, successor.access_token);
  assert.equal((await updated.json()).is_enabled, false);
  assert.equal((await request(`mcp-integrations/${id}`, "DELETE", undefined, successor.access_token)).status, 204);

  const changed = await request("users/me", "PATCH", { password: "updated-password" }, successor.access_token);
  assert.equal(changed.status, 200);
  assert.equal((await request("users/me", "GET", undefined, successor.access_token)).status, 401);
  assert.equal((await request("auth/jwt/login", "POST", { username: user.email, password: "updated-password" })).status, 200);
});
