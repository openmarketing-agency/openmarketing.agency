/** Shows a saved campaign and manages its shared tools and agent settings. */

"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Megaphone, Rocket } from "lucide-react";

import { CampaignKanban } from "@/components/campaign-kanban";
import { CampaignModeSettings } from "@/components/campaign-mode-settings";
import { CampaignSettings } from "@/components/campaign-settings";
import { ToolkitBrowser } from "@/components/toolkit-browser";
import { campaignConnectionScope } from "@/lib/agent-connections";
import type { CampaignKanbanStatus, SavedCampaign } from "@/lib/server/agent-workspace";
import type { Toolkit } from "@/lib/tool-catalog";
import type { ConnectionSnapshot } from "@/lib/tool-connection-service";

const views = [
  { id: "overview", label: "Plan" },
  { id: "agents", label: "Agents" },
  { id: "tools", label: "Tools" },
  { id: "settings", label: "Settings" },
] as const;

type View = typeof views[number]["id"] | "deploy";

export function CampaignDetail({
  campaign,
  kanban,
  snapshot: initialSnapshot,
  metadata: initialMetadata,
  feedback,
  overview,
  agents,
  agentCount,
}: {
  campaign: SavedCampaign;
  kanban: CampaignKanbanStatus;
  snapshot: ConnectionSnapshot;
  metadata: Toolkit[];
  feedback?: string;
  overview: ReactNode;
  agents: ReactNode;
  agentCount: number;
}) {
  const query = useSearchParams();
  const requestedView = query.get("view");
  const view: View = requestedView === "deploy" ? requestedView
    : views.find(({ id }) => id === requestedView)?.id
      ?? (requestedView === "mcp" ? "settings" : requestedView === "team" || query.has("agent") ? "tools" : "overview");
  const path = "/campaigns/" + campaign.id;
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [metadata, setMetadata] = useState(initialMetadata);
  const lifecycleLabel = campaign.lifecycleState === "pausing" ? "Stopping…"
    : campaign.lifecycleState === "paused" ? "Stopped" : "Running";
  const deploymentState = campaign.installationState === "installed" ? lifecycleLabel
    : campaign.installationState === "installing" ? "Installation incomplete"
      : campaign.board ? "Installation unverified" : "Draft";
  const needsDeployment = deploymentState === "Draft" || deploymentState === "Installation incomplete";
  const settingsLinkToDeployment = view === "settings" && needsDeployment && Boolean(campaign.configuration);
  const { configuration, name, description, goals, plans } = campaign;
  const requiredIntegrations = campaign.requiredIntegrations ?? [];
  const error = campaign.integrationConfigInvalid
    ? "Use a list of unique integration IDs such as discord or facebook in config.yaml."
    : undefined;
  const pendingIntegrations = requiredIntegrations.filter(({ slug }) =>
    !slug || (!snapshot.connected.includes(slug) && !metadata.some((tool) => tool.slug === slug && tool.noAuth)));

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

  function updateConnections(nextSnapshot: ConnectionSnapshot, items: Toolkit[]) {
    setSnapshot(nextSnapshot);
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
          <CampaignKanban status={kanban} />
        </header>
        <div className="campaign-header-actions">
          {view !== "deploy" && !settingsLinkToDeployment && (
            <Link className={view === "settings" ? "btn secondary" : "btn primary"} {...viewLink("deploy")}>
              <Rocket size={16} aria-hidden="true" /> {needsDeployment ? "Deploy campaign" : "Review deployment"}
            </Link>
          )}
        </div>
      </div>
      <nav className="campaign-tabs" aria-label="Campaign sections">
        {views.map(({ id, label }) => (
          <Link key={id} {...viewLink(id)}
            aria-current={view === id ? "page" : undefined}>
            {label}{id === "agents" && agentCount > 0 && <span className="campaign-tab-count">{agentCount}</span>}
          </Link>
        ))}
        {view === "deploy" && <Link {...viewLink("deploy")} aria-current="page">Deploy</Link>}
      </nav>
      {error && view === "tools" && <p role="alert" className="form-error">{error}</p>}

      {view === "overview" && overview}
      {view === "agents" && agents}
      {view === "tools" && (
        <div className="campaign-tools">
          <ToolkitBrowser scope={campaignConnectionScope(campaign.id)}
            startInCatalog={query.get("tool_list") === "catalog"}
            snapshot={snapshot} metadata={metadata}
            requiredIntegrations={requiredIntegrations}
            feedback={feedback} onChange={updateConnections} />
        </div>
      )}
      {view === "settings" && (configuration ? (
        <>
          <CampaignModeSettings campaignId={campaign.id} configuration={configuration} />
          {needsDeployment ? (
            <section className="campaign-next-action">
              <h2>Model settings</h2>
              <p>You can override the default agent’s model when you deploy.</p>
              <Link className="btn primary" {...viewLink("deploy")}>Review deployment <Rocket size={15} aria-hidden="true" /></Link>
            </section>
          ) : (
            <CampaignSettings key={configuration.mode ?? "approve"} campaignId={campaign.id} configuration={configuration} />
          )}
        </>
      ) : (
        <p className="notice">Campaign settings are unavailable. Rebuild the oma-agent workspace service to enable them.</p>
      ))}
      {view === "deploy" && (
        <section className="campaign-deploy" aria-labelledby="campaign-deploy-heading">
          <h2 id="campaign-deploy-heading">Review deployment</h2>
          <p>Connect the required tools, review the optional model settings, then deploy and start the campaign.</p>
          {configuration ? (
            <div className="campaign-deploy-layout">
              <aside className="campaign-context">
                <h3>Campaign summary</h3>
                <dl>
                  <div><dt>Plan</dt><dd><Link {...viewLink("overview")}>{goals.length} {goals.length === 1 ? "goal" : "goals"} · {plans.length} {plans.length === 1 ? "step" : "steps"}</Link></dd></div>
                  <div><dt>Agents</dt><dd><Link {...viewLink("agents")}>{agentCount} {agentCount === 1 ? "agent" : "agents"}</Link></dd></div>
                  <div><dt>Tools</dt><dd><Link {...viewLink("tools")}>
                    {requiredIntegrations.length ? `${requiredIntegrations.length - pendingIntegrations.length} of ${requiredIntegrations.length} required ready`
                      : "No integrations configured"}
                  </Link></dd></div>
                </dl>
              </aside>
              {pendingIntegrations.length || error ? (
                <div className="campaign-next-action">
                  <p>{error ?? "Connect these required tools before deploying: " + pendingIntegrations.map(({ name }) => name).join(", ") + "."}</p>
                  <Link className="btn primary" {...viewLink("tools")}>Open campaign tools</Link>
                </div>
              ) : (
                <CampaignSettings key="deploy" deploy campaignId={campaign.id} configuration={configuration} />
              )}
            </div>
          ) : <p className="notice">Deployment requires the current oma-agent workspace service.</p>}
        </section>
      )}
    </div>
  );
}
