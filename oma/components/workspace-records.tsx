/** Displays linked brands, playbooks, and agent records from the mounted workspace. */

import Link from "next/link";
import { ArrowRight, BookOpen, Tag } from "lucide-react";

import type { AgentWorkspace, SavedCampaign } from "@/lib/server/agent-workspace";

export function WorkspaceIndex({ workspace }: { workspace: AgentWorkspace }) {
  return (
    <div className="workspace-index">
      {(["brands", "playbooks"] as const).map((collection) => (
        <section key={collection} aria-labelledby={"workspace-" + collection}>
          <h2 id={"workspace-" + collection}>{collection === "brands" ? <><Tag size={16} aria-hidden="true" />Brands</> : <><BookOpen size={16} aria-hidden="true" />Playbooks</>}</h2>
          {workspace[collection].length ? (
            <ul className="workspace-link-list">
              {workspace[collection].map((item) => (
                <li key={item.id}>
                  <Link href={"/workspace/" + collection + "/" + item.id}>
                    {item.name}<ArrowRight size={15} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p>No {collection} saved yet.</p>}
        </section>
      ))}
      {workspace.skipped > 0 && (
        <p role="status">{workspace.skipped} workspace {workspace.skipped === 1 ? "record could" : "records could"} not be read.</p>
      )}
    </div>
  );
}

/** Includes both the campaign's declared agents and any additional agent records saved for it. */
export function campaignAgentIds(workspace: AgentWorkspace, campaign: SavedCampaign) {
  return [...new Set([
    ...campaign.agentIds,
    ...workspace.agents.filter((agent) => agent.campaignId === campaign.id).map((agent) => agent.id),
  ])];
}

export function campaignLifecycleLabel(campaign: SavedCampaign) {
  if (campaign.installationState === "installing") return "Setup incomplete";
  if (campaign.lifecycleState === "pausing") return "Pausing…";
  if (campaign.lifecycleState === "resumed" || (!campaign.lifecycleState && campaign.installationState === "installed")) return "Running";
  return campaign.installationState === "installed" ? "Paused" : "Draft";
}

export function CampaignOverview({ workspace, campaign }: { workspace: AgentWorkspace; campaign: SavedCampaign }) {
  const playbook = workspace.playbooks.find((item) => item.id === campaign.playbookId);
  const brand = workspace.brands.find((item) => item.id === playbook?.brandId);
  const hasPlan = campaign.goals.length > 0 || campaign.plans.length > 0;
  const hasDetails = Boolean(playbook?.brandId || campaign.playbookId || campaign.board || campaign.model);
  return (
    <div className="campaign-overview">
      {hasPlan && (
        <div className="campaign-reading">
          {campaign.goals.length > 0 && (
            <section>
              <h2>Goals</h2>
              <ul className="workspace-copy-list">{campaign.goals.map((goal, index) => <li key={index}>{goal}</li>)}</ul>
            </section>
          )}
          {campaign.plans.length > 0 && (
            <section>
              <h2>Plans</h2>
              <ol className="workspace-copy-list">{campaign.plans.map((plan, index) => <li key={index}>{plan}</li>)}</ol>
            </section>
          )}
        </div>
      )}
      {hasDetails && (
        <aside className="campaign-context" aria-labelledby="campaign-context-heading">
          <h2 id="campaign-context-heading">Campaign details</h2>
          <dl>
            {playbook?.brandId && <div><dt>Brand</dt><dd>{brand ? (
              <Link href={"/workspace/brands/" + brand.id}>{brand.name}<ArrowRight size={15} aria-hidden="true" /></Link>
            ) : playbook.brandId}</dd></div>}
            {campaign.playbookId && <div><dt>Playbook</dt><dd>{playbook ? (
              <Link href={"/workspace/playbooks/" + playbook.id}>{playbook.name}<ArrowRight size={15} aria-hidden="true" /></Link>
            ) : campaign.playbookId}</dd></div>}
            {campaign.board && <div><dt>Board</dt><dd>{campaign.board}</dd></div>}
            {campaign.model && <div><dt>Campaign model</dt><dd>{campaign.model}</dd></div>}
          </dl>
        </aside>
      )}
      {!hasPlan && !hasDetails && <p className="campaign-placeholder">No campaign details saved yet.</p>}
    </div>
  );
}

export function CampaignAgents({ workspace, campaign, ids }: {
  workspace: AgentWorkspace;
  campaign: SavedCampaign;
  ids: string[];
}) {
  const agentsById = new Map(workspace.agents.filter(({ campaignId }) => campaignId === campaign.id).map((agent) => [agent.id, agent]));
  return (
    <section className="campaign-roster" aria-labelledby="campaign-agents-heading">
      <h2 id="campaign-agents-heading">Campaign agents</h2>
      {ids.length === 0 ? <p className="campaign-placeholder">No agents saved for this campaign yet.</p> : (
        <ul className="campaign-agent-list">
          {ids.map((id) => {
            const agent = agentsById.get(id);
            return (
              <li key={id} className="campaign-agent">
                <div className="campaign-agent-title">
                  <h3>{agent ? <Link href={"/workspace/agents/" + agent.id}>{agent.name}<ArrowRight size={16} aria-hidden="true" /></Link> : id}</h3>
                  {id === campaign.orchestrator && <span className="campaign-coordinator">Coordinator</span>}
                </div>
                {agent?.description && <p>{agent.description}</p>}
                {(agent?.model || !!agent?.skills?.length || !!agent?.toolsets.length) && (
                  <dl className="campaign-agent-metadata">
                    {agent?.model && <div><dt>Model</dt><dd>{agent.model}</dd></div>}
                    {!!agent?.skills?.length && <div><dt>Skills</dt><dd>{agent.skills.join(", ")}</dd></div>}
                    {!!agent?.toolsets.length && <div><dt>Toolsets</dt><dd>{agent.toolsets.join(", ")}</dd></div>}
                  </dl>
                )}
                {!!agent?.jobs.length && (
                  <div className="campaign-agent-jobs">
                    <h4>Scheduled work</h4>
                    <ul className="workspace-copy-list">
                      {agent.jobs.map(({ name, schedule, timezone, repeat }, index) => (
                        <li key={index}>{[name, schedule, timezone, repeat && repeat + (repeat === 1 ? " run" : " runs")]
                          .filter(Boolean).join(" · ")}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
