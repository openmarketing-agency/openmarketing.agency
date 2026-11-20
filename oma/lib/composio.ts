import "server-only";
import { Composio } from "@composio/core";
import { createToolCatalog } from "@/lib/tool-catalog";
import {
  createToolConnectionService,
  ToolConnectionConfigurationError,
  type ConnectionSnapshot,
} from "@/lib/tool-connection-service";
export type { ConnectionSnapshot } from "@/lib/tool-connection-service";
let current: {
  key: string;
  client: Composio;
  catalog: ReturnType<typeof createToolCatalog>;
  connections: ReturnType<typeof createToolConnectionService>;
} | undefined;

const configuredKey = () => process.env.COMPOSIO_API_KEY?.trim();

function services() {
  const key = configuredKey();
  if (!key) {
    throw new ToolConnectionConfigurationError("Set COMPOSIO_API_KEY and reload OMA to enable tool connections.");
  }
  if (current?.key === key) return current;
  const client = new Composio({ apiKey: key, disableVersionCheck: true });
  const catalog = createToolCatalog(client.getClient());
  const connections = createToolConnectionService(client, (slug) => catalog.get(slug));
  return (current = { key, client, catalog, connections });
}

export const SEARCH_CONSOLE = "google_search_console";

export async function searchConsoleAccount(userId: string) {
  if (!configuredKey()) return undefined;
  const accounts = await services().connections.activeAccounts(userId, SEARCH_CONSOLE);
  if (accounts.length > 1) {
    throw new ToolConnectionConfigurationError("Keep one active Search Console account for this campaign.");
  }
  return accounts[0]?.id;
}

export async function searchConsoleEvidence(userId: string, account: string, property: string) {
  const dateAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const start = dateAgo(31), end = dateAgo(3);
  const result = await services().client.tools.execute("GOOGLE_SEARCH_CONSOLE_SEARCH_ANALYTICS_QUERY", {
    userId,
    connectedAccountId: account,
    version: "20261116_00",
    arguments: {
      site_url: property, start_date: start, end_date: end,
      dimensions: ["query"], row_limit: 25,
    },
  }, { signal: AbortSignal.timeout(15_000) });
  if (!result.successful) {
    throw new ToolConnectionConfigurationError("Search Console could not read this property. Check its exact property ID and the connected account’s access.");
  }
  return JSON.stringify({ start, end, analytics: result.data }).slice(0, 18_000);
}

export async function toolCatalog() {
  return services().catalog;
}

export async function toolConnections() {
  return services().connections;
}

export function appOrigin() {
  const url = new URL(process.env.OMA_APP_URL ?? "http://localhost:3000");
  if (
    url.protocol !== "https:" &&
    !(
      (process.env.NODE_ENV !== "production" ||
        process.env.OMA_COOKIE_SECURE === "false") &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw new Error("Set OMA_APP_URL to your public HTTPS console URL.");
  return url.origin;
}


export async function connectionSnapshot(
  userId: string,
): Promise<ConnectionSnapshot> {
  try {
    if (!configuredKey()) return { configured: false, connected: [] };
    return await services().connections.snapshot(userId);
  } catch {
    return {
      configured: true,
      connected: [],
      error: "We couldn’t check your connections. Refresh to try again.",
    };
  }
}
