/** Lets an owner choose a campaign's publishing mode and sync its saved revision. */

"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { saveCampaignModeAction } from "@/app/actions/workspace";
import type { CampaignConfiguration, CampaignMode } from "@/lib/server/agent-workspace";

const options: Record<CampaignMode, { label: string; description: string }> = {
  approve: { label: "Approve", description: "Review publication drafts before queuing the publisher." },
  control: { label: "Control", description: "Run only explicitly approved publications. Scheduled work is paused." },
  yolo: { label: "Yolo", description: "Run automation and auto-approve new publication drafts." },
};

export function CampaignModeSettings({ campaignId, configuration }: {
  campaignId: string;
  configuration: CampaignConfiguration;
}) {
  const saved = configuration.mode ?? "approve";
  const [mode, setMode] = useState(saved);
  const [result, action, pending] = useActionState(saveCampaignModeAction.bind(null, campaignId), {});

  return (
    <section className="campaign-settings campaign-mode-settings" aria-labelledby="campaign-mode-heading">
      <h2 id="campaign-mode-heading">Publishing mode</h2>
      <form action={action} className="workspace-editor">
        <input type="hidden" name="revision" value={configuration.revision} />
        <label htmlFor="campaign-mode">Mode</label>
        <select id="campaign-mode" name="mode" disabled={pending} value={mode}
          aria-describedby="campaign-mode-description"
          onChange={(event) => setMode(event.target.value as CampaignMode)}>
          {Object.entries(options).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}
        </select>
        <p id="campaign-mode-description">{options[mode].description}</p>
        {result.error && <p role="alert" className="form-error">{result.error}</p>}
        {result.saved && !pending && mode === saved && <p role="status">Mode saved and synced.</p>}
        <div className="campaign-mode-actions">
          <button type="submit" className="btn primary" disabled={pending || (mode === saved && !result.error)}>
            {pending ? "Saving and syncing…" : "Save mode"}
          </button>
          <Link className="btn secondary" href={`/approvals?campaign=${campaignId}`}>Review publications</Link>
        </div>
      </form>
    </section>
  );
}
