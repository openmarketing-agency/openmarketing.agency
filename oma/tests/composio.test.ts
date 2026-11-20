/** Verifies the console's toolkit catalog, OAuth callback checks, and hosted MCP exports with an isolated SDK double. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { connectionScope, campaignToolSlugs } from "../lib/agent-connections";
import { CONNECTION_ATTEMPT_MAX_AGE, readConnectionAttempt } from "../lib/connection-attempt";
import { hostedMcpConnection, mcpClientConfiguration } from "../lib/mcp-client-config";
import { createToolCatalog, suggestedToolkit } from "../lib/tool-catalog";
import { createToolConnectionService, ToolConnectionConfigurationError, type ConnectionAttempt } from "../lib/tool-connection-service";

type CatalogClient = Parameters<typeof createToolCatalog>[0];
type ConnectionClient = Parameters<typeof createToolConnectionService>[0];

const accountId = "fixture-oma-user";
const toolkit = suggestedToolkit("searchconsole");
const fixtureAuthConfig = "fixture-search-console-config";
const providerAccount = "fixture-connected-account";
const hostedUrl = "https://mcp.example.test/session";
const fixtureHeader = "server-side-credential-fixture";

function connectedAccount(overrides: { id?: string; status?: string; isDisabled?: boolean; authConfig?: { id: string; isDisabled: boolean } } = {}) {
  return {
    id: providerAccount,
    status: "ACTIVE",
    isDisabled: false,
    toolkit: { slug: toolkit.slug },
    authConfig: { id: fixtureAuthConfig, isDisabled: false },
    ...overrides,
  };
}

function authConfiguration(id: string, overrides: { name?: string; status?: string; toolkit?: { slug: string }; isComposioManaged?: boolean } = {}) {
  return { id, name: id, status: "ENABLED", toolkit: { slug: toolkit.slug }, ...overrides };
}

test("lists, filters, and pages toolkits while reusing metadata and deduplicating categories", async (t) => {
  const search = { id: "search", name: "Search" };
  const productivity = { id: "productivity", name: "Productivity" };
  const list = t.mock.fn(async () => ({
    items: [{
      slug: toolkit.slug,
      name: toolkit.name,
      no_auth: false,
      meta: { description: toolkit.description, categories: [search], tools_count: 12 },
      composio_managed_auth_schemes: ["OAUTH2"],
      auth_schemes: ["OAUTH2"],
    }],
    total_items: 45,
    next_cursor: "after-search",
  }));
  const retrieveCategories = t.mock.fn(async () => ({ items: [productivity, search, search] }));
  const catalog = createToolCatalog({ toolkits: { list, retrieveCategories } } as unknown as CatalogClient);

  const phrase = "search console ".repeat(10);
  const page = await catalog.list({ search: `  ${phrase} `, category: search.id, cursor: "previous-page" });
  assert.deepEqual(list.mock.calls[0].arguments, [{
    type: "native", limit: 24, sort_by: "usage",
    search: phrase.trim().slice(0, 100), category: search.id, cursor: "previous-page",
  }]);
  assert.deepEqual(page, {
    items: [{
      ...toolkit, categories: [search], toolCount: 12, noAuth: false,
      managedAuth: true, authSchemes: ["OAUTH2"],
    }],
    total: 45,
    nextCursor: "after-search",
  });
  assert.deepEqual(await catalog.get(toolkit.slug), page.items[0]);
  assert.equal(list.mock.callCount(), 1);
  await assert.rejects(catalog.get("missing"), /no longer available/);
  assert.deepEqual(list.mock.calls[1].arguments, [{ type: "native", limit: 100, search: "missing" }]);
  await assert.rejects(catalog.get("UPPERCASE"), /supported tool/);
  assert.equal(list.mock.callCount(), 2);
  assert.deepEqual(await catalog.categories(), [search, productivity]);
  assert.deepEqual(await catalog.categories(), [search, productivity]);
  assert.equal(retrieveCategories.mock.callCount(), 1);
});

test("binds OAuth callbacks to the signed-in owner, connection attempt, and provider account", async (t) => {
  const callback = "https://oma.example.test/api/connections/callback?state=fixture";
  const redirectUrl = "https://oauth.example.test/authorize";
  const listConfigs = t.mock.fn(async () => ({ items: [authConfiguration(fixtureAuthConfig)], nextCursor: null }));
  const list = t.mock.fn(async () => ({ items: [connectedAccount({ isDisabled: true })] }));
  const link = t.mock.fn(async () => ({ redirectUrl, id: providerAccount }));
  const completeAuth = t.mock.fn(async () => ({ connectedAccountId: providerAccount, toolkitSlug: toolkit.slug }));
  const service = createToolConnectionService({
    authConfigs: { list: listConfigs }, connectedAccounts: { list, link, completeAuth },
  } as unknown as ConnectionClient);

  const linked = await service.connect(accountId, "searchconsole", callback);
  assert.deepEqual(linked, { connected: false, url: redirectUrl, accountId: providerAccount, authConfigId: fixtureAuthConfig });
  assert.deepEqual(listConfigs.mock.calls[0].arguments, [{ toolkit: toolkit.slug, limit: 100, cursor: undefined }]);
  assert.deepEqual(link.mock.calls[0].arguments, [accountId, fixtureAuthConfig, { callbackUrl: callback, allowMultiple: true }]);
  assert.deepEqual(list.mock.calls[0].arguments, [{
    userIds: [accountId], accountType: "PRIVATE", limit: 100, cursor: undefined,
  }]);

  const scope = { playbookId: "seo", agentId: "writer" };
  const now = 2_000_000;
  const attempt: ConnectionAttempt = {
    userId: accountId, ownerId: accountId, ...scope, toolId: toolkit.slug,
    authConfigId: fixtureAuthConfig, accountId: providerAccount,
    nonce: "f".repeat(64), returnTo: connectionScope(accountId, scope).returnTo,
    createdAt: now,
  };
  const saved = JSON.stringify(attempt);
  assert.equal(attempt.returnTo, "/campaigns/seo?agent=writer");
  assert.deepEqual(readConnectionAttempt(saved, accountId, attempt.nonce, false, now), attempt);
  const legacy = JSON.stringify({ ...attempt, returnTo: "/playbooks/seo?agent=writer" });
  assert.deepEqual(readConnectionAttempt(legacy, accountId, attempt.nonce, false, now), attempt);
  const wrongAgent = JSON.stringify({ ...attempt, returnTo: "/playbooks/seo?agent=researcher" });
  assert.equal(readConnectionAttempt(wrongAgent, accountId, attempt.nonce, false, now), null);
  assert.equal(readConnectionAttempt(saved, "another-user", attempt.nonce, false, now), null);
  assert.equal(readConnectionAttempt(saved, accountId, "another-state", false, now), null);
  assert.equal(readConnectionAttempt(saved, accountId, attempt.nonce, false, now + CONNECTION_ATTEMPT_MAX_AGE * 1000), null);
  assert.equal(readConnectionAttempt(JSON.stringify({ ...attempt, returnTo: "https://outside.example.test" }), accountId, attempt.nonce, false, now), null);

  list.mock.mockImplementation(async () => ({ items: [connectedAccount({ status: "INITIATED" })] }));
  assert.equal(await service.complete(accountId, attempt), "pending");
  const deferred = readConnectionAttempt(saved, accountId, null, true, now);
  assert.ok(deferred);
  list.mock.mockImplementation(async () => ({ items: [connectedAccount()] }));
  assert.equal(await service.complete(accountId, deferred, "fixture-session-uri"), "connected");
  assert.deepEqual(completeAuth.mock.calls[0].arguments, [{ userId: accountId, sessionUri: "fixture-session-uri" }]);
  completeAuth.mock.mockImplementation(async () => ({ connectedAccountId: "wrong-provider-account", toolkitSlug: toolkit.slug }));
  await assert.rejects(service.complete(accountId, deferred, "fixture-session-uri"), /does not match/);
  list.mock.mockImplementation(async () => ({ items: [connectedAccount({ id: "other-account" })] }));
  await assert.rejects(service.complete(accountId, attempt), /does not belong/);
  list.mock.mockImplementation(async () => ({ items: [connectedAccount({ authConfig: { id: "other-config", isDisabled: false } })] }));
  await assert.rejects(service.complete(accountId, attempt), /does not belong/);
  await assert.rejects(service.complete("another-user", attempt), /another user/);
});

test("discovers enabled toolkit configurations across pages and prefers a unique OMA-managed configuration", async (t) => {
  const preferredName = `OMA - ${toolkit.name}`;
  const list = t.mock.fn(async ({ cursor }: { cursor?: string }) => cursor ? {
    items: [authConfiguration(fixtureAuthConfig, { name: preferredName, isComposioManaged: true })],
    nextCursor: null,
  } : {
    items: [
      authConfiguration("custom-named", { name: preferredName }),
      authConfiguration("disabled", { name: preferredName, status: "DISABLED", isComposioManaged: true }),
      authConfiguration("other-tool", { name: preferredName, toolkit: { slug: "other" }, isComposioManaged: true }),
    ],
    nextCursor: "more-configs",
  });
  const create = t.mock.fn();
  const service = createToolConnectionService({ authConfigs: { list, create } } as unknown as ConnectionClient);

  assert.deepEqual(await Promise.all([service.authConfig("searchconsole"), service.authConfig(toolkit.slug)]), [
    fixtureAuthConfig, fixtureAuthConfig,
  ]);
  assert.deepEqual(list.mock.calls.map(({ arguments: args }) => args[0]), [
    { toolkit: toolkit.slug, limit: 100, cursor: undefined },
    { toolkit: toolkit.slug, limit: 100, cursor: "more-configs" },
  ]);
  assert.equal(create.mock.callCount(), 0);
});

test("creates managed authentication on demand with the Search Console read-only scope", async (t) => {
  const list = t.mock.fn(async () => ({ items: [], nextCursor: null }));
  const create = t.mock.fn(async () => ({ id: fixtureAuthConfig }));
  const service = createToolConnectionService({ authConfigs: { list, create } } as unknown as ConnectionClient);

  assert.equal(await service.authConfig(toolkit.slug), fixtureAuthConfig);
  assert.deepEqual(create.mock.calls[0].arguments, [toolkit.slug, {
    type: "use_composio_managed_auth",
    credentials: { scopes: ["https://www.googleapis.com/auth/webmasters.readonly"] },
    name: `OMA - ${toolkit.name}`,
    isEnabledForToolRouter: true,
  }]);
});

test("explains how to resolve missing or ambiguous configurations in Composio", async (t) => {
  const list = t.mock.fn(async () => ({
    items: [authConfiguration("first"), authConfiguration("second")], nextCursor: null,
  }));
  const create = t.mock.fn();
  const service = createToolConnectionService({ authConfigs: { list, create } } as unknown as ConnectionClient,
    async () => ({ ...toolkit, managedAuth: false, authSchemes: ["OAUTH2"] }));

  await assert.rejects(service.authConfig(toolkit.slug), (error: unknown) => {
    assert.ok(error instanceof ToolConnectionConfigurationError);
    assert.match(error.message, /enabled authentication configuration.*Composio/i);
    return true;
  });
  list.mock.mockImplementation(async () => ({ items: [], nextCursor: null }));
  await assert.rejects(service.authConfig(toolkit.slug), (error: unknown) => {
    assert.ok(error instanceof ToolConnectionConfigurationError);
    assert.match(error.message, /enable an authentication configuration.*Composio/i);
    return true;
  });
  assert.equal(create.mock.callCount(), 0);
});

test("pins assigned accounts in hosted MCP sessions and exports environment references", async (t) => {
  const publicTool = { ...toolkit, slug: "public-search", name: "Public Search", noAuth: true };
  const list = t.mock.fn(async () => ({ items: [connectedAccount()] }));
  const create = t.mock.fn(async () => ({
    mcp: { url: hostedUrl, headers: { "x-api-key": fixtureHeader, "X-MCP-Session": fixtureHeader } },
  }));
  const service = createToolConnectionService({
    connectedAccounts: { list }, sessions: { create },
  } as unknown as ConnectionClient, async (slug) => slug === publicTool.slug ? publicTool : toolkit);
  const assignment = (agent_id: string, toolkit_slug: string) => ({ playbook_id: "seo", agent_id, toolkit_slug });
  const slugs = campaignToolSlugs("seo", [
    assignment("researcher", toolkit.slug),
    assignment("writer", toolkit.slug),
    assignment("writer", publicTool.slug),
    assignment("default", "unassigned-default-tool"),
    { ...assignment("writer", "other-playbook-tool"), playbook_id: "finance" },
  ]);
  assert.deepEqual(slugs, [toolkit.slug, publicTool.slug]);
  const session = await service.mcpSession(accountId, slugs);
  assert.deepEqual(create.mock.calls[0].arguments, [accountId, {
    toolkits: slugs,
    connectedAccounts: { [toolkit.slug]: providerAccount },
    authConfigs: { [toolkit.slug]: fixtureAuthConfig },
    manageConnections: false,
    mcp: true,
  }]);
  const connection = hostedMcpConnection(session.mcp);
  const cursor = mcpClientConfiguration("oma", connection, "Cursor");
  const claude = mcpClientConfiguration("oma", connection, "Claude Desktop");
  assert.ok(!cursor.includes(fixtureHeader) && !claude.includes(fixtureHeader));
  assert.deepEqual(JSON.parse(cursor), { mcpServers: { oma: {
    url: hostedUrl,
    headers: { "x-api-key": "${env:COMPOSIO_API_KEY}", "X-MCP-Session": "${env:COMPOSIO_MCP_X_MCP_SESSION}" },
  } } });
  assert.deepEqual(JSON.parse(claude), { mcpServers: { oma: {
    command: "npx", args: [
      "-y", "mcp-remote", hostedUrl,
      "--header", "x-api-key:${COMPOSIO_API_KEY}",
      "--header", "X-MCP-Session:${COMPOSIO_MCP_X_MCP_SESSION}",
    ],
  } } });
  assert.throws(() => hostedMcpConnection({ url: "http://mcp.example.test/" }), /HTTPS/);

  list.mock.mockImplementation(async () => ({ items: [connectedAccount({ isDisabled: true })] }));
  await assert.rejects(service.mcpSession(accountId, slugs), /Connect or remove.*Google Search Console/);
  assert.equal(create.mock.callCount(), 1);
  await service.mcpSession(accountId, [publicTool.slug]);
  assert.deepEqual(create.mock.calls[1].arguments, [accountId, {
    toolkits: [publicTool.slug], connectedAccounts: {}, authConfigs: {}, manageConnections: false, mcp: true,
  }]);
});
