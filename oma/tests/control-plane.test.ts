/** Verify the shared Web transport preserves errors, bounded body reads, CORS, and API discovery. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { controlPlane } from "../lib/server/control-plane";
import { openApiDocument } from "../lib/server/openapi";

function request(path: string, init?: RequestInit) {
  const url = new URL(path, "https://oma.example.test");
  return controlPlane(new Request(url, init), url.pathname.slice("/api/v1/".length).split("/"));
}

test("the versioned API returns its own authorization, validation and method errors", async () => {
  const unauthorized = await request("/api/v1/users/me");
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(await unauthorized.json(), { detail: "Unauthorized" });
  assert.match(unauthorized.headers.get("cache-control") ?? "", /no-store/);

  const malformed = await request("/api/v1/auth/register", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
  });
  assert.equal(malformed.status, 400);

  const oversized = await request("/api/v1/auth/jwt/login", {
    method: "POST",
    body: new URLSearchParams({ username: "person@example.test", password: "p".repeat(100 * 1024) }),
  });
  assert.equal(oversized.status, 413);
  assert.equal((await request("/api/v1/unknown")).status, 404);
});

test("cross-origin preflight permits configured origins only", async () => {
  const previous = process.env.OMA_CORS_ORIGINS;
  process.env.OMA_CORS_ORIGINS = '["https://client.example.test"]';
  try {
    for (const allowed of [true, false]) {
      const origin = allowed ? "https://client.example.test" : "https://other.example.test";
      const response = await request("/api/v1/users/me", {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Headers": "authorization" },
      });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get("access-control-allow-origin"), allowed ? origin : null);
      assert.equal(response.headers.get("access-control-allow-headers"), allowed ? "authorization" : null);
    }
  } finally {
    if (previous === undefined) delete process.env.OMA_CORS_ORIGINS;
    else process.env.OMA_CORS_ORIGINS = previous;
  }
});

test("OpenAPI discovers account and tool endpoints with OAuth2 login", () => {
  const document = openApiDocument();
  assert.equal(document.components.securitySchemes.OAuth2PasswordBearer.flows.password.tokenUrl, "/api/v1/auth/jwt/login");
  for (const path of [
    "/health",
    "/api/v1/users/me",
    "/api/v1/mcp-integrations",
    "/api/v1/tool-assignments",
  ]) {
    assert.ok(Object.hasOwn(document.paths, path), path);
  }
});

test("cloud and retired dashboard routes are unavailable", async () => {
  const { paths } = openApiDocument();
  assert.equal((await request("/api/v1/users")).status, 404);
  for (const family of ["admin", "runtime", "inference", "playbook-analytics", "playbook-dashboards"]) {
    const prefix = `/api/v1/${family}`;
    assert.ok(!Object.keys(paths).some((path) => path.startsWith(prefix)));
    assert.equal((await request(`${prefix}/seo`, { method: "POST" })).status, 404);
  }
});
