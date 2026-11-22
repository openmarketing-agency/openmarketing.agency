import "server-only";
import { requireAccessToken, requireUser } from "@/lib/dal";
import { campaignToolSlugs } from "@/lib/agent-connections";
import { listToolAssignments } from "@/lib/backend";
import { connectionSnapshot, toolCatalog, toolConnections } from "@/lib/composio";
import type { CampaignToolRecommendation, CampaignToolSuggestion } from "@/lib/campaign-tool-suggestions";
import { hostedMcpConnection } from "@/lib/mcp-client-config";
import type { Toolkit } from "@/lib/tool-catalog";
import { ToolConnectionConfigurationError } from "@/lib/tool-connection-service";

export async function loadToolWorkspace(suggestions: CampaignToolSuggestion[] = []) {
  const user = await requireUser();
  const token = await requireAccessToken();
  const [snapshot, saved] = await Promise.all([
    connectionSnapshot(user.id),
    listToolAssignments(token),
  ]);
  const assignments = saved.ok ? saved.data : [];
  const savedSlugs = new Set([
    ...assignments.map((item) => item.toolkit_slug),
    ...snapshot.connected,
    ...(snapshot.reconnect ?? []),
    ...(snapshot.pending ?? []),
  ]);
  const slugs = new Set([...savedSlugs, ...suggestions.map((item) => item.slug)]);
  const resolved = new Map<string, Toolkit | undefined>(await Promise.all(
    [...slugs].map(async (slug) => {
      try {
        return [slug, snapshot.configured ? await (await toolCatalog()).get(slug) : undefined] as const;
      } catch {
        return [slug, undefined] as const;
      }
    }),
  ));
  const recommendations: CampaignToolRecommendation[] = suggestions.map((item) => ({ ...item, tool: resolved.get(item.slug) }));
  const metadata = [...resolved].flatMap(([slug, tool]) => tool ? [tool] : savedSlugs.has(slug) ? [{
    slug, name: slug, description: "Tool details are temporarily unavailable.", categories: [], noAuth: false, toolCount: 0,
  }] : []);
  return { snapshot, assignments, metadata, recommendations, error: saved.ok ? undefined : saved.error.message };
}

/** Resolve the hosted URL from the owner’s current campaign assignments during a save. */
export async function generateCampaignMcpUrl(id: string, userId: string): Promise<{ url: string } | { error: string }> {
  const saved = await listToolAssignments(await requireAccessToken());
  if (!saved.ok) return { error: saved.error.message };
  const slugs = campaignToolSlugs(id, saved.data);
  if (!slugs.length) return { url: "" };

  try {
    const session = await (await toolConnections()).mcpSession(userId, slugs);
    return { url: hostedMcpConnection(session.mcp).url };
  } catch (error) {
    if (error instanceof ToolConnectionConfigurationError
      || (error instanceof Error && error.message.startsWith("Connect or remove"))) {
      return { error: error.message };
    }
    return { error: "Couldn’t set up Composio for this campaign. Check the campaign’s tools and try again." };
  }
}
