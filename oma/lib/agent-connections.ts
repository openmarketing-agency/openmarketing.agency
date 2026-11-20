import { findCampaign, findCampaignAgent } from "./campaigns.ts";
import { validToolkitSlug } from "./tool-catalog.ts";
export type AgentConnectionScope = { playbookId: string; agentId: string };
export type ToolAssignment = {
  playbook_id: string;
  agent_id: string;
  toolkit_slug: string;
};
export const WORKSPACE_SCOPE = {
  playbookId: "workspace",
  agentId: "connections",
};
export function agentConnectionContext(
  ownerId: string,
  scope: AgentConnectionScope,
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
  scope: AgentConnectionScope,
  slug: string,
) {
  if (!validToolkitSlug(slug)) throw new Error("Choose a supported tool.");
  return agentConnectionContext(ownerId, scope);
}
export function connectionScope(ownerId: string, scope = WORKSPACE_SCOPE) {
  if (
    scope.playbookId === WORKSPACE_SCOPE.playbookId &&
    scope.agentId === WORKSPACE_SCOPE.agentId
  )
    return { connectionUserId: ownerId, returnTo: "/connections" };
  return agentConnectionContext(ownerId, scope);
}
export function assignedToolSlugs(
  assignments: ToolAssignment[],
  scope: AgentConnectionScope,
) {
  return [
    ...new Set(
      assignments
        .filter(
          (item) =>
            item.playbook_id === scope.playbookId &&
            item.agent_id === scope.agentId,
        )
        .map((item) => item.toolkit_slug),
    ),
  ];
}
export function campaignToolSlugs(
  playbookId: string,
  assignments: ToolAssignment[],
) {
  const campaign = findCampaign(playbookId);
  if (!campaign) throw new Error("Campaign not found.");
  const specialists = campaign.agents
    .filter((agent) => agent.id !== "default")
    .map((agent) => agent.id);
  return [
    ...new Set(
      assignments
        .filter(
          (item) =>
            item.playbook_id === playbookId &&
            specialists.includes(item.agent_id),
        )
        .map((item) => item.toolkit_slug),
    ),
  ];
}
