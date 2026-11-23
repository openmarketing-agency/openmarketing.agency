import type { Composio } from "@composio/core";
import { tools } from "./campaigns.ts";
import { toolkitSlug, validToolkitSlug, type Toolkit } from "./tool-catalog.ts";

export type ConnectionSnapshot = {
  configured: boolean;
  connected: string[];
  reconnect?: string[];
  pending?: string[];
  error?: string;
};
type Client = Pick<Composio, "authConfigs" | "connectedAccounts" | "sessions">;

/** Configuration guidance that can be shown directly to the signed-in user. */
export class ToolConnectionConfigurationError extends Error {}

export type ConnectionAttempt = {
  userId: string;
  ownerId?: string;
  playbookId?: string;
  agentId?: string;
  toolId: string;
  authConfigId: string;
  accountId: string;
  nonce: string;
  returnTo: string;
  createdAt: number;
};

export function createToolConnectionService(
  client: Client,
  resolveToolkit?: (slug: string) => Promise<Toolkit>,
) {
  async function definition(id: string): Promise<Toolkit> {
    const slug = toolkitSlug(id);
    if (!validToolkitSlug(slug)) throw new Error("Choose a supported tool.");
    if (resolveToolkit) return resolveToolkit(slug);
    const tool = Object.values(tools).find((tool) => tool.slug === slug);
    if (!tool) throw new Error("Choose a supported tool.");
    return {
      slug,
      name: tool.name,
      description: tool.description,
      categories: [],
      noAuth: false,
      toolCount: 0,
      managedAuth: true,
    };
  }
  const resolving = new Map<string, Promise<string>>();

  async function authConfig(toolId: string): Promise<string> {
    const slug = toolkitSlug(toolId);
    const underway = resolving.get(slug);
    if (underway) return underway;
    const resolution = (async () => {
      const tool = await definition(slug);
      const items = [];
      let cursor: string | undefined;
      do {
        const page = await client.authConfigs.list({
          toolkit: slug,
          limit: 100,
          cursor,
        });
        items.push(
          ...page.items.filter(
            (c) =>
              c.status === "ENABLED" && c.toolkit.slug === slug,
          ),
        );
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      const name = `OMA - ${tool.name}`;
      const preferred = items.filter((c) => c.name === name);
      const managed = preferred.filter((c) => c.isComposioManaged);
      if (managed.length === 1) return managed[0].id;
      const candidates = preferred.length ? preferred : items;
      if (candidates.length === 1) return candidates[0].id;
      if (candidates.length > 1)
        throw new ToolConnectionConfigurationError(
          `Keep one enabled authentication configuration for this tool in Composio or name exactly one “${name}”.`,
        );
      const scopes =
        slug === "google_search_console"
          ? ["https://www.googleapis.com/auth/webmasters.readonly"]
          : slug === "google_analytics"
            ? ["https://www.googleapis.com/auth/analytics.readonly"]
            : undefined;
      if (tool.managedAuth === false && !tool.authSchemes?.includes("API_KEY"))
        throw new ToolConnectionConfigurationError(
          "Enable an authentication configuration for this tool in Composio.",
        );
      const created = await client.authConfigs.create(slug, {
        ...(tool.managedAuth !== false
          ? {
              type: "use_composio_managed_auth" as const,
              ...(scopes ? { credentials: { scopes } } : {}),
            }
          : {
              type: "use_custom_auth" as const,
              authScheme: "API_KEY" as const,
              credentials: {},
            }),
        name,
        isEnabledForToolRouter: true,
      });
      return created.id;
    })();
    resolving.set(slug, resolution);
    try {
      return await resolution;
    } finally {
      resolving.delete(slug);
    }
  }

  async function accounts(userId: string) {
    const items: Awaited<
      ReturnType<Client["connectedAccounts"]["list"]>
    >["items"] = [];
    let cursor: string | undefined;
    do {
      const page = await client.connectedAccounts.list({
        userIds: [userId],
        accountType: "PRIVATE",
        limit: 100,
        cursor,
      });
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return items;
  }
  const matches = (
    account: Awaited<ReturnType<typeof accounts>>[number],
    toolId: string,
  ) =>
    account.toolkit.slug === toolkitSlug(toolId) &&
    !account.authConfig.isDisabled;
  const usable = (account: Awaited<ReturnType<typeof accounts>>[number]) =>
    account.status === "ACTIVE" && !account.isDisabled;

  async function snapshot(userId: string): Promise<ConnectionSnapshot> {
    const items = await accounts(userId);
    const ids = [...new Set(items.map((item) => item.toolkit.slug))];
    return {
      configured: true,
      connected: ids.filter((id) =>
        items.some((a) => matches(a, id) && usable(a)),
      ),
      reconnect: ids.filter(
        (id) =>
          !items.some((a) => matches(a, id) && usable(a)) &&
          items.some(
            (a) =>
              matches(a, id) &&
              (["EXPIRED", "REVOKED", "FAILED", "INACTIVE"].includes(
                a.status,
              ) ||
                a.isDisabled),
          ),
      ),
      pending: ids.filter(
        (id) =>
          !items.some((a) => matches(a, id) && usable(a)) &&
          items.some(
            (a) =>
              matches(a, id) &&
              ["INITIATED", "INITIALIZING"].includes(a.status),
          ),
      ),
    };
  }

  async function connect(userId: string, toolId: string, callbackUrl: string) {
    const tool = await definition(toolId);
    if (tool.noAuth) return { connected: true as const };
    const owned = await accounts(userId);
    const existing = owned.find((a) => matches(a, toolId) && usable(a));
    if (existing) return { connected: true as const };
    const configId = await authConfig(toolId);
    // A disabled ACTIVE account is unusable, but link() still counts it in its
    // duplicate-account preflight. Allow a replacement only in that case.
    const replaceDisabled = owned.some(
      (a) =>
        a.authConfig.id === configId && a.status === "ACTIVE" && a.isDisabled,
    );
    const link = await client.connectedAccounts.link(userId, configId, {
      callbackUrl,
      ...(replaceDisabled ? { allowMultiple: true } : {}),
    });
    if (!link.redirectUrl || new URL(link.redirectUrl).protocol !== "https:")
      throw new Error("The provider did not return a secure sign-in link.");
    return {
      connected: false as const,
      url: link.redirectUrl,
      accountId: link.id,
      authConfigId: configId,
    };
  }

  async function complete(
    userId: string,
    attempt: ConnectionAttempt,
    sessionUri?: string,
  ) {
    if (attempt.userId !== userId)
      throw new Error("Connection attempt belongs to another user.");
    if (sessionUri) {
      const completed = await client.connectedAccounts.completeAuth({
        userId,
        sessionUri,
      });
      if (
        completed.connectedAccountId !== attempt.accountId ||
        completed.toolkitSlug !== toolkitSlug(attempt.toolId)
      )
        throw new Error("Connection does not match the saved attempt.");
    }
    // List through the authenticated user filter: never trust callback IDs/status.
    const account = (await accounts(userId)).find(
      (a) =>
        a.id === attempt.accountId &&
        matches(a, attempt.toolId) &&
        a.authConfig.id === attempt.authConfigId,
    );
    if (!account)
      throw new Error(
        "The account does not belong to this connection attempt.",
      );
    if (usable(account)) return "connected" as const;
    if (["INITIATED", "INITIALIZING"].includes(account.status))
      return "pending" as const;
    return "failed" as const;
  }

  async function disconnect(userId: string, toolId: string) {
    const selected = (await accounts(userId)).filter(
      (a) => matches(a, toolId) && usable(a),
    );
    for (const account of selected)
      await client.connectedAccounts.disable(account.id);
    const remaining = await accounts(userId);
    if (
      remaining.some(
        (account) =>
          selected.some((previous) => previous.id === account.id) &&
          usable(account),
      )
    ) {
      throw new Error("The tool is still connected. Refresh and try again.");
    }
  }

  async function mcpSession(userId: string, toolIds: string[]) {
    const ids = [...new Set(toolIds.map(toolkitSlug))];
    if (!ids.length)
      throw new ToolConnectionConfigurationError("No campaign integrations were configured.");
    const definitions = await Promise.all(ids.map(definition));
    const items = await accounts(userId);
    const selected = definitions.map((tool) => ({
      tool,
      account: items.find(
        (account) => matches(account, tool.slug) && usable(account),
      ),
    }));
    const missing = selected.filter(
      (item) => !item.tool.noAuth && !item.account,
    );
    if (missing.length) {
      throw new ToolConnectionConfigurationError(
        `Connect these required tools before syncing the campaign: ${missing.map(({ tool }) => tool.name).join(", ")}.`,
      );
    }
    const authenticated = selected.filter((item) => item.account);
    return client.sessions.create(userId, {
      toolkits: ids,
      connectedAccounts: Object.fromEntries(
        authenticated.map((item) => [item.tool.slug, item.account!.id]),
      ),
      authConfigs: Object.fromEntries(
        authenticated.map((item) => [
          item.tool.slug,
          item.account!.authConfig.id,
        ]),
      ),
      manageConnections: false,
      mcp: true,
    });
  }

  return {
    accounts,
    authConfig,
    snapshot,
    connect,
    complete,
    disconnect,
    mcpSession,
  };
}
