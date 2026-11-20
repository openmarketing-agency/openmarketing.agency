/** Shows a saved campaign and lets its supported agents use manually selected connections. */

"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Terminal, Users, Workflow } from "lucide-react";

import { CampaignMcpSetup } from "@/components/campaign-mcp-setup";
import { ToolkitBrowser } from "@/components/toolkit-browser";
import { assignedToolSlugs, type ToolAssignment } from "@/lib/agent-connections";
import type { HostedMcpConnection } from "@/lib/mcp-client-config";
import type { SavedAgent, SavedCampaign } from "@/lib/server/agent-workspace";
import type { Toolkit } from "@/lib/tool-catalog";
import type { ConnectionSnapshot } from "@/lib/tool-connection-service";

type View = "overview" | "team" | "mcp";

export function CampaignDetail({
  campaign,
  agents,
  snapshot: initialSnapshot,
  assignments: initialAssignments,
  metadata: initialMetadata,
  initialAgent,
  initialView,
  feedback,
  error,
  overview,
}: {
  campaign: SavedCampaign;
  agents: (SavedAgent & { scopeId: string })[];
  snapshot: ConnectionSnapshot;
  assignments: ToolAssignment[];
  metadata: Toolkit[];
  initialAgent?: string;
  initialView?: string;
  feedback?: string;
  error?: string;
  overview: ReactNode;
}) {
  const initialSelection = agents.find((agent) => agent.scopeId === initialAgent);
  const [selectedId, setSelectedId] = useState((initialSelection ?? agents[0]).scopeId);
  const [view, setView] = useState<View>(
    initialView === "team" || initialView === "mcp" ? initialView
      : initialView !== "overview" && initialSelection ? "team" : "overview",
  );
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [metadata, setMetadata] = useState(initialMetadata);
  const [mcp, setMcp] = useState<HostedMcpConnection>();

  const agent = agents.find((item) => item.scopeId === selectedId) ?? agents[0];
  const scope = { playbookId: campaign.id, agentId: agent.scopeId };
  const selected = assignedToolSlugs(assignments, scope);
  const agentsByTool = new Map<string, string[]>();
  for (const item of agents) {
    for (const slug of assignedToolSlugs(assignments, { playbookId: campaign.id, agentId: item.scopeId })) {
      const names = agentsByTool.get(slug) ?? [];
      names.push(item.name);
      agentsByTool.set(slug, names);
    }
  }
  const toolBySlug = new Map(metadata.map((tool) => [tool.slug, tool]));
  const available = (slug: string) => toolBySlug.get(slug)?.noAuth || snapshot.connected.includes(slug);
  const missing = [...agentsByTool.keys()].some((slug) => !available(slug));

  function selectView(nextView: View, agentId?: string) {
    setView(nextView);
    const url = new URL(window.location.href);
    url.searchParams.set("view", nextView);
    if (agentId) {
      setSelectedId(agentId);
      url.searchParams.set("agent", agentId);
    }
    window.history.replaceState(null, "", url);
  }

  function updateConnections(nextSnapshot: ConnectionSnapshot, slugs: string[], items: Toolkit[]) {
    setSnapshot(nextSnapshot);
    setMetadata(items);
    setMcp(undefined);
    setAssignments((previous) => [
      ...previous.filter((item) => item.playbook_id !== campaign.id || item.agent_id !== agent.scopeId),
      ...slugs.map((slug) => ({
        playbook_id: campaign.id, agent_id: agent.scopeId, toolkit_slug: slug,
      })),
    ]);
  }

  return (
    <div className="agent-playbook-page">
      <Link className="back-link" href="/dashboard">
        <ArrowLeft size={14} aria-hidden="true" /> Campaigns
      </Link>
      <header className="agent-page-heading">
        <div className="agent-page-title">
          <span className="playbook-mark"><Workflow size={26} strokeWidth={1.5} aria-hidden="true" /></span>
          <div>
            <div className="agent-title-line">
              <h1>{campaign.name}</h1>
              {campaign.version && <span className="version-label">v{campaign.version}</span>}
            </div>
            {campaign.description && <p>{campaign.description}</p>}
          </div>
        </div>
      </header>
      <div className="agent-page-tabs" aria-label="Campaign sections">
        {([
          { id: "overview", label: "Overview" },
          { id: "team", label: "Agent tools", icon: Users },
          { id: "mcp", label: "MCP connection", icon: Terminal },
        ] as const).map(({ id, label, ...item }) => (
          <button key={id} className={view === id ? "selected" : ""} aria-pressed={view === id}
            onClick={() => selectView(id)}>
            {"icon" in item && item.icon && <item.icon size={16} aria-hidden="true" />}
            {label}
          </button>
        ))}
      </div>
      {error && view !== "overview" && <p role="alert" className="form-error">{error}</p>}

      {view === "overview" && overview}
      {view === "team" && (
        <div className="agent-workspace">
          <nav className="agent-picker" aria-label="Campaign agents">
            {agents.map((item) => (
              <button key={item.scopeId} type="button"
                className={"agent-picker-row" + (item.scopeId === agent.scopeId ? " selected" : "")}
                aria-current={item.scopeId === agent.scopeId ? "true" : undefined}
                onClick={() => selectView("team", item.scopeId)}>
                <Users size={16} aria-hidden="true" />
                <span><strong>{item.name}</strong></span>
              </button>
            ))}
          </nav>
          <section className="agent-configuration" aria-labelledby="selected-agent-name">
            <header className="agent-configuration-heading">
              <div>
                <h2 id="selected-agent-name">{agent.name}</h2>
                {agent.description && <p>{agent.description}</p>}
              </div>
            </header>
            <div className="agent-connection-area">
              <ToolkitBrowser
                key={agent.scopeId}
                scope={scope}
                agentName={agent.name}
                snapshot={snapshot}
                selected={selected}
                metadata={metadata}
                feedback={initialAgent === agent.scopeId ? feedback : undefined}
                onChange={updateConnections}
              />
            </div>
          </section>
        </div>
      )}
      {view === "mcp" && (
        <div className="playbook-mcp-view">
          {agentsByTool.size > 0 && (
            <div className="playbook-tool-summary">
              <h3>Included tools</h3>
              <ul>
                {[...agentsByTool].map(([slug, names]) => (
                  <li key={slug}>
                    <span>
                      <strong>{toolBySlug.get(slug)?.name ?? slug}</strong>
                      <small>{names.join(" · ")}</small>
                    </span>
                    {available(slug) ? (
                      <span className="connection-status">
                        <Check size={14} aria-hidden="true" />
                        {toolBySlug.get(slug)?.noAuth ? "No sign-in needed" : "Connected"}
                      </span>
                    ) : <span className="tool-needs-connection">Needs connection</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {missing && <p className="notice">Connect or remove tools marked “Needs connection” before generating your URL.</p>}
          <CampaignMcpSetup campaignId={campaign.id} campaignName={campaign.name}
            ready={agentsByTool.size > 0 && !missing && !error} configured={snapshot.configured}
            connection={mcp} onGenerate={setMcp} />
        </div>
      )}
    </div>
  );
}
