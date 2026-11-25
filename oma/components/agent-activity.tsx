/** Pins gateway and project setup status above the native conversation. */

"use client";

import { Activity } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useState, type ReactNode } from "react";

import { retryProjectSetup } from "@/app/actions/project-setup";

import type { AgentActivity as Snapshot } from "@/lib/agent-activity";
import "./agent-activity.css";
import { Button } from "@/components/ui/button";

type SetupStatus = NonNullable<Snapshot["setup"]>["status"];
const setupStatus: Record<SetupStatus, string> = {
  not_sent: "Ready to send to oma-agent",
  queued: "Queued",
  running: "Running",
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

export function AgentActivity({ showSetup, children }: {
  showSetup: boolean;
  children: (activity: { summary: ReactNode; notices: ReactNode }) => ReactNode;
}) {
  const router = useRouter();
  const headingId = useId();

  const [retryResult, retryAction, retrying] = useActionState(retryProjectSetup, {});
  const [data, setData] = useState<Snapshot>();
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    let scheduled: ReturnType<typeof setTimeout>;
    let request: AbortController | undefined;
    let sawActiveSetup = false;
    let signedOut = false;

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
          setData(undefined);
          setError("Sign in to view agent activity.");
          return;
        }
        if (!response.ok) throw new Error("Activity request failed");
        const snapshot: Snapshot = await response.json();
        if (disposed) return;
        setData(snapshot);
        setError("");
        const status = showSetup ? snapshot.setup?.status : undefined;
        const running = !!status && activeSetup.has(status);
        if (running) sawActiveSetup = true;
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

    function resume() { void poll(); }
    document.addEventListener("visibilitychange", resume);
    void poll();
    return () => {
      disposed = true;
      clearTimeout(scheduled);
      request?.abort();
      document.removeEventListener("visibilitychange", resume);
    };
  }, [retryResult, router, showSetup]);

  const gateway = data?.gateway;
  const setup = showSetup ? data?.setup : null;
  const canRetry = setup?.status === "failed" || setup?.status === "cancelled" || setup?.status === "not_sent";
  const busy = isBusy(gateway);
  const status = gateway ? (busy ? "Working" : "Idle") : data || error ? "Activity unavailable" : "Checking…";
  const tool = setup && "tool" in setup ? setup.tool : undefined;
  const failureReason = setup && "failureReason" in setup ? setup.failureReason : undefined;
  const outputTokens = setup && "outputTokens" in setup ? setup.outputTokens : undefined;
  const reasoningTokens = setup && "reasoningTokens" in setup ? setup.reasoningTokens : undefined;
  const setupLabel = setup ? setupStatus[setup.status] : "";

  const summary = (
    <section id="project-setup-activity" className="agent-activity" aria-labelledby={headingId}>
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
      {(outputTokens !== undefined || reasoningTokens !== undefined) && (
        <p className="agent-activity-counts agent-activity-tokens">
          {outputTokens !== undefined && <span>{outputTokens.toLocaleString()} output tokens</span>}
          {reasoningTokens !== undefined && <span>{reasoningTokens.toLocaleString()} reasoning tokens</span>}
        </p>
      )}
    </section>
  );
  const notices = (
    <>
      {failureReason && <p className="agent-activity-error" role="alert">{failureReason}</p>}
      {(canRetry || retrying) && (
        <form action={retryAction} className="agent-activity-retry">
          <Button type="submit" variant="outline" disabled={retrying}>
            {retrying ? "Retrying setup…" : "Retry setup"}
          </Button>
        </form>
      )}
      {retryResult.error && <p className="agent-activity-error" role="alert">{retryResult.error}</p>}
      {error && <p className="agent-activity-error" role="status">{error}</p>}
    </>
  );
  return children({ summary, notices });
}

function isBusy(gateway: Snapshot["gateway"] | undefined) {
  return !!gateway && (gateway.activeRuns > 0 || gateway.activeAgents > 0);
}
