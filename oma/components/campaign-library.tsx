"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Search, Users, Workflow } from "lucide-react";

type SavedCampaignSummary = {
  id: string;
  name: string;
  description: string;
  version: string;
  agentCount: number;
  playbook?: { id: string; name: string };
  brand?: { id: string; name: string };
};

export function CampaignLibrary({ setup, saved }: {
  setup?: ReactNode;
  saved?: SavedCampaignSummary[];
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.toLowerCase().trim();
  const filtered = saved?.filter(({ name, description, brand, playbook }) =>
    [name, description, brand?.name, playbook?.name].join(" ").toLowerCase().includes(normalizedQuery),
  ) ?? [];

  return (
    <div className="agent-library-page">
      <header className="agent-library-heading">
        <h1>Campaigns</h1>
      </header>
      {setup}
      {saved && saved.length > 0 && (
        <div className="agent-library-toolbar">
          <h2>Your campaigns</h2>
          <label className="search-box">
            <Search size={15} aria-hidden="true" />
            <input
              aria-label="Search campaigns"
              placeholder="Search campaigns…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
      )}
      {filtered.map(({ id, name, description, version, brand, playbook, agentCount }) => (
        <article className="agent-library-card" key={id}>
          <div className="agent-library-card-main">
            <span className="playbook-mark"><Workflow size={26} strokeWidth={1.5} aria-hidden="true" /></span>
            <div>
              <div className="agent-title-line">
                <h2>{name}</h2>
                {version && <span className="version-label">v{version}</span>}
              </div>
              {description && <p>{description}</p>}
              {(brand || playbook) && (
                <div className="workspace-card-links">
                  {brand && <Link href={"/workspace/brands/" + brand.id}>{brand.name}</Link>}
                  {playbook && <Link href={"/workspace/playbooks/" + playbook.id}>{playbook.name}</Link>}
                </div>
              )}
              <span className="agent-library-count">
                <Users size={14} aria-hidden="true" />
                {agentCount} {agentCount === 1 ? "agent" : "agents"}
              </span>
            </div>
            <Link className="btn primary" href={"/campaigns/" + id}>
              View campaign <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </article>
      ))}
      {saved?.length === 0 && (
        <div className="empty-state">
          <h2>No campaigns yet</h2>
          <p>Campaigns will appear here when oma-agent saves them.</p>
        </div>
      )}
      {saved && saved.length > 0 && filtered.length === 0 && (
        <div className="empty-state">
          <h2>No matching campaigns</h2>
          <p>Try a campaign, brand, or playbook name.</p>
          <button className="btn secondary" onClick={() => setQuery("")}>Clear search</button>
        </div>
      )}
    </div>
  );
}
