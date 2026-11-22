/** Shows a saved campaign and manages its shared tools and agent settings. */

"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Megaphone, Pencil, Rocket } from "lucide-react";

import { CampaignPlanEditor } from "@/components/campaign-plan-editor";
import { CampaignSettings } from "@/components/campaign-settings";
import { ToolkitBrowser } from "@/components/toolkit-browser";
import { campaignConnectionScope, campaignToolSlugs, type ToolAssignment } from "@/lib/agent-connections";
import type { CampaignToolRecommendation } from "@/lib/campaign-tool-suggestions";
import type { CampaignModelDefaults, SavedCampaign } from "@/lib/server/agent-workspace";
import type { Toolkit } from "@/lib/tool-catalog";
import type { ConnectionSnapshot } from "@/lib/tool-connection-service";

const views = [
  { id: "overview", label: "Plan" },
  { id: "agents", label: "Agents" },
  { id: "tools", label: "Tools" },
  { id: "settings", label: "Settings" },
] as const;

type View = typeof views[number]["id"] | "edit" | "deploy";

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
  const view: View = requestedView === "edit" || requestedView === "deploy" ? requestedView
    : views.find(({ id }) => id === requestedView)?.id
      ?? (requestedView === "mcp" ? "settings" : requestedView === "team" || query.has("agent") ? "tools" : "overview");
  const path = "/campaigns/" + campaign.id;
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [selected, setSelected] = useState(() => campaignToolSlugs(campaign.id, assignments));
  const [metadata, setMetadata] = useState(initialMetadata);
  const [planDirty, setPlanDirty] = useState(false);
  const deploymentState = campaign.installationState === "installed" ? "Installed"
    : campaign.installationState === "installing" ? "Installation incomplete"
      : campaign.board ? "Installation unverified" : "Draft";
  const needsDeployment = deploymentState === "Draft" || deploymentState === "Installation incomplete";
  const { configuration, name, description, goals, plans } = campaign;

  function viewLink(nextView: View) {
    return {
      href: path + "?view=" + nextView,
      prefetch: false,
      onNavigate: (event: { preventDefault: () => void }) => {
        event.preventDefault();
        selectView(nextView);
      },
    };
  }

  function selectView(nextView: View) {
    if (nextView === view) return;
    const url = new URL(window.location.href);
    url.searchParams.set("view", nextView);
    url.searchParams.delete("agent");
    url.hash = "";
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
      <div className="campaign-detail-header">
        <header className="campaign-heading campaign-identity">
          <span className="playbook-mark"><Megaphone size={23} aria-hidden="true" /></span>
          <div className="campaign-title">
            <h1>{name}</h1>
            <span className="campaign-deployment-status" data-state={deploymentState}>{deploymentState}</span>
            {campaign.version && <span className="version-label">v{campaign.version}</span>}
          </div>
          {description && <p>{description}</p>}
        </header>
        <div className="campaign-header-actions">
          {configuration && view === "overview" && (
            <Link className="btn secondary" {...viewLink("edit")}><Pencil size={15} aria-hidden="true" /> Edit plan</Link>
          )}
          {view !== "deploy" && (
            <Link className="btn primary" {...viewLink("deploy")}><Rocket size={16} aria-hidden="true" /> Deploy campaign</Link>
          )}
        </div>
      </div>
      <nav className="campaign-tabs" aria-label="Campaign sections">
        {views.map(({ id, label }) => (
          <Link key={id} {...viewLink(id)}
            aria-current={view === id || (id === "overview" && view === "edit") ? "page" : undefined}>
            {label}{id === "agents" && agentCount > 0 && <span className="campaign-tab-count">{agentCount}</span>}
          </Link>
        ))}
        {view === "deploy" && <Link {...viewLink("deploy")} aria-current="page">Deploy</Link>}
      </nav>
      {error && view === "tools" && <p role="alert" className="form-error">{error}</p>}

      {view === "overview" && overview}
      {configuration
        ? <CampaignPlanEditor campaignId={campaign.id} active={view === "edit"} onDirtyChange={setPlanDirty}
          saved={{ revision: configuration.revision, plan: { name, description, goals, plans } }} />
        : view === "edit" && <p className="notice">Plan editing requires the current oma-agent workspace service.</p>}
      {view === "agents" && agents}
      {view === "tools" && (
        <div className="campaign-tools">
          <ToolkitBrowser scope={campaignConnectionScope(campaign.id)} campaignName={campaign.name}
            snapshot={snapshot} selected={selected} metadata={metadata} recommendations={recommendations}
            feedback={feedback} onChange={updateConnections} />
        </div>
      )}
      {view === "settings" && (configuration ? (
        needsDeployment ? (
          <section className="campaign-next-action">
            <h2>Model settings</h2>
            <p>Choose the model and API key when you deploy. Tools selected for this campaign are synced during deployment.</p>
            <Link className="btn primary" {...viewLink("deploy")}>Review deployment <Rocket size={15} aria-hidden="true" /></Link>
          </section>
        ) : (
          <CampaignSettings key="settings" campaignId={campaign.id} configuration={configuration} modelDefaults={modelDefaults} />
        )
      ) : (
        <p className="notice">Campaign settings are unavailable. Rebuild the oma-agent workspace service to enable them.</p>
      ))}
      {view === "deploy" && (
        <section className="campaign-deploy" aria-labelledby="campaign-deploy-heading">
          <h2 id="campaign-deploy-heading">Review deployment</h2>
          <p>Deploying provisions the agent profiles and campaign board, then syncs the model and selected tools. Publishing and scheduling are separate actions.</p>
          {planDirty ? (
            <div className="campaign-next-action">
              <p>Save or discard the open plan edits before deploying.</p>
              <Link className="btn secondary" {...viewLink("edit")}>Return to the plan editor</Link>
            </div>
          ) : configuration ? (
            <div className="campaign-deploy-layout">
              <aside className="campaign-context">
                <h3>Campaign summary</h3>
                <dl>
                  <div><dt>Plan</dt><dd>{goals.length} {goals.length === 1 ? "goal" : "goals"} · {plans.length} {plans.length === 1 ? "step" : "steps"}</dd></div>
                  <div><dt>Agents</dt><dd>{agentCount}</dd></div>
                  <div><dt>Selected tools</dt><dd>{selected.length}</dd></div>
                </dl>
              </aside>
              <CampaignSettings key="deploy" deploy campaignId={campaign.id} configuration={configuration} modelDefaults={modelDefaults} />
            </div>
          ) : <p className="notice">Deployment requires the current oma-agent workspace service.</p>}
        </section>
      )}
    </div>
  );
}
