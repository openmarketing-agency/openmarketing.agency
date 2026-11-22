import "server-only";
import { requireAccessToken, requireUser } from "@/lib/dal";
import { listToolAssignments } from "@/lib/backend";
import { connectionSnapshot, toolCatalog } from "@/lib/composio";
import type { CampaignToolRecommendation, CampaignToolSuggestion } from "@/lib/campaign-tool-suggestions";
import type { Toolkit } from "@/lib/tool-catalog";

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
