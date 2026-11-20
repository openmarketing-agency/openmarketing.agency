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
  return (current = { key, catalog, connections });
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
