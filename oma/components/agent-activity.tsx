/** Polls the authenticated activity endpoint while the dashboard is visible. */

"use client";

import { Activity } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { AgentActivity as Snapshot } from "@/lib/agent-activity";

import "./agent-activity.css";

type SetupStatus = NonNullable<Snapshot["setup"]>["status"];
const setupStatus: Record<SetupStatus, string> = {
  not_sent: "Ready to send to oma-agent",
  queued: "Queued",
  running: "Processing",
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
        const status = snapshot.setup?.status;
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
  }, [router]);

  const gateway = data?.gateway;
  const setup = data?.setup;
  const busy = isBusy(gateway);
  const status = gateway ? (busy ? "Working" : "Idle") : data || error ? "Activity unavailable" : "Checking…";

  return (
    <section className="agent-activity" aria-labelledby="agent-activity-heading">
      <header className="agent-activity-header">
        <h2 id="agent-activity-heading"><Activity size={17} aria-hidden="true" /> Agent activity</h2>
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
            <dd aria-live="polite">{setupStatus[setup.status]}
              {"tool" in setup && setup.tool && <> · {setup.tool.replaceAll("_", " ")}</>}
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
      {error && <p className="agent-activity-error" role="status">{error}</p>}
    </section>
  );
}

function isBusy(gateway: Snapshot["gateway"] | undefined) {
  return !!gateway && (gateway.activeRuns > 0 || gateway.activeAgents > 0);
}
