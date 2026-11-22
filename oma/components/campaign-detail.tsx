/** Shows a saved campaign and manages its shared tools and agent settings. */

"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Plug, Settings, Workflow } from "lucide-react";

import { CampaignSettings } from "@/components/campaign-settings";
import { ToolkitBrowser } from "@/components/toolkit-browser";
import { campaignConnectionScope, campaignToolSlugs, type ToolAssignment } from "@/lib/agent-connections";
import type { CampaignToolRecommendation } from "@/lib/campaign-tool-suggestions";
import type { CampaignModelDefaults, SavedCampaign } from "@/lib/server/agent-workspace";
import type { Toolkit } from "@/lib/tool-catalog";
import type { ConnectionSnapshot } from "@/lib/tool-connection-service";

type View = "overview" | "tools" | "settings";

const views = [
  { id: "overview", label: "Overview", icon: null },
  { id: "tools", label: "Tools", icon: Plug },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

export function CampaignDetail({
  campaign,
  modelDefaults,
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
  modelDefaults: CampaignModelDefaults;
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
      {error && view === "tools" && <p role="alert" className="form-error">{error}</p>}

      {view === "overview" && overview}
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
