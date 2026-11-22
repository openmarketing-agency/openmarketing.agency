/** Resolves campaign and workspace tool scopes while accepting legacy specialist selections. */

import { findCampaign, findCampaignAgent } from "./campaigns.ts";
import { validToolkitSlug } from "./tool-catalog.ts";
export type ToolConnectionScope = { playbookId: string; agentId: string };
export type ToolAssignment = {
  playbook_id: string;
  agent_id: string;
  toolkit_slug: string;
};
export const WORKSPACE_SCOPE = {
  playbookId: "workspace",
  agentId: "connections",
};
export const CAMPAIGN_SCOPE = "campaign";
const scopeId = /^[a-z0-9]+(?:[-_][a-z0-9]+|__[a-z0-9]+)*$/;

export function campaignConnectionScope(campaignId: string): ToolConnectionScope {
  return { playbookId: campaignId, agentId: CAMPAIGN_SCOPE };
}

export function isWorkspaceScope(scope: ToolConnectionScope) {
  return scope.playbookId === WORKSPACE_SCOPE.playbookId && scope.agentId === WORKSPACE_SCOPE.agentId;
}

export function agentConnectionContext(
  ownerId: string,
  scope: ToolConnectionScope,
) {
  const agent = findCampaignAgent(scope.playbookId, scope.agentId);
  if (!agent || agent.id === "default")
    throw new Error("Choose a specialist with tool connections.");
  return {
    agent,
    connectionUserId: ownerId,
    returnTo: `/campaigns/${scope.playbookId}?agent=${agent.id}`,
  };
}
export function requireAgentTool(
  ownerId: string,
  scope: ToolConnectionScope,
  slug: string,
) {
  if (!validToolkitSlug(slug)) throw new Error("Choose a supported tool.");
  return agentConnectionContext(ownerId, scope);
}
export function connectionScope(ownerId: string, scope = WORKSPACE_SCOPE) {
  if (isWorkspaceScope(scope)) return { connectionUserId: ownerId, returnTo: "/connections" };
  if (scope.agentId === CAMPAIGN_SCOPE) {
    if (typeof scope.playbookId !== "string" || scope.playbookId.length > 64 || !scopeId.test(scope.playbookId)) {
      throw new Error("Choose a saved campaign.");
    }
    return { connectionUserId: ownerId, returnTo: "/campaigns/" + scope.playbookId + "?view=tools" };
  }
  return agentConnectionContext(ownerId, scope);
}

export function campaignToolSlugs(campaignId: string, assignments: ToolAssignment[]) {
  const legacy = new Set(findCampaign(campaignId)?.agents
    .filter((agent) => agent.id !== "default").map((agent) => agent.id));
  return [...new Set(assignments
    .filter((item) => item.playbook_id === campaignId && (item.agent_id === CAMPAIGN_SCOPE || legacy.has(item.agent_id)))
    .map((item) => item.toolkit_slug))];
}
