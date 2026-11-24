/** Verifies saved campaign integration data and the campaign and workspace tool lists. */

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
import { validToolkitSlug } from "../lib/tool-catalog";

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
          { id: "1password", name: "1Password", slug: "_1password" },
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

  for (const invalid of ["_ordinary", "../discord", "_2/path", "_" + "1".repeat(128)]) {
    assert.equal(validToolkitSlug(invalid), false);
  }

  const { records, error } = await loadAgentWorkspace();
  assert.equal(error, undefined);
  assert.deepEqual(records?.campaigns.map(({ id, requiredIntegrations, integrationConfigInvalid }) => [
    id, requiredIntegrations?.map(({ id: integrationId }) => integrationId), integrationConfigInvalid,
  ]), [
    ["launch", ["discord", "facebook", "1password"], undefined],
    ["empty", [], undefined],
    ["malformed", [], true],
    ["legacy", undefined, undefined],
  ]);
  assert.equal(Object.hasOwn(records?.campaigns[3] ?? {}, "toolSuggestions"), false);
});

test("shows only configured tools in campaigns and keeps the shared catalog in workspace Tools", (t) => {
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

  const empty = renderToStaticMarkup(createElement(ToolkitBrowser, campaign));
  assert.match(empty, /<h2>Campaign tools<\/h2>/);
  assert.match(empty, /No integrations configured/);
  assert.doesNotMatch(empty, /Composio catalog|All tools|Tool category|Loading tools/);

  const tools = [
    { slug: "facebook", name: "Facebook" },
    { slug: "discord", name: "Discord" },
    { slug: "github", name: "GitHub" },
  ].map((tool) => ({ ...tool, categories: [], description: "", noAuth: false, toolCount: 0 }));
  const renderedCatalog = renderToStaticMarkup(createElement(ToolkitBrowser, {
    demo: true,
    demoCatalog: tools,
    snapshot: { configured: true, connected: [], reconnect: ["github"] },
  }));
  assert.match(renderedCatalog, /<h2>Tool catalog<\/h2>/);
  assert.match(renderedCatalog, /Tool category/);
  assert.match(renderedCatalog, /aria-label="Connect Facebook"/);
  assert.match(renderedCatalog, /aria-label="Reconnect GitHub"/);

  const required = renderToStaticMarkup(createElement(ToolkitBrowser, {
    ...campaign,
    demo: true,
    demoCatalog: tools,
    requiredIntegrations: [
      { id: "discord", name: "Discord", slug: "discord" },
      { id: "facebook", name: "Facebook", slug: "facebook" },
    ],
    snapshot: { configured: true, connected: ["facebook"], reconnect: ["discord"] },
  }));
  assert.match(required, /<h2>Campaign tools<\/h2>/);
  assert.match(required, /Reconnect Discord/);
  assert.match(required, /class="connection-status">.*?Ready<\/span>/);
  assert.match(required, /Search campaign tools/);
  assert.doesNotMatch(required, /Composio catalog|All tools|Tool category|GitHub|Disconnect/);

  const unconfigured = renderToStaticMarkup(createElement(ToolkitBrowser, {
    ...campaign, snapshot: { configured: false, connected: [] },
    requiredIntegrations: [{ id: "discord", name: "Discord", slug: "discord" }],
  }));
  assert.match(unconfigured, /Tool provider setup required/);
  assert.doesNotMatch(unconfigured, /Loading tools/);
});
