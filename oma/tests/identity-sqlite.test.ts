/** Verifies single-account registration, long-lived sessions, sign-out, and workspace data on an isolated SQLite file. */

import assert from "node:assert/strict";
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

test("concurrent signup creates one account and login requires its password", async () => {
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
  const session = await login.json();
  assert.deepEqual(Object.keys(session).sort(), ["access_token", "expires_in", "token_type"]);
  assert.equal(session.expires_in, 60 * 60 * 24 * 30);
  const profile = await request("users/me", "GET", undefined, session.access_token);
  assert.deepEqual(await profile.json(), user);
  assert.equal((await request("auth/jwt/refresh", "POST", { refresh_token: session.access_token })).status, 404);

  // Signing out ends every session the account holds, including copies of the token.
  const other = await (await request("auth/jwt/login", "POST", { username: user.email, password })).json();
  assert.equal((await request("auth/jwt/logout-all", "POST", undefined, session.access_token)).status, 204);
  assert.equal((await request("users/me", "GET", undefined, session.access_token)).status, 401);
  assert.equal((await request("users/me", "GET", undefined, other.access_token)).status, 401);
  const successor = await (await request("auth/jwt/login", "POST", { username: user.email, password })).json();

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
