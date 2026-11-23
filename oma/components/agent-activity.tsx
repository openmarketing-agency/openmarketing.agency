/** Streams public project setup activity into chat and lets the user respond or retry. */

"use client";

import { Activity } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useState } from "react";

import { answerProjectSetupPrompt, retryProjectSetup } from "@/app/actions/project-setup";

import type { AgentActivity as Snapshot, AgentActivityUpdate } from "@/lib/agent-activity";

import { HermesPrompt } from "./hermes-prompt";
import "./agent-activity.css";

type SetupStatus = NonNullable<Snapshot["setup"]>["status"];
const setupStatus: Record<SetupStatus, string> = {
  not_sent: "Ready to send to oma-agent",
  queued: "Queued",
  running: "Waiting for an update",
  waiting_for_answer: "Waiting for an answer",
  waiting_for_approval: "Waiting for approval",
  stopping: "Stopping",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  unknown: "State unconfirmed",
  unavailable: "Run no longer available",
  connection_lost: "Couldn’t check progress",
};
const activeSetup = new Set<SetupStatus>(["queued", "running", "waiting_for_answer", "waiting_for_approval", "stopping"]);
const finishedSetup = new Set<SetupStatus>(["completed", "failed", "cancelled"]);
const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });

export function AgentActivity() {
  const router = useRouter();
  const headingId = useId();
  const [retryResult, retryAction, retrying] = useActionState(retryProjectSetup, {});
  const [data, setData] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [updates, setUpdates] = useState<AgentActivityUpdate[]>([]);

  useEffect(() => {
    let disposed = false;
    let scheduled: ReturnType<typeof setTimeout>;
    let request: AbortController | undefined;
    let sawActiveSetup = false;
    let signedOut = false;
    let stream: EventSource | undefined;

    function closeStream() {
      stream?.close();
      stream = undefined;
    }

    function openStream() {
      if (stream || document.hidden) return;
      stream = new EventSource("/api/agent/activity?stream=1");
      stream.onmessage = ({ data }) => {
        if (disposed) return;
        const next = JSON.parse(data) as AgentActivityUpdate;
        setUpdates((previous) => {
          const last = previous.at(-1);
          if (last?.phase === next.phase && last.message === next.message) return previous;
          // Deltas grow one reply. Keep completed public updates as separate messages.
          if (last?.phase === "writing") return [...previous.slice(0, -1), next];
          return [...previous.slice(-9), next];
        });
      };
    }

    async function poll() {
      if (disposed || signedOut || document.hidden || request) return;
      clearTimeout(scheduled);
      request = new AbortController();
      let delay = 12_000;
      try {
        const response = await fetch("/api/agent/activity", { signal: request.signal, cache: "no-store" });
        if (disposed) return;
        if (response.status === 401) {
          signedOut = true;
          closeStream();
          setUpdates([]);
          setData(undefined);
          setError("Sign in to view agent activity.");
          return;
        }
        if (!response.ok) throw new Error("Activity request failed");
        const snapshot: Snapshot = await response.json();
        if (disposed) return;
        setData(snapshot);
        setError("");
        const status = snapshot.setup?.status;
        const running = !!status && activeSetup.has(status);
        if (running) {
          sawActiveSetup = true;
          openStream();
        } else {
          closeStream();
          if (status === "not_sent" || !status) setUpdates([]);
        }
        if (status && sawActiveSetup && finishedSetup.has(status)) {
          sawActiveSetup = false;
          router.refresh();
        }
        if (running || isBusy(snapshot.gateway)) delay = 2500;
      } catch {
        if (!disposed) setError("Couldn’t refresh agent activity. Retrying…");
      } finally {
        request = undefined;
        if (!disposed && !signedOut) scheduled = setTimeout(() => void poll(), delay);
      }
    }

    function resume() {
      if (document.hidden) closeStream();
      else void poll();
    }
    document.addEventListener("visibilitychange", resume);
    void poll();
    return () => {
      disposed = true;
      clearTimeout(scheduled);
      request?.abort();
      closeStream();
      document.removeEventListener("visibilitychange", resume);
    };
  }, [retryResult, router]);

  const gateway = data?.gateway;
  const setup = data?.setup;
  const canRetry = setup?.status === "failed" || setup?.status === "cancelled" || setup?.status === "not_sent";
  const busy = isBusy(gateway);
  const status = gateway ? (busy ? "Working" : "Idle") : data || error ? "Activity unavailable" : "Checking…";
  const tool = setup && "tool" in setup ? setup.tool : undefined;
  const failureReason = setup && "failureReason" in setup ? setup.failureReason : undefined;
  const prompt = setup && "prompt" in setup ? setup.prompt : undefined;
  const finalMessage = setup && "message" in setup ? setup.message : undefined;
  const publicMessages = updates.flatMap(({ message }) => message ? [message] : []);
  if (finalMessage && publicMessages.at(-1) !== finalMessage) publicMessages.push(finalMessage);
  const outputTokens = setup && "outputTokens" in setup ? setup.outputTokens : undefined;
  const reasoningTokens = setup && "reasoningTokens" in setup ? setup.reasoningTokens : undefined;
  const setupLabel = setup?.status === "running" && updates.at(-1)?.phase === "writing" && !tool
    ? "Writing a reply" : setup ? setupStatus[setup.status] : "";

  return (
    <section className="agent-activity" aria-labelledby={headingId}>
      <header className="agent-activity-header">
        <h2 id={headingId}><Activity size={17} aria-hidden="true" /> Agent activity</h2>
        <span className="agent-activity-state" data-working={busy} role="status">{status}</span>
      </header>
      {gateway && busy && (
        <p className="agent-activity-counts">
          {gateway.activeRuns} active API {gateway.activeRuns === 1 ? "run" : "runs"}
          <span aria-hidden="true"> · </span>
          {gateway.activeAgents} active {gateway.activeAgents === 1 ? "agent" : "agents"}
        </p>
      )}
      {setup && (
        <dl className="agent-activity-setup">
          <div>
            <dt>Project setup</dt>
            <dd aria-live="polite">{setupLabel}
              {tool && <> · {tool.replaceAll("_", " ")}</>}
            </dd>
          </div>
          {"updatedAt" in setup && setup.updatedAt && (
            <div className="agent-activity-time">
              <dt>Last activity</dt>
              <dd><time dateTime={setup.updatedAt}>{clock.format(new Date(setup.updatedAt))}</time></dd>
            </div>
          )}
        </dl>
      )}
      {failureReason && <p className="agent-activity-error" role="alert">{failureReason}</p>}
      {setup && publicMessages.length > 0 && (
        <div className="agent-activity-messages">
          {publicMessages.map((message, index) => (
            <div className="runtime-message" key={index}><strong>oma-agent</strong><p>{message}</p></div>
          ))}
        </div>
      )}
      {prompt && <HermesPrompt key={prompt.id + ":" + prompt.generation} prompt={prompt} autoFocus={false}
        onAnswer={(answer) => answerProjectSetupPrompt({ id: prompt.id, generation: prompt.generation, kind: prompt.kind, answer })} />}
      {(outputTokens !== undefined || reasoningTokens !== undefined) && (
        <p className="agent-activity-counts agent-activity-tokens">
          {outputTokens !== undefined && <span>{outputTokens.toLocaleString()} output tokens</span>}
          {reasoningTokens !== undefined && <span>{reasoningTokens.toLocaleString()} reasoning tokens</span>}
        </p>
      )}
      {(canRetry || retrying) && (
        <form action={retryAction} className="agent-activity-retry" onSubmit={() => setUpdates([])}>
          <button type="submit" className="btn secondary" disabled={retrying}>
            {retrying ? "Retrying setup…" : "Retry setup"}
          </button>
        </form>
      )}
      {retryResult.error && <p className="agent-activity-error" role="alert">{retryResult.error}</p>}
      {error && <p className="agent-activity-error" role="status">{error}</p>}
    </section>
  );
}

function isBusy(gateway: Snapshot["gateway"] | undefined) {
  return !!gateway && (gateway.activeRuns > 0 || gateway.activeAgents > 0);
}
