/** Presents a saved agent profile, runtime configuration, and declared jobs in a single reading view. */

import Link from "next/link";
import { ArrowLeft, Bot, CalendarClock, SlidersHorizontal } from "lucide-react";

import { WorkspaceText } from "@/components/workspace-text";
import type { SavedAgent, SavedCampaign } from "@/lib/server/agent-workspace";

export function AgentProfileDetail({ agent, campaign, profile, error }: {
  agent: SavedAgent;
  campaign?: Pick<SavedCampaign, "id" | "name">;
  profile?: { content: string; html?: string };
  error?: string;
}) {
  const role = agent.id.split("__").at(-1) ?? agent.id;
  const name = agent.name === agent.id
    ? role.split(/[-_]+/).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")
    : agent.name;

  return (
    <div className="agent-playbook-page record-detail">
      <Link className="back-link" href={campaign ? "/campaigns/" + campaign.id + "?view=agents" : "/dashboard"}>
        <ArrowLeft size={14} aria-hidden="true" /> {campaign?.name || "Campaigns"}
      </Link>
      <header className="record-heading">
        <div className="record-identity">
          <span className="record-mark"><Bot size={24} aria-hidden="true" /></span>
          <div>
            <h1>{name}</h1>
            {agent.description && <p>{agent.description}</p>}
          </div>
        </div>
      </header>
      <nav className="record-tabs agent-profile-jump" aria-label="Agent sections">
        <a href="#agent-configuration">Configuration</a>
        <a href="#agent-schedule">Scheduled work</a>
      </nav>
      <div className="record-columns">
        <section className="record-reading" aria-labelledby="agent-profile-heading">
          <h2 id="agent-profile-heading">Agent profile</h2>
          {error
            ? <p className="form-error" role="alert">{error}</p>
            : <WorkspaceText text={profile?.content ?? ""} html={profile?.html} empty="No profile document saved yet." />}
        </section>
        <aside className="record-related agent-profile-related" aria-label="Agent configuration and schedule">
          <section id="agent-configuration" aria-labelledby="agent-configuration-heading" tabIndex={-1}>
            <h2 id="agent-configuration-heading"><SlidersHorizontal size={16} aria-hidden="true" /> Configuration</h2>
            <dl className="agent-profile-fields">
              <div><dt>Profile ID</dt><dd><code>{agent.id}</code></dd></div>
              {agent.model && <div><dt>Model</dt><dd><code>{agent.model}</code></dd></div>}
              {!!agent.skills?.length && <div><dt>Skills</dt><dd><AgentLabels items={agent.skills} /></dd></div>}
              {!!agent.toolsets.length && <div><dt>Toolsets</dt><dd><AgentLabels items={agent.toolsets} /></dd></div>}
            </dl>
          </section>
          <section id="agent-schedule" aria-labelledby="agent-schedule-heading" tabIndex={-1}>
            <h2 id="agent-schedule-heading"><CalendarClock size={16} aria-hidden="true" /> Scheduled work</h2>
            {agent.jobs.length ? (
              <ul className="agent-profile-jobs">
                {agent.jobs.map(({ name, schedule, timezone, repeat }, index) => (
                  <li key={index}>
                    <h3>{name || "Scheduled job"}</h3>
                    {schedule && <p>{schedule}</p>}
                    {(timezone || repeat) && <p className="agent-profile-job-details">
                      {[timezone, repeat && repeat + (repeat === 1 ? " run" : " runs")].filter(Boolean).join(" · ")}
                    </p>}
                  </li>
                ))}
              </ul>
            ) : <p className="agent-profile-note">No jobs saved for this agent.</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}

function AgentLabels({ items }: { items: string[] }) {
  return <ul className="agent-profile-labels">{items.map((item, index) => <li key={index}>{item}</li>)}</ul>;
}
