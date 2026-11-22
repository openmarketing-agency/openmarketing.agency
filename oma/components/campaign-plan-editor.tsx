/** Edits a saved campaign plan alongside a proposal-only chat with oma-agent. */

"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, MessageSquare, Plus, Send, X } from "lucide-react";

import { askCampaignPlanAction, saveCampaignPlanAction } from "@/app/actions/workspace";
import { campaignPlanMessageLimit, type CampaignPlan, type CampaignPlanMessage, type CampaignPlanReply } from "@/lib/campaign-plan";

type Draft = { plan: CampaignPlan; revision: string };

function cleanPlan(plan: CampaignPlan) {
  return { ...plan, goals: plan.goals.filter((item) => item.trim()), plans: plan.plans.filter((item) => item.trim()) };
}

export function CampaignPlanEditor({ campaignId, saved, active, onDirtyChange }: {
  campaignId: string;
  saved: Draft;
  active: boolean;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [working, setWorking] = useState<Draft>();
  const [savedLocally, setSavedLocally] = useState<Draft>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [history, setHistory] = useState<CampaignPlanMessage[]>([]);
  const [message, setMessage] = useState("");
  const [asking, setAsking] = useState(false);
  const [chatError, setChatError] = useState("");
  const [suggestion, setSuggestion] = useState<{ plan: NonNullable<CampaignPlanReply["plan"]>; against: string }>();
  const editor = useRef<HTMLInputElement>(null);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const base = savedLocally?.revision === saved.revision ? savedLocally : saved;
  const plan = working?.plan ?? base.plan;
  const suggestedFromCurrentDraft = suggestion?.against === JSON.stringify(cleanPlan(plan));

  useEffect(() => {
    const last = transcriptEnd.current;
    const log = last?.parentElement;
    if (active && last && log) log.scrollTop = log.scrollHeight;
  }, [active, history, asking, suggestion]);

  function update(next: CampaignPlan) {
    setWorking({ plan: next, revision: working?.revision ?? base.revision });
    setSavedMessage("");
    onDirtyChange(true);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!working || saving) return;
    setSaving(true);
    setSaveError("");
    const next = cleanPlan(working.plan);
    try {
      const result = await saveCampaignPlanAction(campaignId, { ...next, revision: working.revision });
      if (!result.ok) {
        setSaveError(result.message);
        return;
      }
      setSavedLocally({ plan: next, revision: result.revision });
      setWorking(undefined);
      setSavedMessage("Campaign plan saved.");
      onDirtyChange(false);
    } catch {
      setSaveError("Couldn’t save the campaign plan. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = message.trim();
    if (!content || asking) return;
    const draft = cleanPlan(plan);
    const turn = { role: "user", content } as const;
    setChatError("");
    setAsking(true);
    try {
      const result = await askCampaignPlanAction(campaignId, { draft, history: [...history.slice(-10), turn] });
      if (!result.ok) {
        setChatError(result.message);
        return;
      }
      setHistory((previous) => [...previous, turn, { role: "assistant", content: result.reply }]);
      setMessage("");
      setSuggestion(result.plan ? { plan: result.plan, against: JSON.stringify(draft) } : undefined);
    } catch {
      setChatError("Couldn’t reach oma-agent. Your message is ready to retry.");
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="campaign-planner" hidden={!active}>
      <section className="campaign-reading" aria-labelledby="campaign-plan-editor-heading">
        <header className="campaign-plan-heading">
          <h2 id="campaign-plan-editor-heading">Edit campaign plan</h2>
          <a className="campaign-chat-jump" href="#campaign-plan-chat">Edit with chat <ArrowDown size={14} aria-hidden="true" /></a>
        </header>
        <form className="workspace-editor campaign-plan-form" onSubmit={(event) => void save(event)}>
          <fieldset disabled={saving}>
            <label>Campaign name<input ref={editor} value={plan.name} required maxLength={120}
              onChange={(event) => update({ ...plan, name: event.target.value })} /></label>
            <label>Description<textarea value={plan.description} rows={3} maxLength={4000}
              onChange={(event) => update({ ...plan, description: event.target.value })} /></label>
            {(["goals", "plans"] as const).map((field) => {
              const label = field === "goals" ? "Goal" : "Plan step";
              return (
                <fieldset key={field} className="campaign-plan-items">
                  <legend>{field === "goals" ? "Goals" : "Plan steps"}</legend>
                  {plan[field].map((item, index) => (
                    <div key={index} className="campaign-plan-item">
                      <label><span className="sr-only">{label} {index + 1}</span>
                        <textarea rows={2} maxLength={2000} value={item} dir="auto"
                          onChange={(event) => update({
                            ...plan, [field]: plan[field].map((value, i) => i === index ? event.target.value : value),
                          })} />
                      </label>
                      <button className="icon-button" type="button" aria-label={"Remove " + label.toLowerCase() + " " + (index + 1)}
                        onClick={() => update({ ...plan, [field]: plan[field].filter((_, i) => i !== index) })}>
                        <X size={16} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  <button className="btn secondary" type="button" disabled={plan[field].length >= 32}
                    onClick={() => update({ ...plan, [field]: [...plan[field], ""] })}>
                    <Plus size={15} aria-hidden="true" /> Add {label.toLowerCase()}
                  </button>
                </fieldset>
              );
            })}
            {saveError && <p className="form-error" role="alert">{saveError}</p>}
            {savedMessage && <p className="workspace-save-status" role="status">{savedMessage}</p>}
            <div className="workspace-editor-actions">
              <button className="btn primary" disabled={!working || saving}>{saving ? "Saving…" : "Save plan"}</button>
              {working && <button className="btn secondary" type="button" onClick={() => {
                setWorking(undefined);
                setSaveError("");
                onDirtyChange(false);
              }}>Discard edits</button>}
            </div>
          </fieldset>
        </form>
      </section>
      <section id="campaign-plan-chat" className="campaign-plan-chat" aria-labelledby="campaign-plan-chat-heading">
        <header className="campaign-chat-heading">
          <MessageSquare size={18} aria-hidden="true" />
          <h2 id="campaign-plan-chat-heading">Edit with oma-agent</h2>
        </header>
        <div className="campaign-plan-messages" role="log" aria-label="Campaign conversation">
          {!history.length && <p className="campaign-chat-hint">Ask for changes to this campaign’s goals, description, or plan. Review suggestions in the editor before saving.</p>}
          {history.map(({ role, content }, index) => (
            <div key={index} className="campaign-chat-message" data-author={role}>
              <span>{role === "user" ? "You" : "oma-agent"}</span><p>{content}</p>
            </div>
          ))}
          {asking && <p role="status" className="campaign-chat-hint">oma-agent is drafting a reply…</p>}
          <div ref={transcriptEnd} />
        </div>
        {suggestion && (
          <div className="campaign-chat-review">
            {suggestedFromCurrentDraft ? (
              <button className="btn secondary" type="button" disabled={saving} onClick={() => {
                update(suggestion.plan);
                setSuggestion(undefined);
                editor.current?.focus();
              }}>Review suggestion</button>
            ) : <p>The draft changed. Ask oma-agent to update its suggestion.</p>}
          </div>
        )}
        <form className="campaign-chat-form" onSubmit={(event) => void send(event)}>
          {chatError && <p className="form-error" role="alert">{chatError}</p>}
          <label className="sr-only" htmlFor="campaign-chat-message">Message oma-agent</label>
          <textarea id="campaign-chat-message" value={message} onChange={(event) => setMessage(event.target.value)}
            placeholder="Suggest a change to this campaign…" rows={3} maxLength={campaignPlanMessageLimit} required disabled={asking} />
          <button className="btn primary" disabled={asking || !message.trim()}><Send size={15} aria-hidden="true" /> Send</button>
        </form>
      </section>
    </div>
  );
}
