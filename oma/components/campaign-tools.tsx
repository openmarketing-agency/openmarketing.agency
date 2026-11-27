/** Lists the tools in a campaign’s config, shows whether each Composio app is connected, and sets up custom MCP endpoints. */

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { CampaignCustomMcp, CampaignToolSync } from "@/components/campaign-editors";
import type { CampaignToolConnections, SavedCampaign } from "@/lib/server/agent-workspace";
import { Button } from "@/components/ui/button";

type Status = { state: "loading" } | { state: "error"; message: string } | ({ state: "ready" } & CampaignToolConnections);

export function CampaignTools({ campaign, disabled }: { campaign: SavedCampaign; disabled: boolean }) {
  const { configuration } = campaign;
  const composio = (campaign.requiredIntegrations ?? []).filter(({ slug }) => slug);
  const manual = campaign.manualIntegrations ?? [];
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const hasComposioTools = composio.length > 0;

  const check = useCallback(async (signal?: AbortSignal) => {
    setStatus({ state: "loading" });
    try {
      const response = await fetch(`/api/campaigns/${campaign.id}/tools`, { cache: "no-store", signal });
      const body = await response.json();
      if (signal?.aborted) return;
      setStatus(response.ok ? { state: "ready", ...body } : { state: "error", message: body.error ?? "Couldn’t check tool connections." });
    } catch {
      if (!signal?.aborted) setStatus({ state: "error", message: "Couldn’t check tool connections. Try again." });
    }
  }, [campaign.id]);

  useEffect(() => {
    if (!hasComposioTools) return;
    const controller = new AbortController();
    // Fetch on mount: the status comes from the Composio MCP server, which the page render shouldn’t wait for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void check(controller.signal);
    return () => controller.abort();
  }, [check, hasComposioTools]);

  const connectedCount = status.state === "ready" ? composio.filter(({ slug }) => status.connections[slug!]).length : 0;

  return (
    <div className="campaign-tools">
      <header className="campaign-tools-heading">
        <div>
          <h2>Tools</h2>
          <p>These come from the integrations in this campaign’s config. Ask campaign chat to change the list.</p>
        </div>
        {configuration && <CampaignToolSync campaignId={campaign.id} revision={configuration.revision} disabled={disabled} />}
      </header>
      {campaign.integrationConfigInvalid && <p role="alert" className="form-error">
        Ask campaign chat to fix the tool IDs before syncing or starting.
      </p>}
      {!composio.length && !manual.length && !campaign.integrationConfigInvalid && (
        <p className="campaign-tools-empty">This campaign doesn’t list any tools.</p>
      )}
      {hasComposioTools && <section className="campaign-tools-section" aria-labelledby="campaign-tools-composio">
        <div className="campaign-tools-section-heading">
          <div>
            <h3 id="campaign-tools-composio">Composio apps</h3>
            <p aria-live="polite">
              {status.state === "loading" ? "Checking connections through your Composio MCP server…"
                : status.state === "error" ? status.message
                : !status.configured ? <>Set up Composio in <Link href="/settings">Settings</Link> to check these apps.</>
                : `${connectedCount} of ${composio.length} connected. Connect the rest in your Composio dashboard.`}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" disabled={status.state === "loading"} onClick={() => void check()}>
            Check again
          </Button>
        </div>
        <ul className="campaign-tools-list">
          {composio.map(({ id, name, slug }) => {
            const connected = status.state === "ready" && status.configured ? status.connections[slug!] === true : undefined;
            return (
              <li key={id} data-state={connected === undefined ? "unknown" : connected ? "connected" : "missing"}>
                <span className="campaign-tools-name">{name}<code>{slug}</code></span>
                <span className="campaign-tools-status">
                  {status.state === "loading" ? "Checking…"
                    : connected === undefined ? "Unknown"
                    : connected ? "Connected" : "Not connected · Connect it in your Composio dashboard"}
                </span>
              </li>
            );
          })}
        </ul>
      </section>}
      {manual.length > 0 && <section className="campaign-tools-section" aria-labelledby="campaign-tools-custom">
        <h3 id="campaign-tools-custom">Custom MCP</h3>
        <p>Composio doesn’t cover these tools. Save an MCP endpoint for each before starting the campaign.</p>
        {configuration
          ? <div className="campaign-custom-mcp">
            {manual.map((integration) => <CampaignCustomMcp key={integration.id} integration={integration}
              campaignId={campaign.id} revision={configuration.revision} />)}
          </div>
          : <p className="notice">Campaign settings are unavailable. Check the agent workspace and reload.</p>}
      </section>}
    </div>
  );
}
