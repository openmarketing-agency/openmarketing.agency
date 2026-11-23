/** Checks that campaign saves generate MCP privately, sync only the needed keys, and report partial failures. */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { saveCampaignConfiguration, saveCampaignMode, type RequiredIntegration } from "../lib/server/agent-workspace";

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
  const required = [{ id: "discord", name: "Discord", slug: "discord" }];
  const createMcp: (tools: RequiredIntegration[]) => Promise<{ url: string }> = async () => ({ url });
  const generateMcp = t.mock.fn(createMcp);
  let integrationConfigInvalid = false;
  let syncFailureStatus = 0;
  let deployFailureStatus = 0;
  let lifecycleState = "resumed";
  let currentState: "paused" | "resumed" | undefined;
  let stopping = false;
  const requests: Array<{ method?: string; path?: string; body: unknown }> = [];
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/workspace") {
      response.end(JSON.stringify({
        brands: [], playbooks: [], agents: [], skipped: 0,
        campaigns: [{
          id: "seo", name: "Organic Search", description: "", playbookId: "", version: "", orchestrator: "",
          lifecycleState: currentState, agentIds: [], goals: [], plans: [], board: "", requiredIntegrations: required, integrationConfigInvalid,
          configuration: { ...configuration, composioUrl: url, revision: inputRevision },
        }],
      }));
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    requests.push({ method: request.method, path: request.url, body: payload });
    const failure = request.url?.endsWith("/sync") ? syncFailureStatus : request.url?.endsWith("/deploy") ? deployFailureStatus : 0;
    if (failure) {
      response.writeHead(failure).end(JSON.stringify({ message: "fixture-model fixture-composio" }));
    } else if (request.url?.endsWith("/lifecycle")) {
      if (payload.state === "paused") {
        response.end(JSON.stringify({ id: "seo", state: stopping ? "pausing" : "paused",
          revision: (stopping ? "1" : "2").repeat(64) }));
        stopping = false;
        return;
      }
      response.end(JSON.stringify({
        id: "seo", state: lifecycleState, revision: "d".repeat(64),
      }));
    } else {
      response.end(JSON.stringify({
        ...configuration, composioUrl: url, mode: payload.mode ?? (!payload.env && request.url?.endsWith("/sync") ? "control" : undefined),
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
  integrationConfigInvalid = true;
  assert.match((await saveCampaignConfiguration("seo", input, generateMcp)).error ?? "", /unique campaign integration IDs/);
  assert.equal(generateMcp.mock.callCount(), 0);
  assert.equal(requests.length, 0);
  integrationConfigInvalid = false;
  const providerError = "Connect or remove the campaign’s unconnected tools.";
  assert.deepEqual(await saveCampaignConfiguration("seo", input, async () => ({ error: providerError }), true), { error: providerError });
  assert.ok((await saveCampaignConfiguration("seo", input, async () => ({ url: "https://unrelated.example.test/mcp" }))).error);
  assert.equal(requests.length, 0);
  const saved = await saveCampaignConfiguration("seo", { ...input, composioUrl: "https://unrelated.example.test/mcp" }, generateMcp);
  assert.equal(saved.synced, true);
  assert.equal(generateMcp.mock.callCount(), 1);
  assert.deepEqual(generateMcp.mock.calls[0].arguments, [required]);
  assert.ok(!JSON.stringify(saved).includes(url));
  assert.deepEqual(requests, [
    { method: "PUT", path: "/workspace/campaigns/seo/config", body: { ...fields, revision: input.revision, composioUrl: url, setModelKey: true } },
    { method: "POST", path: "/workspace/campaigns/seo/sync", body: {
      revision: configuration.revision, env: { HERMES_MODEL_API_KEY: "fixture-model", COMPOSIO_API_KEY: "fixture-composio" },
    } },
  ]);
  requests.length = 0;
  const inherited = { revision: inputRevision, provider: "", modelId: "", baseUrl: "", modelKey: "" };
  assert.equal((await saveCampaignConfiguration("seo", { ...inherited, useEnvironmentKey: "true" }, generateMcp)).synced, true);
  assert.deepEqual(requests, [
    { method: "PUT", path: "/workspace/campaigns/seo/config", body: {
      revision: inputRevision, provider: "", modelId: "", baseUrl: "", composioUrl: url, setModelKey: false,
    } },
    { method: "POST", path: "/workspace/campaigns/seo/sync", body: {
      revision: configuration.revision, env: { COMPOSIO_API_KEY: "fixture-composio" },
    } },
  ]);
  assert.doesNotMatch(JSON.stringify(requests), /fixture-environment|env-model/);
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
  requests.length = 0;
  const started = await saveCampaignConfiguration("seo", input, generateMcp, true);
  assert.equal(started.synced, true);
  assert.equal(started.deployed, true);
  assert.equal(started.state, "resumed");
  assert.equal(started.configuration?.revision, "d".repeat(64));
  const env = { HERMES_MODEL_API_KEY: "fixture-model", COMPOSIO_API_KEY: "fixture-composio" };
  assert.deepEqual(requests.slice(1), [
    { method: "POST", path: "/workspace/campaigns/seo/sync", body: {
      revision: configuration.revision, env, prepareDeployment: true,
    } },
    { method: "POST", path: "/workspace/campaigns/seo/deploy", body: { revision: "c".repeat(64), env } },
    { method: "PUT", path: "/workspace/campaigns/seo/lifecycle", body: { state: "resumed", revision: "c".repeat(64) } },
  ]);
  requests.length = 0;
  lifecycleState = "pausing";
  const blocked = await saveCampaignConfiguration("seo", input, generateMcp, true);
  assert.equal(blocked.state, "pausing");
  assert.equal(blocked.deployed, true);
  assert.equal(blocked.synced, undefined);
  assert.match(blocked.error ?? "", /finish stopping/);

  requests.length = 0;
  deployFailureStatus = 412;
  assert.match((await saveCampaignConfiguration("seo", input, generateMcp, true)).error ?? "", /deployment could not be confirmed/);
  assert.equal(requests.at(-1)?.path, "/workspace/campaigns/seo/deploy");
  deployFailureStatus = 0;

  requests.length = 0;
  syncFailureStatus = 502;
  assert.match((await saveCampaignConfiguration("seo", input, generateMcp, true)).error ?? "", /could not sync/);
  assert.equal(requests.at(-1)?.path, "/workspace/campaigns/seo/sync");
  const result = await saveCampaignConfiguration("seo", input, generateMcp);
  assert.deepEqual(result.configuration, configuration);
  assert.match(result.error ?? "", /Settings were saved/);
  assert.ok(!JSON.stringify(result).includes(url));
  assert.doesNotMatch(JSON.stringify(result), /fixture-model|fixture-composio|fixture-environment/);
  syncFailureStatus = 412;
  const unrouted = await saveCampaignConfiguration("seo", input, generateMcp);
  assert.match(unrouted.error ?? "", /campaign has a board and its profiles are linked/);
  assert.doesNotMatch(unrouted.error ?? "", /fixture-model|fixture-composio/);

  const base = "/workspace/campaigns/seo";
  const pause = (revision: string) => ({ method: "PUT", path: base + "/lifecycle", body: { state: "paused", revision } });
  const resume = { method: "PUT", path: base + "/lifecycle", body: { state: "resumed", revision: "c".repeat(64) } };
  const modeUpdate = (revision: string) => ({ method: "PUT", path: base + "/mode", body: { mode: "control", revision } });
  const modeSync = { method: "POST", path: base + "/sync", body: { revision: configuration.revision } };
  const modeInput = { revision: inputRevision, mode: "control" };

  requests.length = 0;
  currentState = "resumed";
  lifecycleState = "resumed";
  syncFailureStatus = 0;
  stopping = true;
  assert.equal(await saveCampaignMode("seo", modeInput), "control");
  assert.deepEqual(requests, [pause(inputRevision), pause("1".repeat(64)), modeUpdate("2".repeat(64)), modeSync, resume]);

  requests.length = 0;
  currentState = "paused";
  assert.equal(await saveCampaignMode("seo", modeInput), "control");
  assert.deepEqual(requests, [modeUpdate(inputRevision), modeSync]);

  requests.length = 0;
  currentState = "resumed";
  const runningResult = await saveCampaignConfiguration("seo", input, generateMcp);
  assert.equal(runningResult.state, "resumed");
  assert.equal(runningResult.synced, true);
  assert.deepEqual(requests, [
    pause(inputRevision),
    { method: "PUT", path: base + "/config", body: { ...fields, revision: "2".repeat(64), composioUrl: url, setModelKey: true } },
    { method: "POST", path: base + "/sync", body: { revision: configuration.revision, env } },
    resume,
  ]);

  requests.length = 0;
  syncFailureStatus = 502;
  await assert.rejects(saveCampaignMode("seo", modeInput), /Campaign stopped/);
  assert.deepEqual(requests, [pause(inputRevision), modeUpdate("2".repeat(64)), modeSync]);
  requests.length = 0;
  const failed = await saveCampaignConfiguration("seo", input, generateMcp);
  assert.match(failed.error ?? "", /Campaign stopped/);
  assert.deepEqual(requests.map(({ path }) => path), [base + "/lifecycle", base + "/config", base + "/sync"]);
});
