/** Displays linked brands, playbooks, and agent records from the mounted workspace. */

import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";

import type { AgentWorkspace, SavedCampaign } from "@/lib/server/agent-workspace";

export function WorkspaceIndex({ workspace }: { workspace: AgentWorkspace }) {
  return (
    <div className="workspace-index">
      {(["brands", "playbooks"] as const).map((collection) => (
        <section key={collection} aria-labelledby={"workspace-" + collection}>
          <h2 id={"workspace-" + collection}>{collection === "brands" ? "Brands" : "Playbooks"}</h2>
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

export function CampaignOverview({ workspace, campaign }: { workspace: AgentWorkspace; campaign: SavedCampaign }) {
  const playbook = workspace.playbooks.find((item) => item.id === campaign.playbookId);
  const brand = workspace.brands.find((item) => item.id === playbook?.brandId);
  const agentIds = new Set([...campaign.agentIds, ...workspace.agents.filter((agent) => agent.campaignId === campaign.id).map((agent) => agent.id)]);
  return (
    <div className="workspace-overview">
      {(playbook?.brandId || campaign.playbookId || campaign.board || campaign.model || campaign.installationState) && (
        <dl className="workspace-facts">
          {playbook?.brandId && <div><dt>Brand</dt><dd>{brand ? <Link href={"/workspace/brands/" + brand.id}>{brand.name}</Link> : playbook.brandId}</dd></div>}
          {campaign.playbookId && <div><dt>Playbook</dt><dd>{playbook ? <Link href={"/workspace/playbooks/" + playbook.id}>{playbook.name}</Link> : campaign.playbookId}</dd></div>}
          {campaign.board && <div><dt>Board</dt><dd>{campaign.board}</dd></div>}
          {campaign.installationState && <div><dt>Installation</dt><dd>{campaign.installationState === "installed" ? "Installed" : campaign.installationState === "installing" ? "Installing" : campaign.installationState}</dd></div>}
          {campaign.model && <div><dt>Campaign model</dt><dd>{campaign.model}</dd></div>}
        </dl>
      )}
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
      {!!agentIds.size && (
        <section>
          <h2>Saved agents</h2>
          <ul className="workspace-agent-list">
            {[...agentIds].map((id) => {
              const agent = workspace.agents.find((item) => item.id === id && item.campaignId === campaign.id);
              return (
                <li key={id}>
                  <h3>{agent ? <Link href={"/workspace/agents/" + agent.id}>{agent.name}<ArrowUpRight size={13} aria-hidden="true" /></Link> : id}{id === campaign.orchestrator && <span className="workspace-agent-role">Coordinator</span>}</h3>
                  {agent?.description && <p>{agent.description}</p>}
                  {agent?.model && <p>Model · {agent.model}</p>}
                  {!!agent?.skills?.length && <p>Skills · {agent.skills.join(", ")}</p>}
                  {!!agent?.toolsets.length && <p>Toolsets · {agent.toolsets.join(", ")}</p>}
                  {!!agent?.jobs.length && (
                    <ul className="workspace-copy-list">
                      {agent.jobs.map((job, index) => <li key={index}>{[job.name, job.schedule, job.timezone, job.repeat ? job.repeat + (job.repeat === 1 ? " run" : " runs") : ""].filter(Boolean).join(" · ")}</li>)}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
