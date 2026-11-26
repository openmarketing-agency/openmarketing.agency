/** Lets an owner choose a campaign's publishing mode and sync its saved revision. */

"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { saveCampaignModeAction } from "@/app/actions/workspace";
import type { CampaignConfiguration, CampaignMode } from "@/lib/server/agent-workspace";
import { Button } from "@/components/ui/button";

const options: Record<CampaignMode, { label: string; description: string }> = {
  approve: { label: "Approve", description: "Agents draft publications and you review each one before it is queued." },
  control: { label: "Control", description: "Only publications you explicitly approve run. Scheduled work is paused." },
  yolo: { label: "Yolo", description: "Automation runs and new publication drafts are approved automatically." },
};

export function CampaignModeSettings({ campaignId, configuration, installed }: {
  campaignId: string;
  configuration: CampaignConfiguration;
  installed: boolean;
}) {
  const saved = configuration.mode ?? "approve";
  const [mode, setMode] = useState(saved);
  const [result, action, pending] = useActionState(saveCampaignModeAction.bind(null, campaignId), {});
  const changed = mode !== saved;

  return (
    <section className="campaign-settings campaign-mode-settings" aria-labelledby="campaign-mode-heading">
      <header className="campaign-settings-heading">
        <h2 id="campaign-mode-heading">Publishing mode</h2>
        <p>Choose how much the agents can publish without you.</p>
      </header>
      <form action={action} className="campaign-settings-form">
        <input type="hidden" name="revision" value={configuration.revision} />
        <fieldset className="campaign-mode-options" disabled={pending}>
          <legend className="sr-only">Mode</legend>
          {(Object.entries(options) as [CampaignMode, typeof options[CampaignMode]][]).map(([value, option]) => (
            <label key={value} className="campaign-mode-option" data-mode={value}>
              <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} />
              <span className="campaign-mode-radio" aria-hidden="true" />
              <span className="campaign-mode-text">
                <span className="campaign-mode-title">{option.label}{value === saved && <span className="campaign-mode-current">Current</span>}</span>
                <span>{option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {mode === "yolo" && changed && (
          <p className="campaign-mode-warning">New drafts will publish without anyone reviewing them.</p>
        )}
        <div className="campaign-settings-actions">
          <p className="campaign-settings-state" role="status">
            {result.error ? <span className="form-error" role="alert">{result.error}</span>
              : pending ? "Saving and syncing…"
              : changed ? `Switch from ${options[saved].label} to ${options[mode].label}.`
              : result.saved ? (installed ? "Mode synced." : "Mode saved for first start.") : ""}
          </p>
          <Button asChild variant="ghost"><Link href={`/approvals?campaign=${campaignId}`}>Review publications</Link></Button>
          <Button type="submit" disabled={pending || (!changed && !result.error)}>
            {pending ? "Saving…" : "Save mode"}
          </Button>
        </div>
      </form>
    </section>
  );
}
