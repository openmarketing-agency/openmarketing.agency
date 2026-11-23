import "server-only";
import { requireUser } from "@/lib/dal";
import { connectionSnapshot, toolCatalog, toolConnections } from "@/lib/composio";
import { hostedMcpConnection } from "@/lib/mcp-client-config";
import type { Toolkit } from "@/lib/tool-catalog";
import { ToolConnectionConfigurationError } from "@/lib/tool-connection-service";
import {
  importWorkspaceToolSelections,
  readWorkspaceToolSelections,
  WorkspaceRequestError,
  writeWorkspaceToolSelection,
  type RequiredIntegration,
  type WorkspaceToolSelections,
} from "@/lib/server/agent-workspace";
import { migrateLegacyToolSelections } from "@/lib/server/legacy-tool-selections";

function selectedTools(selections: WorkspaceToolSelections): string[] {
  return [...new Set([...selections.workspace, ...Object.values(selections.campaigns).flat()])];
}

export async function readSelectedToolSlugs(): Promise<string[]> {
  await migrateLegacyToolSelections(importWorkspaceToolSelections);
  // A console-only installation can still manage Composio accounts.
  if (!process.env.OMA_WORKSPACE_SOCKET) return [];
  return selectedTools(await readWorkspaceToolSelections());
}

export async function changeToolSelection(slug: string, selected: boolean): Promise<string[]> {
  await migrateLegacyToolSelections(importWorkspaceToolSelections);
  return selectedTools(await writeWorkspaceToolSelection(null, slug, selected));
}

export function selectionError(error: unknown): string {
  if (error instanceof WorkspaceRequestError && error.status === 404 && error.message === "Unknown workspace request.") {
    return "Rebuild the OMA VM to use workspace tool selections.";
  }
  return error instanceof WorkspaceRequestError ? error.message
    : "Couldn’t load or save tool selections. Check that the OMA workspace is available and try again.";
}

async function resolveToolMetadata(slugs: Set<string>, configured: boolean): Promise<Toolkit[]> {
  if (!configured || !slugs.size) return [];
  const catalog = await toolCatalog();
  const tools = await Promise.all([...slugs].map((slug) => catalog.get(slug).catch(() => undefined)));
  return tools.filter((tool) => tool !== undefined);
}

export async function loadToolWorkspace() {
  const user = await requireUser();
  const [snapshot, saved] = await Promise.all([
    connectionSnapshot(user.id),
    readSelectedToolSlugs().then(
      (selected) => ({ selected, error: undefined }),
      (error: unknown) => ({ selected: [], error: selectionError(error) }),
    ),
  ]);
  const slugs = new Set([...saved.selected, ...snapshot.connected, ...(snapshot.reconnect ?? []), ...(snapshot.pending ?? [])]);
  const metadata = await resolveToolMetadata(slugs, snapshot.configured);
  return { snapshot, selected: saved.selected, metadata, error: saved.error };
}

export async function loadCampaignTools(required: RequiredIntegration[] = []) {
  const user = await requireUser();
  const snapshot = await connectionSnapshot(user.id);
  const slugs = new Set(required.flatMap(({ slug }) => slug ? [slug] : []));
  return { snapshot, metadata: await resolveToolMetadata(slugs, snapshot.configured) };
}

/** Build a campaign’s hosted MCP session from the integrations in its saved record. */
export async function generateCampaignMcpUrl(
  userId: string, required: RequiredIntegration[],
): Promise<{ url: string } | { error: string }> {
  const unsupported = required.filter(({ slug }) => !slug);
  if (unsupported.length) {
    return { error: "There’s no verified Composio toolkit for these required integrations: "
      + unsupported.map(({ name }) => name).join(", ") + "." };
  }
  const requiredSlugs = required.flatMap(({ slug }) => slug ? [slug] : []);
  if (!requiredSlugs.length) return { url: "" };

  try {
    const session = await (await toolConnections()).mcpSession(userId, requiredSlugs);
    return { url: hostedMcpConnection(session.mcp).url };
  } catch (error) {
    if (error instanceof ToolConnectionConfigurationError) {
      return { error: error.message };
    }
    return { error: "Couldn’t set up Composio for this campaign. Check the campaign’s tools and try again." };
  }
}
