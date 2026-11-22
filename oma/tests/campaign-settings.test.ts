/** Checks that campaign settings send keys only to the private sync endpoint and report partial failures. */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { saveCampaignConfiguration } from "../lib/server/agent-workspace";

test("saves a campaign's YAML settings, then POSTs only the requested credentials", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "oma-"));
  const socket = join(dir, "ws");
  const previousSocket = process.env.OMA_WORKSPACE_SOCKET;
  const previousComposio = process.env.COMPOSIO_API_KEY;
  process.env.OMA_WORKSPACE_SOCKET = socket;
  process.env.COMPOSIO_API_KEY = "fixture-composio";
  const configuration = {
    revision: "b".repeat(64), modelId: "proxy-model", provider: "litellm-proxy",
    baseUrl: "https://proxy.example.test", composioUrl: "https://backend.composio.dev/tool_router/trs_example/mcp",
    hasModelKey: true,
  };
  let failSync = false;
  const requests: Array<{ method?: string; path?: string; body: unknown }> = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, path: request.url, body: JSON.parse(body) });
    if (request.method === "POST" && failSync) {
      response.writeHead(502).end(JSON.stringify({ message: "fixture-model fixture-composio" }));
    } else {
      response.end(JSON.stringify(request.method === "PUT" ? configuration : { ...configuration, revision: "c".repeat(64) }));
    }
  });
  t.after(async () => {
    if (previousSocket === undefined) delete process.env.OMA_WORKSPACE_SOCKET;
    else process.env.OMA_WORKSPACE_SOCKET = previousSocket;
    if (previousComposio === undefined) delete process.env.COMPOSIO_API_KEY;
    else process.env.COMPOSIO_API_KEY = previousComposio;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(socket, resolve));

  const { hasModelKey, ...fields } = configuration;
  assert.equal(hasModelKey, true);
  const input = { ...fields, revision: "a".repeat(64), modelKey: "fixture-model" };
  assert.ok((await saveCampaignConfiguration("seo", { ...input, composioUrl: "https://unrelated.example.test/mcp" })).error);
  assert.deepEqual(requests, []);
  assert.equal((await saveCampaignConfiguration("seo", input)).synced, true);
  assert.deepEqual(requests, [
    { method: "PUT", path: "/workspace/campaigns/seo/config", body: { ...fields, revision: input.revision, setModelKey: true } },
    { method: "POST", path: "/workspace/campaigns/seo/sync", body: {
      revision: configuration.revision, env: { LITELLM_API_KEY: "fixture-model", COMPOSIO_API_KEY: "fixture-composio" },
    } },
  ]);
  failSync = true;
  const result = await saveCampaignConfiguration("seo", input);
  assert.deepEqual(result.configuration, configuration);
  assert.match(result.error ?? "", /Settings were saved/);
  assert.doesNotMatch(JSON.stringify(result), /fixture-model|fixture-composio/);
});
