/** Lets operators edit a campaign plan and sync saved tool or agent changes. */

"use client";

import { useActionState, useRef, useState, type ToggleEvent } from "react";
import { saveCampaignPlanAction, syncCampaignToolsAction, syncCampaignAgentsAction } from "@/app/actions/workspace";
import type { CampaignConfigurationResult, SavedCampaign } from "@/lib/server/agent-workspace";

function SaveMessage({ result }: { result: CampaignConfigurationResult }) {
  if (result.error) return <p className="form-error" role="alert">{result.error}</p>;
  if (result.synced || result.staged) {
    return <p className="workspace-save-status" role="status">{result.staged ? "Saved for first start." : "Changes synced."}</p>;
  }
  return null;
}

function PlanItems({ name, label, item, initial }: { name: string; label: string; item: string; initial: string[] }) {
  const nextId = useRef(initial.length);
  const [rows, setRows] = useState(initial.map((text, id) => ({ id, text })));
  return (
    <fieldset className="campaign-plan-items">
      <legend>{label}</legend>
      {rows.map(({ id, text }, index) => (
        <div key={id} className="campaign-plan-item">
          <textarea name={name} value={text} rows={2} maxLength={2000} aria-label={item + " " + (index + 1)}
            onChange={(event) => setRows((current) => current.map((row) => row.id === id ? { id, text: event.target.value } : row))} />
          <button type="button" className="btn ghost" aria-label={"Remove " + item.toLowerCase() + " " + (index + 1)}
            onClick={() => setRows((current) => current.filter((row) => row.id !== id))}>Remove</button>
        </div>
      ))}
      <button type="button" className="btn secondary" disabled={rows.length === 32} onClick={() => {
        const id = nextId.current++;
        setRows((current) => [...current, { id, text: "" }]);
      }}>Add {item.toLowerCase()}</button>
    </fieldset>
  );
}

export function CampaignPlanEditor({ campaign, revision }: { campaign: SavedCampaign; revision: string }) {
  const [result, action, pending] = useActionState(saveCampaignPlanAction.bind(null, campaign.id), {});
  const [name, setName] = useState(campaign.name);
  const [description, setDescription] = useState(campaign.description);
  const [draftRevision, setDraftRevision] = useState(revision);
  function openPlan(event: ToggleEvent<HTMLDetailsElement>) {
    if (!event.currentTarget.open || pending) return;
    setDraftRevision(revision);
    setName(campaign.name);
    setDescription(campaign.description);
  }
  return (
    <details className="campaign-edit-disclosure" onToggle={openPlan}>
      <summary>Edit plan</summary>
      <form action={action} className="workspace-editor">
        <input type="hidden" name="revision" value={result.configuration?.revision === revision ? revision : draftRevision} />
        <fieldset disabled={pending}>
          <label>Campaign name<input name="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></label>
          <label>Description<textarea name="description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} rows={3} /></label>
          <PlanItems key={"goals-" + draftRevision} name="goals" label="Goals" item="Goal" initial={campaign.goals} />
          <PlanItems key={"plans-" + draftRevision} name="plans" label="Plan steps" item="Step" initial={campaign.plans} />
        </fieldset>
        <SaveMessage result={result} />
        <button className="btn primary" disabled={pending}>{pending ? "Saving plan…" : "Save plan"}</button>
      </form>
    </details>
  );
}

export function CampaignToolSync({ campaignId, revision, disabled }: {
  campaignId: string; revision: string; disabled: boolean;
}) {
  const [result, action, pending] = useActionState(syncCampaignToolsAction.bind(null, campaignId), {});
  return (
    <form className="campaign-tool-sync" action={action}>
      <input type="hidden" name="revision" value={revision} />
      <button className="btn secondary" disabled={disabled || pending}>{pending ? "Syncing tools…" : "Sync tools"}</button>
      <SaveMessage result={result} />
    </form>
  );
}

export function CampaignAgentSync({ campaignId, revision }: { campaignId: string; revision: string }) {
  const [result, action, pending] = useActionState(syncCampaignAgentsAction.bind(null, campaignId), {});
  return (
    <form className="campaign-agent-sync" action={action}>
      <input type="hidden" name="revision" value={revision} />
      <p>Ask campaign chat to change an agent’s instructions or settings.</p>
      <button className="btn secondary" disabled={pending}>{pending ? "Syncing agents…" : "Sync saved agent changes"}</button>
      <SaveMessage result={result} />
    </form>
  );
}
