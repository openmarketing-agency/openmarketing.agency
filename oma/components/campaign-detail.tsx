/** Shows a saved campaign and manages its shared tools and agent settings. */

"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Megaphone, Pause, Play } from "lucide-react";

import { changeCampaignRunAction } from "@/app/actions/workspace";
import { CampaignAgentSync, CampaignPlanEditor, CampaignToolSync } from "@/components/campaign-editors";
import { CampaignKanban } from "@/components/campaign-kanban";
import { CampaignProgress } from "@/components/campaign-progress";
import { CampaignModeSettings } from "@/components/campaign-mode-settings";
import { CampaignSettings } from "@/components/campaign-settings";
import { WorkspaceAnalytics } from "@/components/workspace-analytics";
import { ToolkitBrowser } from "@/components/toolkit-browser";
import { campaignLifecycleLabel } from "@/components/workspace-records";
import { campaignConnectionScope } from "@/lib/agent-connections";
import type { CampaignKanbanStatus, SavedCampaign } from "@/lib/server/agent-workspace";
import type { Toolkit } from "@/lib/tool-catalog";
import type { ConnectionSnapshot } from "@/lib/tool-connection-service";

const views = [
  { id: "progress", label: "Progress" },
  { id: "overview", label: "Plan" },
  { id: "analytics", label: "Analytics" },
  { id: "agents", label: "Agents" },
  { id: "tools", label: "Tools" },
  { id: "settings", label: "Run settings" },
] as const;

type View = typeof views[number]["id"];

export function CampaignDetail({
  campaign,
  kanban,
  snapshot: initialSnapshot,
  metadata: initialMetadata,
  feedback,
  overview,
  agents,
  agentNames,
}: {
  campaign: SavedCampaign;
  kanban: CampaignKanbanStatus;
  snapshot: ConnectionSnapshot;
  metadata: Toolkit[];
  feedback?: string;
  overview: ReactNode;
  agents: ReactNode;
  agentNames: Record<string, string>;
}) {
  const query = useSearchParams();
  const router = useRouter();
  const { id: campaignId, lifecycleState } = campaign;

  useEffect(() => {
    if (lifecycleState !== "pausing") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function checkPause() {
      if (!controller.signal.aborted) {
        try {
          if (!document.hidden) {
            const response = await fetch(`/api/campaigns/${campaignId}/lifecycle`, {
              signal: controller.signal, cache: "no-store",
            });
            if (response.ok) {
              const { state } = await response.json();
              if (!controller.signal.aborted && (state === "paused" || state === "resumed")) router.refresh();
            }
          }
        } catch {
          // The workspace may be temporarily unreachable while the VM restarts.
        } finally {
          if (!controller.signal.aborted) timer = setTimeout(() => void checkPause(), 4000);
        }
      }
    }
    void checkPause();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [campaignId, lifecycleState, router]);

  const requestedView = query.get("view");
  const view: View = requestedView === "deploy" || requestedView === "mcp" ? "settings"
    : views.find(({ id }) => id === requestedView)?.id
      ?? (requestedView === "team" || query.has("agent") ? "tools" : "progress");
  const path = "/campaigns/" + campaign.id;
  const agentCount = Object.keys(agentNames).length;
  const [connections, setConnections] = useState<{
    initial: ConnectionSnapshot; snapshot: ConnectionSnapshot; metadata: Toolkit[];
  }>();
  const localConnections = connections?.initial === initialSnapshot ? connections : undefined;
  const snapshot = localConnections?.snapshot ?? initialSnapshot;
  const metadata = localConnections?.metadata ?? initialMetadata;
  const [runResult, runAction, runPending] = useActionState(changeCampaignRunAction.bind(null, campaign.id), {});
  const installed = campaign.installationState === "installed";
  const deploymentState = campaignLifecycleLabel(campaign);
  const running = deploymentState === "Running";
  const pausing = deploymentState === "Pausing…";
  const { configuration, name, description } = campaign;
  const requiredIntegrations = campaign.requiredIntegrations ?? [];
  const error = campaign.integrationConfigInvalid
    ? "Ask campaign chat to fix the required tool IDs before syncing or starting."
    : undefined;
  const pendingIntegrations = requiredIntegrations.filter(({ slug }) =>
    !slug || (!snapshot.connected.includes(slug) && !metadata.some((tool) => tool.slug === slug && tool.noAuth)));
  const blocked = Boolean(error || pendingIntegrations.length);
  const runLabel = running ? "Pause campaign" : installed ? "Resume campaign" : "Start campaign";

  function viewLink(nextView: View) {
    const params = new URLSearchParams(query.toString());
    params.set("view", nextView);
    params.delete("agent");
    return { href: path + "?" + params.toString(), prefetch: false, scroll: false };
  }

  function updateConnections(nextSnapshot: ConnectionSnapshot, items: Toolkit[]) {
    setConnections({ initial: initialSnapshot, snapshot: nextSnapshot, metadata: items });
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
          {view !== "progress" && <CampaignKanban status={kanban} />}
        </header>
        <div className="campaign-header-actions">
          {configuration && (!running && blocked && !pausing && view !== "tools" ? (
            <Link className="btn primary" {...viewLink("tools")}>Set up required tools</Link>
          ) : (
            <form action={runAction}>
              <input type="hidden" name="revision" value={configuration.revision} />
              <input type="hidden" name="state" value={running ? "paused" : "resumed"} />
              <button className={running ? "btn secondary" : "btn primary"}
                disabled={runPending || pausing || (!running && blocked)}>
                {running ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
                {runPending ? (running ? "Pausing…" : "Starting…") : pausing ? "Pausing…" : runLabel}
              </button>
            </form>
          ))}
        </div>
      </div>
      {runResult.error && !runPending && <p className="form-error" role="alert">{runResult.error}</p>}
      {!running && !pausing && configuration && (
        <p className="campaign-run-guide">
          {error ? "Fix the required tool IDs before starting."
            : blocked ? (installed ? "Connect the required tools before resuming." : "Connect the required tools before starting.")
            : installed ? "Resume when you’re ready for the agents to continue."
            : "Starting sets up the agents and their Kanban board."}
        </p>
      )}
      <nav className="campaign-tabs" aria-label="Campaign sections">
        {views.map(({ id, label }) => (
          <Link key={id} {...viewLink(id)}
            aria-current={view === id ? "page" : undefined}>
            {label}{id === "agents" && agentCount > 0 && <span className="campaign-tab-count">{agentCount}</span>}
          </Link>
        ))}
      </nav>
      {error && view === "tools" && <p role="alert" className="form-error">{error}</p>}

      {view === "progress" && <CampaignProgress campaign={campaign.id} agents={agentNames} kanban={kanban} />}
      {view === "overview" && <>
        {configuration && <CampaignPlanEditor campaign={campaign} revision={configuration.revision} />}
        {overview}
      </>}
      {view === "analytics" && <WorkspaceAnalytics key={campaign.id} id={campaign.id} />}
      {view === "agents" && <>
        {configuration && <CampaignAgentSync campaignId={campaign.id} revision={configuration.revision} />}
        {agents}
      </>}
      {view === "tools" && (
        <div className="campaign-tools">
          <ToolkitBrowser key={requiredIntegrations.map(({ id }) => id).join(",")} scope={campaignConnectionScope(campaign.id)}
            snapshot={snapshot} metadata={metadata}
            requiredIntegrations={requiredIntegrations}
            headingAction={configuration && <CampaignToolSync campaignId={campaign.id} revision={configuration.revision}
              disabled={pausing || runPending || Boolean(error)} />}
            feedback={feedback} onChange={updateConnections} />
        </div>
      )}
      {view === "settings" && (configuration ? (
        <>
          <p className="campaign-run-guide">{running
            ? "Saving changes briefly pauses the campaign. It resumes after sync succeeds."
            : "The campaign can use the default agent’s model and ask for publishing approval."}</p>
          <CampaignModeSettings campaignId={campaign.id} configuration={configuration} installed={installed} />
          <CampaignSettings key={configuration.mode ?? "approve"} campaignId={campaign.id}
            configuration={configuration} firstStart={!installed} canStart={!blocked && !runPending} />
        </>
      ) : <p className="notice">Campaign settings are unavailable. Check the agent workspace and reload.</p>)}
    </div>
  );
}
