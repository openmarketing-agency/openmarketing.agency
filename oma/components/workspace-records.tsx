/** Displays linked brands, playbooks, and agent records from the mounted workspace. */

import Link from "next/link";
import { ArrowRight, BookOpen, Tag } from "lucide-react";

import type { AgentWorkspace, SavedCampaign } from "@/lib/server/agent-workspace";
import { describeSchedule } from "@/lib/job-schedule";
import { MarkdownInline } from "@/components/workspace-document";
import { agentDisplayName, agentInitials } from "@/lib/agent-name";

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
        <div className="campaign-reading campaign-plan-reading">
          {campaign.goals.length > 0 && (
            <section aria-labelledby="campaign-goals-heading">
              <h2 id="campaign-goals-heading">Goals</h2>
              <ul className="campaign-goal-list">{campaign.goals.map((goal, index) => (
                <li key={index}><MarkdownInline text={goal} /></li>
              ))}</ul>
            </section>
          )}
          {campaign.plans.length > 0 && (
            <section aria-labelledby="campaign-steps-heading">
              <h2 id="campaign-steps-heading">Plan steps</h2>
              <ol className="campaign-step-list">{campaign.plans.map((plan, index) => (
                <li key={index}><span><MarkdownInline text={plan} /></span></li>
              ))}</ol>
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

type CampaignAgent = AgentWorkspace["agents"][number];

function plural(count: number, word: string) {
  return count + " " + word + (count === 1 ? "" : "s");
}

function AgentChips({ items }: { items: string[] }) {
  return <ul className="campaign-agent-chips">{items.map((item, index) => <li key={index}>{item}</li>)}</ul>;
}

function CampaignAgentCard({ id, agent, coordinator }: { id: string; agent?: CampaignAgent; coordinator: boolean }) {
  const name = agent ? agentDisplayName(agent) : agentDisplayName({ id, name: id });
  const skills = agent?.skills ?? [];
  const toolsets = agent?.toolsets ?? [];
  return (
    <li className="campaign-agent-card" data-coordinator={coordinator || undefined} data-missing={agent ? undefined : true}>
      <div className="campaign-agent-head">
        <span className="campaign-agent-avatar" aria-hidden="true">{agentInitials(name)}</span>
        <div className="campaign-agent-title">
          <h3>{agent
            ? <Link href={"/workspace/agents/" + agent.id}>{name}<ArrowRight size={15} aria-hidden="true" /></Link>
            : name}</h3>
          <code>{id}</code>
        </div>
        {coordinator && <span className="campaign-coordinator">Coordinator</span>}
      </div>
      {agent?.description
        ? <div className="campaign-agent-description"><MarkdownInline text={agent.description} /></div>
        : !agent && <p className="campaign-agent-description">No profile is saved for this agent yet.</p>}
      {(agent?.model || skills.length > 0 || toolsets.length > 0) && (
        <dl className="campaign-agent-facts">
          {agent?.model && <div><dt>Model</dt><dd><code>{agent.model}</code></dd></div>}
          {skills.length > 0 && <div><dt>Skills</dt><dd><AgentChips items={skills} /></dd></div>}
          {toolsets.length > 0 && <div><dt>Tools</dt><dd><AgentChips items={toolsets} /></dd></div>}
        </dl>
      )}
      {!!agent?.jobs.length && (
        <div className="campaign-agent-jobs">
          <h4>Scheduled work</h4>
          <ul>
            {agent.jobs.map(({ name: job, schedule, timezone, repeat }, index) => (
              <li key={index} title={schedule || undefined}>
                <strong>{job || "Scheduled job"}</strong>
                <span>{[schedule && describeSchedule(schedule), timezone, repeat && repeat + (repeat === 1 ? " run" : " runs")].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

export function CampaignAgents({ workspace, campaign, ids }: {
  workspace: AgentWorkspace;
  campaign: SavedCampaign;
  ids: string[];
}) {
  const agentsById = new Map(workspace.agents.filter(({ campaignId }) => campaignId === campaign.id).map((agent) => [agent.id, agent]));
  // The coordinator leads the team, so it comes first; the rest keep their saved order.
  const ordered = [...ids.filter((id) => id === campaign.orchestrator), ...ids.filter((id) => id !== campaign.orchestrator)];
  const jobs = ids.reduce((total, id) => total + (agentsById.get(id)?.jobs.length ?? 0), 0);
  return (
    <section className="campaign-roster" aria-labelledby="campaign-agents-heading">
      <header className="campaign-roster-heading">
        <h2 id="campaign-agents-heading">Campaign agents</h2>
        {ids.length > 0 && <p>{plural(ids.length, "agent")} · {plural(jobs, "scheduled job")}</p>}
      </header>
      {ids.length === 0 ? <p className="campaign-placeholder">No agents saved for this campaign yet.</p> : (
        <ul className="campaign-agent-grid">
          {ordered.map((id) => <CampaignAgentCard key={id} id={id} agent={agentsById.get(id)} coordinator={id === campaign.orchestrator} />)}
        </ul>
      )}
    </section>
  );
}
