/** Lists the saved campaigns and filters them by campaign, brand, or playbook. */

"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Search, Users } from "lucide-react";

type SavedCampaignSummary = {
  id: string;
  name: string;
  description: string;
  version: string;
  agentCount: number;
  playbook?: { id: string; name: string };
  brand?: { id: string; name: string };
};

export function CampaignLibrary({ setup, sidebar, notice, saved }: {
  setup?: ReactNode;
  sidebar?: ReactNode;
  notice?: ReactNode;
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
        {setup}
      </header>
      <div className="campaign-dashboard-layout">
        <section className="campaign-library" aria-label="Saved campaigns">
          {notice}
          {!!saved?.length && (
            <div className="campaign-search">
              <label className="search-box">
                <Search size={16} aria-hidden="true" />
                <input ref={search} type="search" aria-label="Search campaigns" placeholder="Search campaigns…"
                  value={query} onChange={(event) => setQuery(event.target.value)} />
              </label>
              <span role="status">
                {normalizedQuery ? filtered.length + " of " : ""}{saved.length} {saved.length === 1 ? "campaign" : "campaigns"}
              </span>
            </div>
          )}
          {filtered.length > 0 && (
            <ul className="campaign-list">
              {filtered.map(({ id, name, description, version, brand, playbook, agentCount }) => (
                <li className="campaign-entry" key={id}>
                  <h2>
                    <Link className="campaign-entry-link" href={"/campaigns/" + id}>
                      <span>{name}</span><ArrowRight size={18} aria-hidden="true" />
                    </Link>
                  </h2>
                  {description && <p>{description}</p>}
                  <div className="campaign-entry-context">
                    <span className="campaign-agent-count"><Users size={14} aria-hidden="true" />{agentCount} {agentCount === 1 ? "agent" : "agents"}</span>
                    {brand && <Link href={"/workspace/brands/" + brand.id}>{brand.name}</Link>}
                    {playbook && <Link href={"/workspace/playbooks/" + playbook.id}>{playbook.name}</Link>}
                    {version && <span className="version-label">v{version}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {saved?.length === 0 && (
            <div className="empty-state campaign-empty">
              <h2>No campaigns yet</h2>
              <p>Campaigns will appear here when oma-agent saves them.</p>
            </div>
          )}
          {!!saved?.length && filtered.length === 0 && (
            <div className="empty-state campaign-empty">
              <h2>No matching campaigns</h2>
              <p>Try a campaign, brand, or playbook name.</p>
              <button className="btn secondary" onClick={() => { setQuery(""); search.current?.focus(); }}>Clear search</button>
            </div>
          )}
        </section>
        {sidebar && <aside className="campaign-dashboard-sidebar" aria-label="Workspace activity and records">{sidebar}</aside>}
      </div>
    </div>
  );
}
