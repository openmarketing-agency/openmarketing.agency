/** Lists the saved campaigns and filters them by campaign, brand, or playbook. */

"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Search, Users } from "lucide-react";

import { CampaignKanban } from "@/components/campaign-kanban";
import type { CampaignKanbanStatus } from "@/lib/server/agent-workspace";

type SavedCampaignSummary = {
  id: string;
  name: string;
  description: string;
  version: string;
  agentCount: number;
  status?: string;
  kanban?: CampaignKanbanStatus;
  playbook?: { id: string; name: string };
  brand?: { id: string; name: string };
};

export function CampaignLibrary({ setup, sidebar, error, saved }: {
  setup?: { needsRetry: boolean };
  sidebar?: ReactNode;
  error?: string;
  saved?: SavedCampaignSummary[];
}) {
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.toLowerCase().trim();
  const filtered = saved?.filter(({ name, description, brand, playbook }) =>
    [name, description, brand?.name, playbook?.name].join(" ").toLowerCase().includes(normalizedQuery),
  ) ?? [];

  return (
    <div className="agent-library-page campaign-page">
      <header className="campaign-heading">
        <h1>Campaigns</h1>
        <p>Plan work, configure your agents, and review what’s ready to deploy.</p>
      </header>
      {setup && (
        <section className="campaign-setup" aria-labelledby="campaign-setup-heading">
          <div>
            <h2 id="campaign-setup-heading">{setup.needsRetry ? "Finish sending your project" : "Start with your project"}</h2>
            <p>{setup.needsRetry
              ? "Your project links are saved. Reopen setup to send them to oma-agent."
              : "Share a website or GitHub repository so oma-agent has context to plan your campaigns."}</p>
            <Link className="btn primary" href="/onboarding">
              {setup.needsRetry ? "Finish project setup" : "Set up your project"}<ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <ol aria-label="Campaign workflow">
            <li>{setup.needsRetry ? "Project links saved" : "Share your project links"}</li>
            <li>Review the saved campaign plan</li>
            <li>Configure agents and deploy</li>
          </ol>
        </section>
      )}
      <div className="campaign-dashboard-layout">
        <section className="campaign-library" aria-labelledby="saved-campaigns-heading">
          <h2 id="saved-campaigns-heading">Saved campaigns</h2>
          {!!saved?.length && (
            <div className="campaign-search">
              <label className="search-box">
                <Search size={16} aria-hidden="true" />
                <input ref={search} type="search" aria-label="Search campaigns" placeholder="Search by campaign, brand, or playbook"
                  value={query} onChange={(event) => setQuery(event.target.value)} />
              </label>
              <span role="status">
                {normalizedQuery ? filtered.length + " of " : ""}{saved.length} {saved.length === 1 ? "campaign" : "campaigns"}
              </span>
            </div>
          )}
          {filtered.length > 0 && (
            <ul className="campaign-list">
              {filtered.map(({ id, name, description, version, brand, playbook, agentCount, status, kanban }) => (
                <li className="campaign-entry" key={id}>
                  <h3>
                    <Link className="campaign-entry-link" href={"/campaigns/" + id}>
                      <span>{name}</span><ArrowRight size={18} aria-hidden="true" />
                    </Link>
                  </h3>
                  {description && <p>{description}</p>}
                  <div className="campaign-entry-context">
                    {status && <span className="campaign-deployment-status" data-state={status}>{status}</span>}
                    <span className="campaign-agent-count"><Users size={14} aria-hidden="true" />{agentCount} {agentCount === 1 ? "agent" : "agents"}</span>
                    {brand && <Link href={"/workspace/brands/" + brand.id}>{brand.name}</Link>}
                    {playbook && <Link href={"/workspace/playbooks/" + playbook.id}>{playbook.name}</Link>}
                    {version && <span className="version-label">v{version}</span>}
                  </div>
                  {kanban && <CampaignKanban status={kanban} />}
                </li>
              ))}
            </ul>
          )}
          {saved?.length === 0 && (
            <div className="empty-state campaign-empty">
              <h3>No campaigns yet</h3>
              <p>Campaigns appear here when oma-agent saves them.</p>
            </div>
          )}
          {!saved && (
            <div className="empty-state campaign-empty">
              <h3>Campaign workspace unavailable</h3>
              <p role={error ? "alert" : undefined}>{error ?? "Start the full Docker stack to access saved campaigns."}</p>
            </div>
          )}
          {!!saved?.length && filtered.length === 0 && (
            <div className="empty-state campaign-empty">
              <h3>No matching campaigns</h3>
              <p>Try a campaign, brand, or playbook name.</p>
              <button className="btn secondary" onClick={() => { setQuery(""); search.current?.focus(); }}>Clear search</button>
            </div>
          )}
        </section>
        {sidebar && <aside className="campaign-dashboard-sidebar" aria-label="Workspace records">{sidebar}</aside>}
      </div>
    </div>
  );
}
