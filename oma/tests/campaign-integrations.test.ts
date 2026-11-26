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
  const workspaceActionsPath = require.resolve("../app/actions/workspace.ts");
  const editorsPath = require.resolve("../components/campaign-editors.tsx");
  // Stub Next's server actions to render the real controls without calling the workspace.
  for (const path of [actionsPath, workspaceActionsPath]) {
    const original = require.cache[path];
    const actions = new Module(path);
    actions.exports = { syncCampaignToolsAction: async () => ({}) };
    actions.loaded = true;
    require.cache[path] = actions;
    t.after(() => {
      if (original) require.cache[path] = original;
      else delete require.cache[path];
    });
  }
  t.after(() => {
    delete require.cache[browserPath];
    delete require.cache[editorsPath];
  });

  const { ToolkitBrowser } = require(browserPath) as typeof import("../components/toolkit-browser");
  const { CampaignToolSync } = require(editorsPath) as typeof import("../components/campaign-editors");
  const campaign = {
    scope: { playbookId: "launch", agentId: "campaign" },
    snapshot: { configured: true, connected: [] },
  };

  const empty = renderToStaticMarkup(createElement(ToolkitBrowser, campaign));
  assert.match(empty, /<h2>Campaign tools<\/h2>/);
  assert.match(empty, /No integrations suggested/);
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
  assert.match(renderedCatalog, /aria-label="Search tools"/);
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
    headingAction: createElement(CampaignToolSync, { campaignId: "launch", revision: "a".repeat(64), disabled: false }),
  }));
  assert.match(required, /<h2>Campaign tools<\/h2>/);
  assert.match(required, /Reconnect Discord/);
  assert.match(required, /class="connection-status">.*?Ready<\/span>/);
  assert.match(required, /<button[^>]*>Sync tools<\/button>/);
  assert.match(required, /1 of 2 required tools ready/);
  assert.match(required, /role="progressbar"[^>]*aria-valuemax="2"[^>]*aria-valuenow="1"/);
  assert.match(required, /Reconnect needed/);
  assert.ok(required.indexOf("Reconnect Discord") < required.indexOf("Facebook"), "tools that need an account come first");
  assert.doesNotMatch(required, /Search tools|Find a tool|Edit required tools|Save tools|Refresh connections|All tools|Tool category|GitHub|Disconnect/);

  const unconfigured = renderToStaticMarkup(createElement(ToolkitBrowser, {
    ...campaign, snapshot: { configured: false, connected: [] },
    requiredIntegrations: [{ id: "discord", name: "Discord", slug: "discord" }],
  }));
  assert.match(unconfigured, /Tool provider setup required/);
  assert.doesNotMatch(unconfigured, /Loading tools/);
});
