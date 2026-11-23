/** Verifies saved campaign integration data and the Tools tab’s catalog fallback. */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { loadAgentWorkspace } from "../lib/server/agent-workspace";

test("keeps configured integration IDs in order and drops legacy suggestion metadata", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "oma-campaign-tools-"));
  const socketPath = join(directory, "workspace.sock");
  const originalSocket = process.env.OMA_WORKSPACE_SOCKET;
  const campaign = {
    name: "Campaign", description: "", playbookId: "", version: "", orchestrator: "",
    agentIds: [], goals: [], plans: [], board: "",
  };
  const server = createServer((request, response) => {
    assert.equal(request.url, "/workspace");
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
      skipped: 0, brands: [], playbooks: [], agents: [],
      campaigns: [
        { ...campaign, id: "launch", requiredIntegrations: [
          { id: "discord", name: "Discord", slug: "discord" },
          { id: "facebook", name: "Facebook", slug: "facebook" },
        ] },
        { ...campaign, id: "empty", requiredIntegrations: [] },
        { ...campaign, id: "malformed", integrationConfigInvalid: true, requiredIntegrations: [] },
        { ...campaign, id: "legacy", toolSuggestions: ["slack"] },
      ],
    }));
  });
  t.after(async () => {
    if (originalSocket === undefined) delete process.env.OMA_WORKSPACE_SOCKET;
    else process.env.OMA_WORKSPACE_SOCKET = originalSocket;
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    rmSync(directory, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(socketPath, resolve));
  process.env.OMA_WORKSPACE_SOCKET = socketPath;

  const { records, error } = await loadAgentWorkspace();
  assert.equal(error, undefined);
  assert.deepEqual(records?.campaigns.map(({ id, requiredIntegrations, integrationConfigInvalid }) => [
    id, requiredIntegrations?.map(({ id: integrationId }) => integrationId), integrationConfigInvalid,
  ]), [
    ["launch", ["discord", "facebook"], undefined],
    ["empty", [], undefined],
    ["malformed", [], true],
    ["legacy", undefined, undefined],
  ]);
  assert.equal(Object.hasOwn(records?.campaigns[3] ?? {}, "toolSuggestions"), false);
});

test("offers catalog search for campaigns with and without required tools", (t) => {
  const require = createRequire(import.meta.url);
  const actionsPath = require.resolve("../app/actions/composio.ts");
  const browserPath = require.resolve("../components/toolkit-browser.tsx");
  const originalActions = require.cache[actionsPath];
  // The initial render only needs the UI. Next's server actions run after hydration.
  const actions = new Module(actionsPath);
  actions.loaded = true;
  require.cache[actionsPath] = actions;
  t.after(() => {
    if (originalActions) require.cache[actionsPath] = originalActions;
    else delete require.cache[actionsPath];
    delete require.cache[browserPath];
  });

  const { ToolkitBrowser } = require(browserPath) as typeof import("../components/toolkit-browser");
  const campaign = {
    scope: { playbookId: "launch", agentId: "campaign" },
    snapshot: { configured: true, connected: [] },
  };

  const catalog = renderToStaticMarkup(createElement(ToolkitBrowser, campaign));
  assert.match(catalog, /<h2>Composio catalog<\/h2>/);
  assert.match(catalog, /Search Composio tools/);
  assert.match(catalog, /Tool category/);
  assert.match(catalog, /Refresh connections/);
  assert.doesNotMatch(catalog, /No integrations configured/);

  const tools = [
    { slug: "facebook", name: "Facebook" },
    { slug: "discord", name: "Discord" },
    { slug: "github", name: "GitHub" },
  ].map((tool) => ({ ...tool, categories: [], description: "", noAuth: false, toolCount: 0 }));
  const renderedCatalog = renderToStaticMarkup(createElement(ToolkitBrowser, {
    ...campaign,
    demo: true,
    demoCatalog: tools,
    snapshot: { configured: true, connected: ["discord"], reconnect: ["github"] },
  }));
  assert.match(renderedCatalog, /aria-label="Connect Facebook"/);
  assert.match(renderedCatalog, /aria-label="Reconnect GitHub"/);
  assert.match(renderedCatalog, /class="connection-status">.*?Connected<\/span>/);
  assert.doesNotMatch(renderedCatalog, /aria-label="(?:Connect|Disconnect) Discord"/);

  const required = renderToStaticMarkup(createElement(ToolkitBrowser, {
    ...campaign,
    requiredIntegrations: [{ id: "discord", name: "Discord", slug: "discord" }],
  }));
  assert.match(required, /<h2>Campaign tools<\/h2>/);
  assert.match(required, /Connect Discord/);
  assert.match(required, /aria-pressed="true"[^>]*>Required tools<\/button>/);
  assert.match(required, /aria-pressed="false"[^>]*>Composio catalog<\/button>/);
  assert.doesNotMatch(required, /Search Composio tools/);

  const afterAuthorization = renderToStaticMarkup(createElement(ToolkitBrowser, {
    ...campaign,
    startInCatalog: true,
    demo: true,
    demoCatalog: tools,
    requiredIntegrations: [{ id: "discord", name: "Discord", slug: "discord" }],
  }));
  assert.match(afterAuthorization, /aria-pressed="true"[^>]*>Composio catalog<\/button>/);
  assert.match(afterAuthorization, /aria-label="Connect Facebook"/);

  const unconfigured = renderToStaticMarkup(createElement(ToolkitBrowser, {
    ...campaign, snapshot: { configured: false, connected: [] },
  }));
  assert.match(unconfigured, /Tool provider setup required/);
  assert.doesNotMatch(unconfigured, /Loading tools/);
});
