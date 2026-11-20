/** Displays the saved setup chat and submits choices and custom answers to the bundled agent. */

"use client";

import { ArrowRight, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";

import { answerSetup, finishSetup, refreshSetup, startSetup } from "@/app/actions/onboarding";
import { maxSetupAnswerLength, setupGreeting, type OnboardingView, type SetupQuestion } from "@/lib/onboarding";

export function OnboardingChat({ initial }: { initial: OnboardingView }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [connectionError, setConnectionError] = useState("");
  const [writeError, setWriteError] = useState<{ message: string; turn: number }>();
  const [retry, setRetry] = useState(0);
  const [pending, startTransition] = useTransition();
  const active = useRef<HTMLDivElement>(null);
  const reply = useRef<HTMLParagraphElement>(null);
  const { history, step } = view;
  const running = step.status === "running";
  const question = step.status === "running" ? step.question : undefined;
  const questionKey = question ? `${question.id}:${question.generation}` : undefined;

  useEffect(() => {
    if (step.status === "closed") router.replace("/dashboard");
  }, [router, step.status]);

  useEffect(() => {
    if (history.length) active.current?.scrollIntoView({ block: "start" });
  }, [history.length]);

  useEffect(() => {
    if (questionKey || step.status === "ready") reply.current?.focus({ preventScroll: true });
  }, [questionKey, step.status]);

  useEffect(() => {
    if (!running || pending) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const result = await refreshSetup();
        if (cancelled) return;
        if (!result.ok) {
          setConnectionError(result.message);
          return;
        }
        setConnectionError("");
        setView(result.data);
        if (result.data.step.status === "running") timer = setTimeout(() => void poll(), 1600);
      } catch {
        if (!cancelled) setConnectionError("Couldn’t check your setup. Try reconnecting.");
      }
    }

    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [running, pending, retry]);

  function update(operation: () => ReturnType<typeof startSetup>) {
    if (pending) return;
    setWriteError(undefined);
    setConnectionError("");
    startTransition(async () => {
      try {
        const result = await operation();
        if (result.ok) setView(result.data);
        else setWriteError({ message: result.message, turn: history.length });
      } catch {
        setWriteError({ message: "Couldn’t update your setup. Try again.", turn: history.length });
      }
    });
  }

  if (step.status === "closed") return null;

  const intro = step.status === "intro";
  const message = step.status === "ready" || step.status === "failed" ? step.message : question?.question;
  const typing = running && !question && !connectionError;
  const error = writeError?.turn === history.length ? writeError.message : connectionError;

  return (
    <section className="onboarding-conversation" aria-label="Workspace setup conversation">
      {history.map(({ question }, index) => (
        <div className="onboarding-turn" key={index}>
          <UserMessage text={index === 0 ? setupGreeting : (history[index - 1].answer || "Skipped")} />
          <div className="onboarding-transcript-reply">
            <span className="sr-only">Assistant</span>
            <p className="onboarding-reply-text">{question}</p>
          </div>
        </div>
      ))}
      <div className="onboarding-turn onboarding-active-turn" ref={active}>
        {!intro && <UserMessage text={history.length ? (history.at(-1)?.answer || "Skipped") : setupGreeting} />}
        <div className="onboarding-answer-panel">
          {intro && (
            <>
              <h1 className="onboarding-title">Set up your workspace</h1>
              <p className="onboarding-reply-text">Share a little about your project and what you want to improve. The agent will suggest a campaign to start with.</p>
              <button type="button" className="onboarding-enter" onClick={() => update(startSetup)} disabled={pending}>
                {pending ? "Starting…" : "Start setup"} <ArrowRight size={18} aria-hidden="true" />
              </button>
            </>
          )}
          {(message || typing) && (
            <div className="onboarding-reply">
              {message ? (
                <p id={question ? "onboarding-question" : undefined} className="onboarding-reply-text"
                  ref={reply} tabIndex={-1} role="status">{message}</p>
              ) : (
                <>
                  <span className="sr-only" role="status">oma-agent is working.</span>
                  <div className="onboarding-typing" aria-hidden="true"><i /><i /><i /></div>
                </>
              )}
            </div>
          )}
          {question && (
            <QuestionAnswer key={questionKey} question={question} pending={pending}
              onAnswer={(answer) => update(() => answerSetup(question.id, question.generation, answer))} />
          )}
          {step.status === "failed" && (
            <button type="button" className="onboarding-enter" disabled={pending} onClick={() => update(startSetup)}>
              {pending ? "Resuming…" : "Resume setup"}
            </button>
          )}
          {step.status === "ready" && (
            <form action={finishSetup}>
              <button className="onboarding-enter">Open workspace <ArrowRight size={18} aria-hidden="true" /></button>
            </form>
          )}
          {error && (
            <div className="onboarding-reply-error">
              <span role="alert">{error}</span>
              {running && <button type="button" disabled={pending} onClick={() => {
                setWriteError(undefined);
                setConnectionError("");
                setRetry((attempt) => attempt + 1);
              }}>Refresh status</button>}
            </div>
          )}
          {question && pending && <p className="onboarding-write-status" role="status">Sending your answer…</p>}
        </div>
      </div>
    </section>
  );
}

function UserMessage({ text }: { text: string }) {
  return (
    <div className="onboarding-user-message">
      <span className="sr-only">You</span>
      <p>{text}</p>
    </div>
  );
}

function QuestionAnswer({ question, pending, onAnswer }: {
  question: SetupQuestion;
  pending: boolean;
  onAnswer: (answer: string) => void;
}) {
  const [custom, setCustom] = useState("");
  const [checked, setChecked] = useState<number[]>([]);
  const input = custom.trim();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const choices = question.choices.filter((_, index) => checked.includes(index));
    if (input) choices.push(input);
    if (choices.length) onAnswer(question.multiSelect ? JSON.stringify(choices) : choices[0]);
  }

  return (
    <form aria-labelledby="onboarding-question" onSubmit={submit}>
      {question.choices.length > 0 && (
        <ol className="onboarding-options" role="list" aria-label="Answer choices">
          {question.choices.map((choice, index) => (
            <li key={index}>
              {question.multiSelect ? (
                <label>
                  <input type="checkbox" disabled={pending} checked={checked.includes(index)} onChange={(event) => {
                    const selected = event.target.checked;
                    setChecked((current) => selected ? [...current, index] : current.filter((item) => item !== index));
                  }} />
                  <span>{choice}</span>
                </label>
              ) : (
                <button type="button" disabled={pending} onClick={() => onAnswer(choice)}>
                  <span className="onboarding-option-number" aria-hidden="true">{index + 1}</span>
                  <span>{choice}</span>
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      <div className="onboarding-composer">
        <div className="onboarding-custom-answer">
          <Pencil size={17} aria-hidden="true" />
          <label className="sr-only" htmlFor="onboarding-answer">Or write your own response</label>
          <input id="onboarding-answer" autoComplete="off" maxLength={maxSetupAnswerLength}
            placeholder="Or write your own response" readOnly={pending} value={custom}
            onChange={(event) => setCustom(event.target.value)} />
        </div>
        <button type="button" className="onboarding-skip" disabled={pending} onClick={() => onAnswer("")}>
          Skip<span className="sr-only"> this step</span>
        </button>
        <button className="onboarding-send" disabled={pending || (!input && checked.length === 0)}>Send</button>
      </div>
    </form>
  );
}
