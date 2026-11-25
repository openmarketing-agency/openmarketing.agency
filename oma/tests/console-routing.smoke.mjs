/** Checks public auth routes and signed-in chat routing with a disposable database in production or development. */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

const data = await mkdtemp(join(tmpdir(), "oma-routing-"));
const port = "3217";
const origin = "http://127.0.0.1:" + port;
const development = process.argv.includes("--dev");
const command = development
  ? ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1"]
  : [".next/standalone/server.js"];
const app = spawn(process.execPath, command, {
  env: {
    PATH: process.env.PATH,
    HOSTNAME: "127.0.0.1",
    PORT: port,
    OMA_DATA_DIR: data,
    OMA_SECRET_KEY: randomUUID(),
    NEXT_TELEMETRY_DISABLED: "1",
  },
  stdio: development ? ["ignore", "pipe", "pipe"] : "inherit",
});
const exited = once(app, "exit");
let developmentOutput = "";
if (development) {
  for (const [source, destination] of [[app.stdout, process.stdout], [app.stderr, process.stderr]]) {
    source.setEncoding("utf8").on("data", (chunk) => {
      developmentOutput += chunk;
      destination.write(chunk);
    });
  }
}

function request(path, options) {
  return fetch(origin + path, { redirect: "manual", signal: AbortSignal.timeout(5000), ...options });
}

async function assertRedirect(path, destination) {
  const response = await request(path);
  assert.equal(response.status, 307, path);
  assert.equal(new URL(response.headers.get("location"), origin).href, origin + destination);
}

async function assertPage(path, text, headers) {
  const response = await request(path, { headers });
  assert.equal(response.status, 200, path);
  assert.ok((await response.text()).includes(text), path + " did not render " + text);
}

try {
  let ready = false;
  for (let attempt = 0; app.exitCode === null && attempt < 100; attempt++) {
    const response = await request("/health").catch(() => null);
    if (response?.ok) {
      ready = true;
      break;
    }
    await setTimeout(100);
  }
  assert.ok(ready, "The console did not start");
  await assertRedirect("/", "/dashboard");
  await assertRedirect("/dashboard", "/login?next=%2Fdashboard");
  await assertRedirect("/tasks", "/login?next=%2Ftasks");
  await assertPage("/login?next=%2Fdashboard", "Sign in");
  await assertPage("/register", "Create account");

  const email = "routing@example.test";
  const password = randomUUID();
  const registered = await request("/api/v1/auth/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(registered.status, 201);
  const signedIn = await request("/api/v1/auth/jwt/login", {
    method: "POST", body: new URLSearchParams({ username: email, password }),
  });
  assert.equal(signedIn.status, 200);
  const { access_token: token } = await signedIn.json();
  const headers = { cookie: "oma_access=" + token };

  for (const path of ["/dashboard", "/settings", "/connections", "/approvals"]) {
    await assertPage(path, "Workspace chat", headers);
  }
  await assertPage("/dashboard", 'href="/tasks"', headers);
  await assertPage("/dashboard", 'aria-label="Open navigation"', headers);
  await assertPage("/dashboard", 'aria-controls="workspace-conversation"', headers);
  await assertPage("/tasks", "Tasks unavailable", headers);
  await assertPage("/campaigns/fixture?view=deploy", "Campaign chat", headers);
  const lifecyclePath = "/api/campaigns/fixture/lifecycle";
  assert.ok([307, 401].includes((await request(lifecyclePath)).status));
  assert.equal((await request("/api/campaigns/bad!/lifecycle", { headers })).status, 404);
  const lifecycle = await request(lifecyclePath, { headers });
  assert.equal(lifecycle.status, 503, "Missing workspace must be reported as unavailable");
  assert.equal(lifecycle.headers.get("cache-control"), "private, no-store");
  console.log("Public auth and signed-in chat routes passed.");
} finally {
  app.kill();
  await exited;
  await rm(data, { recursive: true, force: true });
}

if (development) {
  assert.doesNotMatch(developmentOutput, /encountered uncached data|Could not validate `instant`/);
}
