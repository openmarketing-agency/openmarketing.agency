/** Shows a saved campaign and manages its shared tool selection and hosted MCP connection. */

"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Plug, Terminal, Workflow } from "lucide-react";

import { CampaignMcpSetup } from "@/components/campaign-mcp-setup";
import { ToolkitBrowser } from "@/components/toolkit-browser";
import { campaignConnectionScope, campaignToolSlugs, type ToolAssignment } from "@/lib/agent-connections";
import type { CampaignToolRecommendation } from "@/lib/campaign-tool-suggestions";
import type { HostedMcpConnection } from "@/lib/mcp-client-config";
import type { SavedCampaign } from "@/lib/server/agent-workspace";
import type { Toolkit } from "@/lib/tool-catalog";
import type { ConnectionSnapshot } from "@/lib/tool-connection-service";

type View = "overview" | "tools" | "mcp";

const views = [
  { id: "overview", label: "Overview", icon: null },
  { id: "tools", label: "Tools", icon: Plug },
  { id: "mcp", label: "MCP connection", icon: Terminal },
] as const;

export function CampaignDetail({
  campaign,
  snapshot: initialSnapshot,
  assignments,
  metadata: initialMetadata,
  recommendations,
  initialView,
  feedback,
  error,
  overview,
}: {
  campaign: SavedCampaign;
  snapshot: ConnectionSnapshot;
  assignments: ToolAssignment[];
  metadata: Toolkit[];
  recommendations: CampaignToolRecommendation[];
  initialView: View;
  feedback?: string;
  error?: string;
  overview: ReactNode;
}) {
  const [view, setView] = useState(initialView);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [selected, setSelected] = useState(() => campaignToolSlugs(campaign.id, assignments));
  const [metadata, setMetadata] = useState(initialMetadata);
  const [mcp, setMcp] = useState<{ selection: string; connection: HostedMcpConnection }>();

  const selection = [...selected].sort().join(",");
  const toolBySlug = new Map(metadata.map((tool) => [tool.slug, tool]));
  const available = (slug: string) => toolBySlug.get(slug)?.noAuth || snapshot.connected.includes(slug);
  const missing = selected.some((slug) => !available(slug));

  function selectView(nextView: View) {
    setView(nextView);
    const url = new URL(window.location.href);
    url.searchParams.set("view", nextView);
    url.searchParams.delete("agent");
    window.history.replaceState(null, "", url);
  }

  function updateConnections(nextSnapshot: ConnectionSnapshot, slugs: string[], items: Toolkit[]) {
    setSnapshot(nextSnapshot);
    setSelected(slugs);
    setMetadata(items);
    setMcp(undefined);
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
        {views.map(({ id, label, icon: Icon }) => (
          <button key={id} className={view === id ? "selected" : ""} aria-pressed={view === id}
            onClick={() => selectView(id)}>
            {Icon && <Icon size={16} aria-hidden="true" />}{label}
          </button>
        ))}
      </div>
      {error && view !== "overview" && <p role="alert" className="form-error">{error}</p>}

      {view === "overview" && overview}
      {view === "tools" && (
        <div className="campaign-tools">
          <ToolkitBrowser scope={campaignConnectionScope(campaign.id)} campaignName={campaign.name}
            snapshot={snapshot} selected={selected} metadata={metadata} recommendations={recommendations}
            feedback={feedback} onChange={updateConnections} />
        </div>
      )}
      {view === "mcp" && (
        <div className="playbook-mcp-view">
          {selected.length > 0 && (
            <div className="playbook-tool-summary">
              <h3>Included tools</h3>
              <ul>
                {selected.map((slug) => (
                  <li key={slug}>
                    <strong>{toolBySlug.get(slug)?.name ?? slug}</strong>
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
            ready={selected.length > 0 && !missing && !error} configured={snapshot.configured}
            connection={mcp?.selection === selection ? mcp.connection : undefined}
            onGenerate={(connection) => setMcp({ selection, connection })} />
        </div>
      )}
    </div>
  );
}
