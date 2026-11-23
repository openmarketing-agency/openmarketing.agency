/** Verifies that onboarding sends credentials only to sync and confirms both native settings. */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { saveStandaloneModel } from "../lib/server/agent-workspace";

test("agent setup leaves submission available for browser validation before hydration", (t) => {
  const require = createRequire(import.meta.url);
  const view = require.resolve("../components/standalone-model-settings.tsx");
  const dependencies = [
    [require.resolve("../app/actions/workspace.ts"), { saveStandaloneModelAction: async () => ({}) }],
    [require.resolve("../components/standalone-model-settings.css"), {}],
  ] as const;
  const original = new Map(dependencies.map(([path]) => [path, require.cache[path]]));
  for (const [path, exports] of dependencies) {
    const stub = new Module(path);
    stub.exports = exports;
    stub.loaded = true;
    require.cache[path] = stub;
  }
  t.after(() => {
    for (const [path, previous] of original) {
      if (previous) require.cache[path] = previous;
      else delete require.cache[path];
    }
    delete require.cache[view];
  });

  const { StandaloneModelSettings } = require(view) as typeof import("../components/standalone-model-settings");
  const selection = { provider: "", modelId: "", baseUrl: "", reasoningEffort: "" } as const;
  const html = renderToStaticMarkup(createElement(StandaloneModelSettings, {
    setup: true,
    models: { revision: "a".repeat(64), default: selection, maintenance: selection },
  }));
  const button = html.match(/<button[^>]*>Sync and continue<\/button>/)?.[0];
  assert.ok(button);
  assert.doesNotMatch(button, /\bdisabled\b/);
  for (const field of ["provider", "modelId", "baseUrl", "modelKey"]) {
    const input = html.match(new RegExp(`<input(?=[^>]*name="${field}")[^>]*>`))?.[0];
    assert.ok(input, `Missing input for ${field}`);
    assert.match(input, /\brequired\b/);
  }
});

test("requires a base URL and confirms the same reasoning effort on both agents", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "oma-agent-setup-"));
  const socketPath = join(directory, "workspace.sock");
  const previous = process.env.OMA_WORKSPACE_SOCKET;
  const selection = { provider: "openrouter", modelId: "openai/gpt-4.1-mini", baseUrl: "https://openrouter.ai/api/v1" };
  const reasoningEffort = "high";
  const modelKey = "sk-or-v1-fixture-agent-setup";
  const input = { ...selection, reasoningEffort, revision: "a".repeat(64) };
  const revisions = { default: "b".repeat(64), maintenance: "c".repeat(64) };
  const synced = {
    revision: "d".repeat(64),
    default: { ...selection, reasoningEffort },
    maintenance: { ...selection, reasoningEffort },
  };
  const native = { ...synced };
  let failMaintenance = false;
  const calls: { path?: string; body: unknown }[] = [];
  const server = createServer(async (request, response) => {
    if (request.method === "GET") {
      response.end(JSON.stringify({ brands: [], playbooks: [], campaigns: [], agents: [], skipped: 0, standaloneModels: native }));
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    calls.push({ path: request.url, body: JSON.parse(body) });
    if (request.url === "/workspace/agents/model") {
      response.end(JSON.stringify({ revisions }));
    } else if (request.url?.endsWith("/maintenance/sync") && failMaintenance) {
      response.writeHead(409).end(JSON.stringify({ message: "The maintenance record changed." }));
    } else {
      const id = request.url?.includes("/default/") ? "default" : "maintenance";
      response.end(JSON.stringify({ id, revision: revisions[id] }));
    }
  });
  t.after(async () => {
    if (previous === undefined) delete process.env.OMA_WORKSPACE_SOCKET;
    else process.env.OMA_WORKSPACE_SOCKET = previous;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(socketPath, resolve));
  process.env.OMA_WORKSPACE_SOCKET = socketPath;

  assert.ok((await saveStandaloneModel({ ...input, provider: "", modelId: "bad id" })).error);
  assert.ok((await saveStandaloneModel({ ...input, reasoningEffort: "show" })).error);
  for (const baseUrl of ["", undefined, "http://openrouter.ai/api/v1", "https://user@openrouter.ai/api/v1"]) {
    assert.match((await saveStandaloneModel({ ...input, baseUrl })).error ?? "", /valid HTTPS provider base URL/);
  }
  assert.ok((await saveStandaloneModel({ ...input, modelKey: "invalid\nkey" })).error);
  assert.match((await saveStandaloneModel(input, { requireKey: true })).error ?? "", /Enter your provider API key/);
  assert.deepEqual(calls, []);
  assert.deepEqual(await saveStandaloneModel({ ...input, modelKey }, { requireKey: true }), { models: synced });
  assert.deepEqual(calls, [
    { path: "/workspace/agents/model", body: { ...input, setModelKey: true } },
    { path: "/workspace/agents/default/sync", body: { revision: revisions.default, env: { HERMES_MODEL_API_KEY: modelKey } } },
    { path: "/workspace/agents/maintenance/sync", body: { revision: revisions.maintenance, env: { HERMES_MODEL_API_KEY: modelKey } } },
  ]);
  calls.length = 0;
  assert.deepEqual(await saveStandaloneModel(input), { models: synced });
  assert.deepEqual(calls, [
    { path: "/workspace/agents/model", body: input },
    { path: "/workspace/agents/default/sync", body: { revision: revisions.default } },
    { path: "/workspace/agents/maintenance/sync", body: { revision: revisions.maintenance } },
  ]);

  failMaintenance = true;
  const failed = await saveStandaloneModel(input);
  assert.equal(failed.error, "The maintenance record changed.");
  assert.deepEqual(failed.models, synced);
  failMaintenance = false;
  native.maintenance = { ...synced.maintenance, reasoningEffort: "none" };
  assert.match((await saveStandaloneModel(input)).error ?? "", /confirm the saved settings on both agents/);
});
