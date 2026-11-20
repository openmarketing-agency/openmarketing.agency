"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, Search, Users, Workflow } from "lucide-react";
import { campaigns, campaignTools, tools } from "@/lib/campaigns";
import { AgentIcon } from "@/components/agent-icon";

export function CampaignLibrary({ demo = false, setup }: { demo?: boolean; setup?: ReactNode }) {
  const [query, setQuery] = useState("");
  const filtered = campaigns.filter((p) =>
    `${p.title} ${p.description} ${p.agents.map((agent) => agent.role).join(" ")} ${campaignTools(
      p,
    )
      .map((id) => tools[id].name)
      .join(" ")}`
      .toLowerCase()
      .includes(query.toLowerCase().trim()),
  );
  return (
    <div className="agent-library-page">
      <header className="agent-library-heading">
        <div>
          <h1>Campaigns</h1>
          <p>A focused team of agents, with the right tools for every role.</p>
        </div>
        <span className="subtle-tag">
          <BookOpen size={14} />
          {campaigns.length} {campaigns.length === 1 ? "campaign" : "campaigns"}
        </span>
      </header>
      {setup}
      <div className="agent-library-toolbar">
        <h2>Your campaigns</h2>
        <label className="search-box">
          <Search size={15} />
          <input
            aria-label="Search campaigns"
            placeholder="Search campaigns…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      {filtered.map((p) => (
        <article className="agent-library-card" key={p.id}>
          <div className="agent-library-card-main">
            <span className="playbook-mark">
              <Workflow size={26} strokeWidth={1.5} />
            </span>
            <div>
              <div className="agent-title-line">
                <h2>{p.title}</h2>
                <span className="version-label">v{p.version}</span>
              </div>
              <p>{p.description}</p>
              <span className="agent-library-count">
                <Users size={14} />
                One mission owner · {p.agents.length - 1} specialists
              </span>
            </div>
            <Link
              className="btn primary"
              href={`${demo ? "/demo" : ""}/campaigns/${p.id}`}
            >
              Configure team
              <ArrowRight size={15} />
            </Link>
          </div>
          <div className="agent-library-roster">
            {p.agents.map((agent) => (
              <div key={agent.id}>
                <AgentIcon id={agent.id} size={16} />
                <span>
                  <strong>
                    {agent.id === "default" ? "Mission owner" : agent.role}
                  </strong>
                  <small>
                    {agent.tools.length
                      ? agent.tools
                          .slice(0, 2)
                          .map((tool) => tools[tool.id].short)
                          .join(" + ")
                      : "No tool connections"}
                  </small>
                </span>
              </div>
            ))}
          </div>
          <footer>
            <span>
              Suggested tools for each role. Explore the full catalog in
              Connections.
            </span>
            <Link href={`${demo ? "/demo" : ""}/campaigns/${p.id}`}>
              View campaign
              <ArrowRight size={14} />
            </Link>
          </footer>
        </article>
      ))}
      {!filtered.length && (
        <div className="empty-state">
          <Search size={22} />
          <h2>No campaigns found</h2>
          <p>Try a campaign name, agent role, or tool.</p>
          <button className="btn secondary" onClick={() => setQuery("")}>
            Clear search
          </button>
        </div>
      )}
    </div>
  );
}
