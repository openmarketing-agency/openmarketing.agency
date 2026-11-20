/** Presents the persisted setup transcript and forwards answers to the current agent question. */

"use client";

import { ArrowRight, MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { answerSetup, finishSetup, refreshSetup, startSetup } from "@/app/actions/onboarding";
import { HermesPrompt } from "@/components/hermes-prompt";
import { maxSetupAnswerLength, type OnboardingView } from "@/lib/onboarding";

export function OnboardingChat({ initial }: { initial: OnboardingView }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [starting, startTransition] = useTransition();
  const { history, step } = view;
  const running = step.status === "running";

  useEffect(() => {
    if (step.status === "closed") router.replace("/dashboard");
  }, [router, step.status]);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const result = await refreshSetup();
        if (cancelled) return;
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setError("");
        setView(result.data);
        if (result.data.step.status === "running") timer = setTimeout(() => void poll(), 1600);
      } catch {
        if (!cancelled) setError("Couldn’t check your setup. Try reconnecting.");
      }
    }

    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [running, retry]);

  function start() {
    setError("");
    startTransition(async () => {
      try {
        const result = await startSetup();
        if (result.ok) setView(result.data);
        else setError(result.message);
      } catch {
        setError("Couldn’t start setup. Try again.");
      }
    });
  }

  const question = step.status === "running" ? step.question : undefined;

  return (
    <section className="onboarding-conversation" aria-label="Workspace setup conversation">
      {history.length > 0 && (
        <ol className="onboarding-transcript" aria-label="Saved answers">
          {history.map(({ question, answer }, index) => (
            <li key={index}>
              <p className="onboarding-question">{question}</p>
              <p className="onboarding-answer"><span className="sr-only">Your answer. </span>{answer || "Skipped"}</p>
            </li>
          ))}
        </ol>
      )}
      <div className="onboarding-current">
        {step.status === "intro" && (
          <div className="onboarding-welcome">
            <MessageSquare size={24} aria-hidden="true" />
            <div>
              <h2>Start with a short conversation</h2>
              <p>Share the public details you want to use, such as your website and marketing goal. You can skip any question.</p>
            </div>
            <button className="btn primary" onClick={start} disabled={starting}>
              {starting ? "Starting…" : "Start setup"} <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        )}
        {question && (
          <HermesPrompt
            key={`${question.id}:${question.generation}`}
            prompt={question}
            maxAnswerLength={maxSetupAnswerLength}
            skipLabel="Skip question"
            onAnswer={async (answer) => {
              const result = await answerSetup(question.id, question.generation, answer);
              if (!result.ok) {
                setRetry((attempt) => attempt + 1);
                return result.message;
              }
              setView(result.data);
              setRetry((attempt) => attempt + 1);
            }}
          />
        )}
        {!question && running && !error && <p role="status">Waiting for oma-agent…</p>}
        {error && (
          <div className="onboarding-actions">
            <p className="form-error" role="alert">{error}</p>
            {running && <button className="btn secondary" onClick={() => {
              setError("");
              setRetry((attempt) => attempt + 1);
            }}>Retry connection</button>}
          </div>
        )}
        {step.status === "failed" && (
          <div className="onboarding-actions">
            <p role="status">{step.message}</p>
            <button className="btn primary" onClick={start} disabled={starting}>
              {starting ? "Resuming…" : "Resume setup"}
            </button>
          </div>
        )}
        {step.status === "ready" && (
          <div className="onboarding-actions">
            <h2>Ready to get started</h2>
            <p className="onboarding-summary" role="status">{step.message}</p>
            <form action={finishSetup}>
              <button className="btn primary">Open workspace <ArrowRight size={16} aria-hidden="true" /></button>
            </form>
          </div>
        )}
      </div>
    </section>
  );
}
