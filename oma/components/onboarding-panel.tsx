"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import {
  answerOnboardingAction, changeCampaignPropertyAction, pauseCampaignAction, refreshOnboardingAction,
  saveOnboardingAction, sendOnboardingAction,
} from "@/app/actions/onboarding";
import type { OnboardingView as View } from "@/lib/server/marketing/state";

export function OnboardingPanel({ initial, available }: { initial: View; available: boolean }) {
  const [view, setView] = useState(initial);
  const [text, setText] = useState("");
  const [property, setProperty] = useState(initial.campaign?.brief.playbook.property ?? "");
  const [busy, start] = useTransition();
  const { onboarding, campaign, question, requestError } = view;
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
        {!campaign && <p>Tell Hermes about your business. It will prepare your brand brief, knowledge base, and first SEO campaign.</p>}
      </div>
      {!available && <p className="form-error" role="status">Start the full OMA stack to use Hermes and run campaigns.</p>}
      {requestError && <p className="form-error" role="alert">{requestError}</p>}
      {campaign ? (
        <div className="onboarding-content">
          <section className="onboarding-card">
            <h2>{campaign.brief.brand.name}</h2>
            <p><strong>Audience</strong> {campaign.brief.brand.audience}</p>
            <p><strong>Brand voice</strong> {campaign.brief.brand.voice}</p>
            {campaign.brief.brand.assets.length > 0 && <>
              <h3>Brand assets</h3>
              <ul>{campaign.brief.brand.assets.map((asset, i) => <li key={i}>{asset}</li>)}</ul>
            </>}
            <h3>Knowledge base</h3>
            <ul>{campaign.brief.knowledge.map((note, i) => <li key={i}>{note}</li>)}</ul>
          </section>
          <section className="onboarding-card">
            <h2>{campaign.brief.playbook.title}</h2>
            <p>{campaign.brief.playbook.goal}</p>
            <p>{campaign.brief.playbook.approach}</p>
            <p><strong>Search Console property</strong> {campaign.brief.playbook.property}</p>
            <p role="status">
              {campaign.notice ?? {
                waiting: "Waiting for Google Search Console. The campaign will start automatically after connection.",
                running: "The SEO team is preparing a draft and review.",
                active: "Active. The next campaign cycle runs tomorrow.",
                paused: "Campaign paused.",
                error: "The campaign will retry automatically.",
              }[campaign.status]}
            </p>
            <div className="onboarding-actions">
              <Link href="/connections" className="btn secondary">Manage connections</Link>
              <button type="button" className="btn secondary" disabled={busy || !available}
                onClick={() => run(() => pauseCampaignAction(campaign.status !== "paused"))}>
                {campaign.status === "paused" ? "Resume campaign" : "Pause campaign"}
              </button>
            </div>
            <details>
              <summary>Change Search Console property</summary>
              <form className="onboarding-content" onSubmit={(event) => {
                event.preventDefault();
                if (!busy && property.trim()) run(() => changeCampaignPropertyAction(property));
              }}>
                <label htmlFor="campaign-property">New property</label>
                <input id="campaign-property" value={property} onChange={(event) => setProperty(event.target.value)}
                  maxLength={500} placeholder="sc-domain:example.com" required />
                <button className="btn secondary" type="submit" disabled={busy || !property.trim()}>Save property</button>
              </form>
            </details>
          </section>
          {campaign.report && <section className="onboarding-card">
            <h2>Latest draft</h2>
            {campaign.report.property !== campaign.brief.playbook.property && <p>{campaign.report.property}</p>}
            <div className="onboarding-text">{campaign.report.draft}</div>
            <h3>Verifier’s review</h3>
            <div className="onboarding-text">{campaign.report.review}</div>
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
          {onboarding?.messages.some((message) => message.role === "assistant") && <form className="onboarding-content" onSubmit={(event) => {
            event.preventDefault();
            if (available && !busy && !pending) run(() => saveOnboardingAction(property));
          }}>
            <label htmlFor="onboarding-property">Search Console property</label>
            <input id="onboarding-property" type="text" value={property} onChange={(event) => setProperty(event.target.value)}
              maxLength={500} required placeholder="sc-domain:example.com" disabled={!available || busy || pending} />
            <div className="onboarding-actions">
              <button className="btn secondary" type="submit" disabled={!available || busy || pending || !property.trim()}>Save workspace</button>
            </div>
            <p>Saving authorizes a recurring SEO draft after you connect Search Console. You can pause it at any time.</p>
          </form>}
        </div>
      )}
    </div>
  );
}
