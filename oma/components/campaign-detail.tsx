/** Shows a saved campaign and manages its shared tools and agent settings. */

"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Megaphone } from "lucide-react";

import { CampaignSettings } from "@/components/campaign-settings";
import { ToolkitBrowser } from "@/components/toolkit-browser";
import { campaignConnectionScope, campaignToolSlugs, type ToolAssignment } from "@/lib/agent-connections";
import type { CampaignToolRecommendation } from "@/lib/campaign-tool-suggestions";
import type { CampaignModelDefaults, SavedCampaign } from "@/lib/server/agent-workspace";
import type { Toolkit } from "@/lib/tool-catalog";
import type { ConnectionSnapshot } from "@/lib/tool-connection-service";

const views = [
  { id: "overview", label: "Overview" },
  { id: "agents", label: "Agents" },
  { id: "tools", label: "Tools" },
  { id: "settings", label: "Settings" },
] as const;

type View = typeof views[number]["id"];

export function CampaignDetail({
  campaign,
  modelDefaults,
  snapshot: initialSnapshot,
  assignments,
  metadata: initialMetadata,
  recommendations,
  feedback,
  error,
  overview,
  agents,
  agentCount,
}: {
  campaign: SavedCampaign;
  modelDefaults: CampaignModelDefaults;
  snapshot: ConnectionSnapshot;
  assignments: ToolAssignment[];
  metadata: Toolkit[];
  recommendations: CampaignToolRecommendation[];
  feedback?: string;
  error?: string;
  overview: ReactNode;
  agents: ReactNode;
  agentCount: number;
}) {
  const query = useSearchParams();
  const requestedView = query.get("view");
  const view = views.find(({ id }) => id === requestedView)?.id
    ?? (requestedView === "mcp" ? "settings" : requestedView === "team" || query.has("agent") ? "tools" : "overview");
  const path = "/campaigns/" + campaign.id;
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [selected, setSelected] = useState(() => campaignToolSlugs(campaign.id, assignments));
  const [metadata, setMetadata] = useState(initialMetadata);

  function selectView(nextView: View) {
    if (nextView === view) return;
    const url = new URL(window.location.href);
    url.searchParams.set("view", nextView);
    url.searchParams.delete("agent");
    window.history.pushState(null, "", url);
  }

  function updateConnections(nextSnapshot: ConnectionSnapshot, slugs: string[], items: Toolkit[]) {
    setSnapshot(nextSnapshot);
    setSelected(slugs);
    setMetadata(items);
  }

  return (
    <div className="agent-playbook-page campaign-page campaign-detail">
      <Link className="back-link" href="/dashboard">
        <ArrowLeft size={14} aria-hidden="true" /> Campaigns
      </Link>
      <header className="campaign-heading campaign-identity">
        <span className="playbook-mark"><Megaphone size={23} aria-hidden="true" /></span>
        <div className="campaign-title">
          <h1>{campaign.name}</h1>
          {campaign.version && <span className="version-label">v{campaign.version}</span>}
        </div>
        {campaign.description && <p>{campaign.description}</p>}
      </header>
      <nav className="campaign-tabs" aria-label="Campaign sections">
        {views.map(({ id, label }) => (
          <Link key={id} href={path + "?view=" + id} prefetch={false}
            aria-current={view === id ? "page" : undefined}
            onNavigate={(event) => { event.preventDefault(); selectView(id); }}>
            {label}{id === "agents" && agentCount > 0 && <span className="campaign-tab-count">{agentCount}</span>}
          </Link>
        ))}
      </nav>
      {error && view === "tools" && <p role="alert" className="form-error">{error}</p>}

      {view === "overview" && overview}
      {view === "agents" && agents}
      {view === "tools" && (
        <div className="campaign-tools">
          <ToolkitBrowser scope={campaignConnectionScope(campaign.id)} campaignName={campaign.name}
            snapshot={snapshot} selected={selected} metadata={metadata} recommendations={recommendations}
            feedback={feedback} onChange={updateConnections} />
        </div>
      )}
      {view === "settings" && (campaign.configuration ? (
        <CampaignSettings campaignId={campaign.id} configuration={campaign.configuration} modelDefaults={modelDefaults} />
      ) : (
        <p className="notice">Campaign settings are unavailable. Rebuild the oma-agent workspace service to enable them.</p>
      ))}
    </div>
  );
}
