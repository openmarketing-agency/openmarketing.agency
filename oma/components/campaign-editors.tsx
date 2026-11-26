/** Lets operators edit a campaign plan and sync saved tool or agent changes. */

"use client";

import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, CircleCheck, ListOrdered, Pencil, Plus, Target, Trash2 } from "lucide-react";
import { saveCampaignCustomMcpAction, saveCampaignPlanAction, syncCampaignToolsAction, syncCampaignAgentsAction } from "@/app/actions/workspace";
import type { CampaignConfigurationResult, ManualCampaignIntegration, SavedCampaign } from "@/lib/server/agent-workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

function SaveMessage({ result }: { result: CampaignConfigurationResult }) {
  if (result.error) return <p className="form-error" role="alert">{result.error}</p>;
  if (result.synced || result.staged) {
    return <p className="workspace-save-status" role="status">{result.staged ? "Saved for first start." : "Changes synced."}</p>;
  }
  return null;
}

type PlanRow = { id: number; text: string };
const maxPlanItems = 32;
const cleanItems = (rows: PlanRow[]) => rows.map(({ text }) => text.trim()).filter(Boolean);
const sameItems = (rows: PlanRow[], saved: string[]) => {
  const items = cleanItems(rows);
  return items.length === saved.length && items.every((text, index) => text === saved[index]);
};

/** Fits a textarea to its content so short items stay one line and long ones never scroll. */
function fit(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "auto";
  element.style.height = element.scrollHeight + "px";
}

function PlanList({ name, label, item, hint, ordered, icon, rows, onChange, nextId }: {
  name: string; label: string; item: string; hint: string; ordered: boolean; icon: ReactNode;
  rows: PlanRow[]; onChange: (rows: PlanRow[]) => void; nextId: () => number;
}) {
  const fields = useRef(new Map<number, HTMLTextAreaElement>());
  const focus = useRef<{ id: number; end?: boolean }>(undefined);
  const hintId = useId();
  const noun = item.toLowerCase();
  const full = rows.length >= maxPlanItems;

  useEffect(() => {
    if (!focus.current) return;
    const field = fields.current.get(focus.current.id);
    if (field) {
      field.focus();
      if (focus.current.end) field.setSelectionRange(field.value.length, field.value.length);
    }
    focus.current = undefined;
  });

  const add = (after = rows.length - 1) => {
    if (full) return;
    const id = nextId();
    focus.current = { id };
    onChange([...rows.slice(0, after + 1), { id, text: "" }, ...rows.slice(after + 1)]);
  };
  const remove = (index: number) => {
    const neighbour = rows[index - 1] ?? rows[index + 1];
    if (neighbour) focus.current = { id: neighbour.id, end: true };
    onChange(rows.filter((_, position) => position !== index));
  };
  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    focus.current = { id: rows[index].id };
    onChange(next);
  };

  return (
    <fieldset className="campaign-plan-list" data-ordered={ordered || undefined}>
      <legend className="campaign-plan-legend">
        <span className="campaign-plan-legend-icon" aria-hidden="true">{icon}</span>
        {label}
        <span className="campaign-plan-count">{rows.length} of {maxPlanItems}</span>
      </legend>
      {rows.length === 0
        ? <p className="campaign-plan-empty">No {noun}s yet.</p>
        : <ol className="campaign-plan-rows">
          {rows.map(({ id, text }, index) => (
            <li key={id} className="campaign-plan-row">
              <span className="campaign-plan-marker" aria-hidden="true">{ordered ? index + 1 : <CircleCheck size={16} />}</span>
              <textarea name={name} value={text} rows={1} maxLength={2000} aria-label={item + " " + (index + 1)} aria-describedby={hintId}
                placeholder={ordered ? "Describe this step" : "Describe the outcome"}
                ref={(element) => {
                  if (element) { fields.current.set(id, element); fit(element); } else fields.current.delete(id);
                }}
                onChange={(event) => onChange(rows.map((row) => row.id === id ? { id, text: event.target.value } : row))}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); add(index); }
                  else if (event.key === "Backspace" && !text && rows.length > 0) { event.preventDefault(); remove(index); }
                  else if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
                    event.preventDefault(); move(index, event.key === "ArrowUp" ? -1 : 1);
                  }
                }} />
              <span className="campaign-plan-row-actions">
                <Button type="button" variant="ghost" size="icon-sm" disabled={index === 0}
                  aria-label={`Move ${noun} ${index + 1} up`} title="Move up" onClick={() => move(index, -1)}><ArrowUp /></Button>
                <Button type="button" variant="ghost" size="icon-sm" disabled={index === rows.length - 1}
                  aria-label={`Move ${noun} ${index + 1} down`} title="Move down" onClick={() => move(index, 1)}><ArrowDown /></Button>
                <Button type="button" variant="ghost" size="icon-sm" className="campaign-plan-remove"
                  aria-label={`Remove ${noun} ${index + 1}`} title="Remove" onClick={() => remove(index)}><Trash2 /></Button>
              </span>
            </li>
          ))}
        </ol>}
      <div className="campaign-plan-list-footer">
        <Button type="button" variant="outline" size="sm" disabled={full} onClick={() => add()}><Plus /> Add {noun}</Button>
        <p id={hintId} className="campaign-plan-hint">{full ? `You can save up to ${maxPlanItems} ${noun}s.` : hint}</p>
      </div>
    </fieldset>
  );
}

function PlanForm({ campaign, revision, action, pending, error, onCancel }: {
  campaign: SavedCampaign; revision: string; action: (form: FormData) => void; pending: boolean; error?: string; onCancel: () => void;
}) {
  // Row IDs only need to be unique within a list; saved items take the first IDs and new rows count up after them.
  const counter = useRef(maxPlanItems);
  const nextId = () => counter.current++;
  const toRows = (items: string[]) => items.map((text, id) => ({ id, text }));
  // Keep the revision the editor opened with, so a concurrent change is reported instead of overwritten.
  const [baseRevision] = useState(revision);
  const [name, setName] = useState(campaign.name);
  const [description, setDescription] = useState(campaign.description);
  const [goals, setGoals] = useState(() => toRows(campaign.goals));
  const [plans, setPlans] = useState(() => toRows(campaign.plans));
  const dirty = name !== campaign.name || description !== campaign.description
    || !sameItems(goals, campaign.goals) || !sameItems(plans, campaign.plans);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <form action={action} className="campaign-plan-form" aria-labelledby="campaign-plan-form-heading"
      onKeyDown={(event) => { if (event.key === "Escape" && !dirty && !pending) onCancel(); }}>
      <input type="hidden" name="revision" value={baseRevision} />
      <header className="campaign-plan-form-heading">
        <h2 id="campaign-plan-form-heading">Edit plan</h2>
        <p>Goals describe the outcomes agents work toward. Steps are the order they follow. Both support Markdown such as **bold** and links.</p>
      </header>
      <fieldset disabled={pending} className="campaign-plan-fields">
        <section className="campaign-plan-details" aria-label="Campaign details">
          <label>Campaign name
            <Input name="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required />
          </label>
          <label>Description
            <Textarea name="description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} rows={3}
              placeholder="What this campaign is for, in a sentence or two" />
          </label>
        </section>
        <PlanList name="goals" label="Goals" item="Goal" ordered={false} icon={<Target size={16} />} rows={goals} onChange={setGoals}
          nextId={nextId} hint="Press Enter for a new goal and Shift+Enter for a line break. Alt+↑ or Alt+↓ reorders." />
        <PlanList name="plans" label="Plan steps" item="Step" ordered icon={<ListOrdered size={16} />} rows={plans} onChange={setPlans}
          nextId={nextId} hint="Press Enter for a new step and Shift+Enter for a line break. Alt+↑ or Alt+↓ reorders." />
      </fieldset>
      <div className="campaign-plan-actions">
        <p className="campaign-plan-state" role="status">
          {error ? <span className="form-error" role="alert">{error}</span> : pending ? "Saving…" : dirty ? "Unsaved changes" : "No changes yet"}
        </p>
        <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>{dirty ? "Discard changes" : "Cancel"}</Button>
        <Button disabled={pending || !dirty}>{pending ? "Saving plan…" : "Save plan"}</Button>
      </div>
    </form>
  );
}

/** Shows the saved plan with an Edit plan action, and swaps it for the editor in place. */
export function CampaignPlanEditor({ campaign, revision, children }: { campaign: SavedCampaign; revision: string; children?: ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [result, action, pending] = useActionState(async (previous: CampaignConfigurationResult, form: FormData) => {
    const next = await saveCampaignPlanAction(campaign.id, previous, form);
    if (!next.error) {
      setEditing(false);
      setNotice(next.staged ? "Plan saved. Agents get it on first start." : "Plan saved and synced to the agents.");
    }
    return next;
  }, {});

  if (editing) {
    return <PlanForm campaign={campaign} revision={revision} action={action} pending={pending}
      error={result.error} onCancel={() => setEditing(false)} />;
  }
  return <>
    <div className="campaign-plan-toolbar">
      {notice ? <p className="workspace-save-status" role="status">{notice}</p> : <span />}
      <Button type="button" variant="outline" onClick={() => { setNotice(undefined); setEditing(true); }}>
        <Pencil aria-hidden="true" /> Edit plan
      </Button>
    </div>
    {children}
  </>;
}

export function CampaignToolSync({ campaignId, revision, disabled }: {
  campaignId: string; revision: string; disabled: boolean;
}) {
  const [result, action, pending] = useActionState(syncCampaignToolsAction.bind(null, campaignId), {});
  return (
    <form className="campaign-tool-sync" action={action}>
      <input type="hidden" name="revision" value={revision} />
      <Button variant="outline" disabled={disabled || pending}>{pending ? "Syncing tools…" : "Sync tools"}</Button>
      <SaveMessage result={result} />
    </form>
  );
}

export function CampaignCustomMcp({ campaignId, revision, integration }: {
  campaignId: string; revision: string; integration: ManualCampaignIntegration;
}) {
  const [result, action, pending] = useActionState(saveCampaignCustomMcpAction.bind(null, campaignId, integration.id), {});
  const [url, setUrl] = useState(integration.url);
  return (
    <details className="campaign-edit-disclosure">
      <summary>{integration.name} <span>{integration.url ? "Saved" : "Setup required"}</span></summary>
      <form action={action} className="workspace-editor">
        <input type="hidden" name="revision" value={revision} />
        <label>MCP endpoint URL
          <Input type="url" name="url" value={url} onChange={(event) => setUrl(event.target.value)}
            placeholder="https://mcp.example.com/mcp" maxLength={2048} readOnly={pending} required />
        </label>
        <p>Use an approved HTTPS Streamable HTTP endpoint. Don’t include credentials in the URL.</p>
        {!pending && result.error && <p className="form-error" role="alert">{result.error}</p>}
        {!pending && result.mcpToolCount && <p className="workspace-save-status" role="status">
          MCP health check passed. Found {result.mcpToolCount} {result.mcpToolCount === 1 ? "tool" : "tools"}. Use Sync tools or Start to apply the saved connection.
        </p>}
        <Button disabled={pending} variant="outline">{pending ? "Checking MCP…" : "Test and save"}</Button>
      </form>
    </details>
  );
}

export function CampaignAgentSync({ campaignId, revision }: { campaignId: string; revision: string }) {
  const [result, action, pending] = useActionState(syncCampaignAgentsAction.bind(null, campaignId), {});
  return (
    <form className="campaign-agent-sync" action={action}>
      <input type="hidden" name="revision" value={revision} />
      <p>Ask campaign chat to change an agent’s instructions or settings.</p>
      <Button variant="outline" disabled={pending}>{pending ? "Syncing agents…" : "Sync saved agent changes"}</Button>
      <SaveMessage result={result} />
    </form>
  );
}
