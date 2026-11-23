/** Resolves campaign and workspace tool scopes while accepting legacy specialist selections. */

import { findCampaignAgent } from "./campaigns.ts";
import { validToolkitSlug } from "./tool-catalog.ts";
export type ToolConnectionScope = { playbookId: string; agentId: string };
export const WORKSPACE_SCOPE = {
  playbookId: "workspace",
  agentId: "connections",
};
export const CAMPAIGN_SCOPE = "campaign";
export const CAMPAIGN_CATALOG_SCOPE = "campaign-catalog";
const scopeId = /^[a-z0-9]+(?:[-_][a-z0-9]+|__[a-z0-9]+)*$/;

export function campaignConnectionScope(campaignId: string, catalog = false): ToolConnectionScope {
  return { playbookId: campaignId, agentId: catalog ? CAMPAIGN_CATALOG_SCOPE : CAMPAIGN_SCOPE };
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
  if (scope.agentId === CAMPAIGN_SCOPE || scope.agentId === CAMPAIGN_CATALOG_SCOPE) {
    if (typeof scope.playbookId !== "string" || scope.playbookId.length > 64 || !scopeId.test(scope.playbookId)) {
      throw new Error("Choose a saved campaign.");
    }
    const list = scope.agentId === CAMPAIGN_CATALOG_SCOPE ? "&tool_list=catalog" : "";
    return { connectionUserId: ownerId, returnTo: "/campaigns/" + scope.playbookId + "?view=tools" + list };
  }
  return agentConnectionContext(ownerId, scope);
}
