/** Displays the saved setup chat and submits choices and custom answers to the bundled agent. */

"use client";

import { ArrowRight, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";

import { answerSetup, finishSetup, refreshSetup, resetDevelopmentSetup, startSetup } from "@/app/actions/onboarding";
import { maxSetupAnswerLength, type OnboardingView, type SetupQuestion } from "@/lib/onboarding";

export function OnboardingChat({ initial, resetOnOpen }: { initial: OnboardingView; resetOnOpen: boolean }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [opening, setOpening] = useState<"checking" | "ready" | { error: string }>(resetOnOpen ? "checking" : "ready");
  const reloadRequest = useRef<ReturnType<typeof resetDevelopmentSetup>>(undefined);
  const [connectionError, setConnectionError] = useState("");
  const [writeError, setWriteError] = useState<{ message: string; turn: number }>();
  const [retry, setRetry] = useState(0);
  const [pending, startTransition] = useTransition();
  const active = useRef<HTMLDivElement>(null);
  const reply = useRef<HTMLParagraphElement>(null);
  const { history, step } = view;
  const shouldPoll = step.status === "intro" || step.status === "running";
  const question = step.status === "running" ? step.question : undefined;
  const questionKey = question ? `${question.id}:${question.generation}` : undefined;

  useEffect(() => {
    if (opening !== "checking") return;
    // Both effect passes in development share the same reset request.
    reloadRequest.current ??= resetDevelopmentSetup();
    let cancelled = false;
    void reloadRequest.current.then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setOpening({ error: result.message });
        return;
      }
      setView(result.data);
      setOpening("ready");
    }, () => {
      if (!cancelled) setOpening({ error: "Couldn’t reset setup. Refresh the page to try again." });
    });
    return () => { cancelled = true; };
  }, [opening]);

  useEffect(() => {
    if (opening === "ready" && step.status === "closed") router.replace("/dashboard");
  }, [opening, router, step.status]);

  useEffect(() => {
    if (opening === "ready" && history.length) active.current?.scrollIntoView({ block: "start" });
  }, [opening, history.length]);

  useEffect(() => {
    if (opening === "ready" && (questionKey || step.status === "ready")) reply.current?.focus({ preventScroll: true });
  }, [opening, questionKey, step.status]);

  useEffect(() => {
    if (opening !== "ready" || !shouldPoll || pending) return;
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
  }, [opening, shouldPoll, pending, retry]);

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

  if (opening === "checking") return <p className="onboarding-loading-page sr-only" role="status">Loading your setup…</p>;
  if (opening !== "ready") return <p className="onboarding-loading-page" role="alert">{opening.error}</p>;
  if (step.status === "closed") return null;

  const message = step.status === "ready" || step.status === "failed" ? step.message : question?.question;
  const typing = shouldPoll && !question && !connectionError;
  const error = writeError?.turn === history.length ? writeError.message : connectionError;

  return (
    <section className="onboarding-conversation" aria-label="Workspace setup conversation">
      <h1 className="sr-only">Set up your workspace</h1>
      {history.map(({ question }, index) => (
        <div className="onboarding-turn" key={index}>
          {index > 0 && <UserMessage text={history[index - 1].answer || "Skipped"} />}
          <div className="onboarding-transcript-reply">
            <span className="sr-only">Assistant</span>
            <p className="onboarding-reply-text">{question}</p>
          </div>
        </div>
      ))}
      <div className="onboarding-turn onboarding-active-turn" ref={active}>
        {history.length > 0 && <UserMessage text={history.at(-1)?.answer || "Skipped"} />}
        <div className="onboarding-answer-panel">
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
              {shouldPoll && <button type="button" disabled={pending} onClick={() => {
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
