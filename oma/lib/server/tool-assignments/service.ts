/** Stores campaign and workspace tool selections while preserving the legacy specialist API. */

import { CAMPAIGN_SCOPE, WORKSPACE_SCOPE, type ToolAssignment } from "@/lib/agent-connections";
import { getDb } from "@/lib/db";
import { loadAgentWorkspace, workspaceId } from "@/lib/server/agent-workspace";
import { validToolkitSlug } from "@/lib/tool-catalog";

import { ErrorCode, apiError } from "../common/api-error";

const SPECIALISTS = new Set(["researcher", "writer", "humanizer", "verifier", "publisher"]);

export function listAssignments(userId: string): ToolAssignment[] {
  return getDb().prepare(`
    SELECT playbook_id, agent_id, toolkit_slug FROM tool_assignments
    WHERE user_id = ? ORDER BY playbook_id, agent_id, toolkit_slug
  `).all(userId) as unknown as ToolAssignment[];
}

export async function saveAssignment(userId: string, campaignId: string, scope: string, slug: string, assigned: boolean) {
  const isCampaign = scope === CAMPAIGN_SCOPE;
  const legacy = (campaignId === "seo" && SPECIALISTS.has(scope))
    || (campaignId === WORKSPACE_SCOPE.playbookId && scope === WORKSPACE_SCOPE.agentId);
  if ((!isCampaign && !legacy) || !workspaceId.safeParse(campaignId).success || !validToolkitSlug(slug)) {
    throw apiError(422, ErrorCode.INVALID_TOOL_ASSIGNMENT);
  }
  if (isCampaign && assigned) {
    const { records, error } = await loadAgentWorkspace();
    if (error) throw apiError(503, error);
    if (!records?.campaigns.some((campaign) => campaign.id === campaignId)) {
      throw apiError(404, "Campaign not found.");
    }
  }

  const db = getDb();
  if (assigned) {
    db.prepare(`
      INSERT INTO tool_assignments (user_id, playbook_id, agent_id, toolkit_slug) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, playbook_id, agent_id, toolkit_slug) DO NOTHING
    `).run(userId, campaignId, scope, slug);
  } else if (isCampaign) {
    // Replace specialist selections as a group, preserving the separate workspace connection.
    db.prepare(`
      DELETE FROM tool_assignments WHERE user_id = ? AND playbook_id = ? AND toolkit_slug = ?
        AND NOT (playbook_id = ? AND agent_id = ?)
    `).run(userId, campaignId, slug, WORKSPACE_SCOPE.playbookId, WORKSPACE_SCOPE.agentId);
  } else {
    db.prepare(`
      DELETE FROM tool_assignments WHERE user_id = ? AND playbook_id = ? AND agent_id = ? AND toolkit_slug = ?
    `).run(userId, campaignId, scope, slug);
  }
}
