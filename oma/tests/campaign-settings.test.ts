/** Checks that campaign saves generate MCP privately, sync only the needed keys, and report partial failures. */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadCampaignModelDefaults, saveCampaignConfiguration } from "../lib/server/agent-workspace";

test("saves a campaign's YAML settings, then POSTs only the requested credentials", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "oma-"));
  const socket = join(dir, "ws");
  const environment = {
    OMA_WORKSPACE_SOCKET: socket,
    COMPOSIO_API_KEY: "fixture-composio",
    OMA_HERMES_BASE_URL: "https://proxy.example.test",
    OMA_HERMES_API_KEY: "fixture-environment",
    OMA_HERMES_PROVIDER: "openai-api",
    OMA_HERMES_MODEL: "env-model",
  };
  const previous = new Map(Object.keys(environment).map((name) => [name, process.env[name]]));
  Object.assign(process.env, environment);
  const inputRevision = "a".repeat(64);
  const url = "https://backend.composio.dev/tool_router/trs_example/mcp";
  const configuration = {
    revision: "b".repeat(64), modelId: "proxy-model", provider: "openai-api",
    baseUrl: "https://proxy.example.test", hasModelKey: true,
  };
  const generateMcp = t.mock.fn(async () => ({ url }));
  let syncFailureStatus = 0;
  const requests: Array<{ method?: string; path?: string; body: unknown }> = [];
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/workspace") {
      response.end(JSON.stringify({
        brands: [], playbooks: [], agents: [], skipped: 0,
        campaigns: [{
          id: "seo", name: "Organic Search", description: "", playbookId: "", version: "", orchestrator: "",
          agentIds: [], goals: [], plans: [], board: "",
          configuration: { ...configuration, composioUrl: url, revision: inputRevision },
        }],
      }));
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, path: request.url, body: JSON.parse(body) });
    if (request.method === "POST" && syncFailureStatus) {
      response.writeHead(syncFailureStatus).end(JSON.stringify({ message: "fixture-model fixture-composio" }));
    } else {
      response.end(JSON.stringify({
        ...configuration, composioUrl: url,
        revision: request.method === "PUT" ? configuration.revision : "c".repeat(64),
      }));
    }
  });
  t.after(async () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(socket, resolve));

  const { hasModelKey, ...fields } = configuration;
  assert.equal(hasModelKey, true);
  const input = { ...fields, revision: inputRevision, modelKey: "fixture-model" };
  assert.ok((await saveCampaignConfiguration("seo", { ...input, baseUrl: "http://unrelated.example.test" }, generateMcp)).error);
  assert.ok((await saveCampaignConfiguration("seo", { ...input, revision: configuration.revision }, generateMcp)).error);
  assert.equal(generateMcp.mock.callCount(), 0);
  const providerError = "Connect or remove the campaign’s unconnected tools.";
  assert.deepEqual(await saveCampaignConfiguration("seo", input, async () => ({ error: providerError })), { error: providerError });
  assert.ok((await saveCampaignConfiguration("seo", input, async () => ({ url: "https://unrelated.example.test/mcp" }))).error);
  assert.equal(requests.length, 0);
  const saved = await saveCampaignConfiguration("seo", { ...input, composioUrl: "https://unrelated.example.test/mcp" }, generateMcp);
  assert.equal(saved.synced, true);
  assert.equal(generateMcp.mock.callCount(), 1);
  assert.ok(!JSON.stringify(saved).includes(url));
  assert.deepEqual(requests, [
    { method: "PUT", path: "/workspace/campaigns/seo/config", body: { ...fields, revision: input.revision, composioUrl: url, setModelKey: true } },
    { method: "POST", path: "/workspace/campaigns/seo/sync", body: {
      revision: configuration.revision, env: { HERMES_MODEL_API_KEY: "fixture-model", COMPOSIO_API_KEY: "fixture-composio" },
    } },
  ]);
  assert.deepEqual(loadCampaignModelDefaults(), {
    provider: "openai-api", modelId: "env-model", baseUrl: fields.baseUrl, hasApiKey: true,
  });
  const fromEnvironment = { ...input, provider: "openai-api", useEnvironmentKey: "true", modelKey: "" };
  requests.length = 0;
  for (const override of [
    { baseUrl: "https://other.example.test" },
    { provider: "openrouter" },
  ]) {
    assert.match((await saveCampaignConfiguration("seo", { ...fromEnvironment, ...override }, generateMcp)).error ?? "", /configured provider and base URL/);
  }
  assert.equal(requests.length, 0);
  assert.equal((await saveCampaignConfiguration("seo", fromEnvironment, generateMcp)).synced, true);
  assert.deepEqual(requests, [
    { method: "PUT", path: "/workspace/campaigns/seo/config", body: { ...fields,
      revision: input.revision, composioUrl: url, setModelKey: true, useEnvironmentKey: true } },
    { method: "POST", path: "/workspace/campaigns/seo/sync", body: {
      revision: configuration.revision, env: { OMA_HERMES_API_KEY: "fixture-environment", COMPOSIO_API_KEY: "fixture-composio" },
    } },
  ]);
  requests.length = 0;
  assert.equal((await saveCampaignConfiguration("seo", { ...fromEnvironment, modelKey: "fixture-model" }, generateMcp)).synced, true);
  assert.deepEqual(requests[1]?.body, {
    revision: configuration.revision, env: { HERMES_MODEL_API_KEY: "fixture-model", COMPOSIO_API_KEY: "fixture-composio" },
  });
  requests.length = 0;
  delete process.env.COMPOSIO_API_KEY;
  assert.equal((await saveCampaignConfiguration("seo", input, async () => ({ url: "" }))).synced, true);
  assert.deepEqual(requests, [
    { method: "PUT", path: "/workspace/campaigns/seo/config", body: { ...fields, revision: input.revision,
      composioUrl: "", setModelKey: true } },
    { method: "POST", path: "/workspace/campaigns/seo/sync", body: {
      revision: configuration.revision, env: { HERMES_MODEL_API_KEY: "fixture-model" },
    } },
  ]);
  process.env.COMPOSIO_API_KEY = environment.COMPOSIO_API_KEY;
  syncFailureStatus = 502;
  const result = await saveCampaignConfiguration("seo", input, generateMcp);
  assert.deepEqual(result.configuration, configuration);
  assert.match(result.error ?? "", /Settings were saved/);
  assert.ok(!JSON.stringify(result).includes(url));
  assert.doesNotMatch(JSON.stringify(result), /fixture-model|fixture-composio|fixture-environment/);
  syncFailureStatus = 412;
  const unrouted = await saveCampaignConfiguration("seo", input, generateMcp);
  assert.match(unrouted.error ?? "", /campaign has a board and its profiles are linked/);
  assert.doesNotMatch(unrouted.error ?? "", /fixture-model|fixture-composio/);
});
