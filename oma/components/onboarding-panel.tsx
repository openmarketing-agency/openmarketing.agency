"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import {
  activateCampaignAction, answerOnboardingAction, changeCampaignSourcesAction, generatePlaybookAction,
  pauseCampaignAction, refreshOnboardingAction, sendOnboardingAction,
} from "@/app/actions/onboarding";
import { campaignProfiles, campaignSources, type DraftBrief, type Source } from "@/lib/marketing-playbook";
import type { OnboardingView as View } from "@/lib/server/marketing/state";

export function OnboardingPanel({ initial, available }: { initial: View; available: boolean }) {
  const [view, setView] = useState(initial);
  const [text, setText] = useState("");
  const [busy, start] = useTransition();
  const { onboarding, campaign, question, requestError } = view;
  const draft = onboarding?.draft;
  const pending = Boolean(onboarding?.pending);
  const poll = available && (pending || Boolean(campaign && campaign.status !== "paused"));

  useEffect(() => {
    if (!poll || busy) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const latest = await refreshOnboardingAction();
        if (!cancelled) setView(latest);
      } catch {
        if (!cancelled) setView((previous) => ({ ...previous, requestError: "Lost the connection to OMA. Retrying…" }));
      } finally {
        if (!cancelled) timer = setTimeout(refresh, pending ? 1500 : 8000);
      }
    };
    timer = setTimeout(refresh, pending ? 800 : 8000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [poll, busy, pending]);

  function run(action: () => Promise<View>, clear = false) {
    start(async () => {
      try {
        const result = await action();
        setView(result);
        if (clear && !result.requestError) setText("");
      } catch {
        setView((previous) => ({ ...previous, requestError: "Couldn’t reach OMA. Try again." }));
      }
    });
  }

  function send(event: FormEvent) {
    event.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    if (question) run(() => answerOnboardingAction(question.prompt_id, message), true);
    else if (!pending) run(() => sendOnboardingAction(message), true);
  }

  return (
    <div className="onboarding-workspace">
      <div className="agent-page-heading">
        <h1>{campaign ? "Brand & Campaign" : "Set up your marketing workspace"}</h1>
        {!campaign && <p>Tell Hermes about your business and what you want to accomplish. It will prepare a brand brief, knowledge base, and campaign playbook.</p>}
      </div>
      {!available && <p className="form-error" role="status">Start the full OMA stack to use Hermes and run campaigns.</p>}
      {requestError && <p className="form-error" role="alert">{requestError}</p>}
      {campaign ? (
        <div className="onboarding-content">
          <BrandBrief brief={campaign.brief} />
          <section className="onboarding-card">
            <Playbook playbook={campaign.brief.playbook} />
            <SourceList sources={campaign.brief.playbook.sources} />
            <p role="status">
              {campaign.notice ?? {
                waiting: "The campaign will start when its required sources are ready.",
                running: "Hermes is running the playbook.",
                active: "Active. The next campaign cycle runs tomorrow.",
                paused: "Campaign paused.",
                error: "The campaign will retry automatically.",
              }[campaign.status]}
            </p>
            <div className="onboarding-actions">
              {campaign.brief.playbook.sources.length > 0 && <Link href="/connections" className="btn secondary">Manage connections</Link>}
              <button type="button" className="btn secondary" disabled={busy || !available}
                onClick={() => run(() => pauseCampaignAction(campaign.status !== "paused"))}>
                {campaign.status === "paused" ? "Resume campaign" : "Pause campaign"}
              </button>
            </div>
            {campaign.brief.playbook.sources.length > 0 && <details>
              <summary>Change approved source resources</summary>
              <SourceForm sources={campaign.brief.playbook.sources} label="Save resources" disabled={busy}
                onSubmit={(resources) => run(() => changeCampaignSourcesAction(resources))} />
            </details>}
          </section>
          {campaign.report && <section className="onboarding-card">
            <h2>Latest campaign results</h2>
            <SourceList sources={campaign.report.sources} />
            {campaign.report.outputs.map(({ role, text }, i) => <div key={i}>
              <h3>{role}</h3>
              <div className="onboarding-text">{text}</div>
            </div>)}
          </section>}
        </div>
      ) : (
        <div className="onboarding-card">
          <ol className="onboarding-chat" aria-label="Onboarding conversation" aria-live="polite">
            {onboarding?.messages.map((message, i) => <li key={i}>
              <strong>{message.role === "user" ? "You" : "Hermes"}</strong>
              <div className="onboarding-text">{message.text}</div>
            </li>)}
          </ol>
          {onboarding?.error && <p className="form-error" role="alert">{onboarding.error}</p>}
          {question && <fieldset className="onboarding-question">
            <legend>{question.question}</legend>
            <div className="onboarding-actions">
              {question.choices.map((choice, i) => <button key={i} type="button" className="btn secondary"
                disabled={busy} onClick={() => run(() => answerOnboardingAction(question.prompt_id, choice))}>
                {choice}
              </button>)}
            </div>
          </fieldset>}
          {pending && !question && <p role="status">Waiting for Hermes…</p>}
          <form className="onboarding-content" onSubmit={send}>
            <label htmlFor="onboarding-message">{question ? "Your answer" : "Message to Hermes"}</label>
            <textarea id="onboarding-message" value={text} onChange={(event) => setText(event.target.value)}
              rows={4} maxLength={4000} disabled={busy || !available || (pending && !question)} />
            <div className="onboarding-actions">
              <button className="btn primary" type="submit"
                disabled={!available || busy || !text.trim() || (pending && !question)}>Send</button>
            </div>
          </form>
          {!draft && onboarding?.messages.some((message) => message.role === "assistant") &&
            <button className="btn secondary" type="button" disabled={!available || busy || pending}
              onClick={() => run(generatePlaybookAction)}>Generate playbook</button>}
        </div>
      )}
      {draft && <div className="onboarding-content">
        <BrandBrief brief={draft.brief} />
        <section className="onboarding-card">
          <h2>Review your playbook</h2>
          <Playbook playbook={draft.brief.playbook} />
          <p>{draft.brief.playbook.sources.length > 0
            ? "Approve the resources this campaign may read. Hermes starts producing drafts after you connect the required accounts."
            : "This campaign uses your saved brand and knowledge to produce drafts."}</p>
          <p>Send Hermes another message to revise the playbook before activating.</p>
          <SourceForm key={draft.id} sources={draft.brief.playbook.sources.map((toolkit) => ({ toolkit, resource: "" }))}
            label="Activate campaign" disabled={busy || !available || pending}
            onSubmit={(resources) => run(() => activateCampaignAction(draft.id, resources))} />
        </section>
      </div>}
    </div>
  );
}

function BrandBrief({ brief }: { brief: Pick<DraftBrief, "brand" | "knowledge"> }) {
  return (
    <section className="onboarding-card">
      <h2>{brief.brand.name}</h2>
      <p><strong>Audience</strong> {brief.brand.audience}</p>
      <p><strong>Brand voice</strong> {brief.brand.voice}</p>
      {brief.brand.assets.length > 0 && <>
        <h3>Brand assets</h3>
        <ul>{brief.brand.assets.map((asset, i) => <li key={i}>{asset}</li>)}</ul>
      </>}
      <h3>Knowledge base</h3>
      <ul>{brief.knowledge.map((note, i) => <li key={i}>{note}</li>)}</ul>
    </section>
  );
}

function Playbook({ playbook }: { playbook: Omit<DraftBrief["playbook"], "sources"> }) {
  return (
    <>
      <h3>{playbook.title}</h3>
      <p>{playbook.goal}</p>
      <p>{playbook.approach}</p>
      <ol>{playbook.steps.map(({ profile, role, task }, i) => <li key={i}>
        <strong>{role}</strong> · {campaignProfiles[profile]} profile
        <p>{task}</p>
      </li>)}</ol>
    </>
  );
}

function SourceList({ sources }: { sources: Source[] }) {
  if (!sources.length) return null;
  return <ul>{sources.map(({ toolkit, resource }) => <li key={toolkit}>
    <strong>{campaignSources[toolkit].label}</strong> {resource}
  </li>)}</ul>;
}

function SourceForm({ sources, label, disabled, onSubmit }: {
  sources: Source[];
  label: string;
  disabled: boolean;
  onSubmit: (resources: Record<string, string>) => void;
}) {
  return (
    <form className="onboarding-content" onSubmit={(event) => {
      event.preventDefault();
      if (!disabled) onSubmit(Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>);
    }}>
      {sources.map(({ toolkit, resource }) => {
        const spec = campaignSources[toolkit];
        return <label key={toolkit}>{spec.resourceLabel}
          <input type="text" name={toolkit} defaultValue={resource} maxLength={500}
            placeholder={spec.example} required disabled={disabled} />
        </label>;
      })}
      <button className="btn secondary" type="submit" disabled={disabled}>{label}</button>
    </form>
  );
}
