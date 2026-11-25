"use client";

/** Renders saved OpenUI dashboards and connects their read-only queries to the active workspace record. */

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ThemeProvider, type ThemeProviderProps } from "@openuidev/dashboard-library";
import { Renderer, useRendererQuery } from "@openuidev/react-lang";
import { BarChart3, RefreshCw, Sparkles } from "lucide-react";

import { AnalyticsGenerationDetails } from "@/components/analytics-generation-details";
import { Loading } from "@/components/ui";
import {
  analyticsDateRange, legacyAnalyticsQueryTool, observationQueryTool,
  type AnalyticsCollectorStatus, type AnalyticsView, type ObservationQueryResult,
} from "@/lib/analytics";
import { analyticsLibrary } from "@/lib/analytics-library";
import { observationDashboard } from "@/lib/observation-dashboard";
import "./workspace-analytics.css";
import { Button, buttonVariants } from "@/components/ui/button";

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const theme: ThemeProviderProps["lightTheme"] = {
  page: "var(--ground)", surface: "var(--surface)", surfaceSubtle: "var(--raised)",
  border: "var(--border)", borderStrong: "var(--control)", grid: "var(--border)",
  ink: "var(--text)", inkSecondary: "var(--muted)", inkMuted: "var(--muted)",
  accent: "var(--accent)", accentInk: "var(--surface)", series1: "var(--accent)",
  good: "var(--positive)", bad: "var(--negative)", warning: "var(--warning)",
  radius: "var(--radius)", radiusMd: "var(--radius)", shadow: "none",
};

async function requestAnalytics<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, cache: "no-store" });
  if (response.redirected) throw new Error("Sign in again to use analytics.");
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Couldn’t load analytics.");
  return result;
}

export function WorkspaceAnalytics({ id }: { id: string }) {
  const path = `/api/workspace/analytics/campaigns/${id}`;
  const [view, setView] = useState<AnalyticsView>();
  const [readError, setReadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (submitting) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function update() {
      try {
        const result = await requestAnalytics<AnalyticsView>(path, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setView(result);
        setReadError("");
        if (result.generating) timer = setTimeout(update, 3000);
      } catch (error) {
        if (!controller.signal.aborted) setReadError(error instanceof Error ? error.message : "Couldn’t load analytics.");
      }
    }
    void update();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [path, retry, submitting]);

  async function generate() {
    setActionError("");
    setSubmitting(true);
    try {
      setView(await requestAnalytics<AnalyticsView>(path, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(190_000),
      }));
      setReadError("");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Couldn’t generate analytics.");
    } finally {
      setSubmitting(false);
    }
  }

  const report = view?.report;
  const busy = submitting || Boolean(view?.generating);
  const generateButton = view && !report && (
    <Button type="button" disabled={busy} onClick={generate}>
      <Sparkles size={16} aria-hidden="true" />
      {busy ? "Generating…" : "Generate dashboard"}
    </Button>
  );

  return (
    <section className="workspace-analytics" aria-labelledby="analytics-heading">
      <header className="analytics-heading">
        <div>
          <h2 id="analytics-heading">Analytics</h2>
          {report && (
            <p>Dashboard generated <time dateTime={new Date(report.generatedAt).toISOString()}>{dateTime.format(report.generatedAt)}</time>
            </p>
          )}
        </div>
        {generateButton}
      </header>

      {readError && (
        <div className="analytics-feedback" role="alert">
          <p className="form-error">{readError}</p>
          <Button type="button" variant="outline" onClick={() => setRetry((revision) => revision + 1)}>Try again</Button>
        </div>
      )}
      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      {!view && !readError && <Loading label="Loading analytics…" />}
      {busy && <p className="analytics-notice" role="status">oma-agent is generating your dashboard. You can return to this tab when it’s ready.</p>}

      {view && !report && !busy && (
        <div className="analytics-empty">
          <BarChart3 size={22} aria-hidden="true" />
          <div>
            <h3>Create your analytics dashboard</h3>
            <p>View campaign measurements and their sources in a saved dashboard.</p>
          </div>
        </div>
      )}

      {view && <AnalyticsGenerationDetails report={report} />}

      {report && (
        <>
          <OpenUIAnalytics
            source={report.dataSource === "observations" ? report.source : observationDashboard}
            path={path}
            collectorPath={`/api/campaigns/${id}/analytics`}
          />
          {report.dataSource !== "observations" && <OpenUIAnalytics source={report.source} path={path} />}
        </>
      )}
    </section>
  );
}

function OpenUIAnalytics({ source, path, collectorPath }: { source: string; path: string; collectorPath?: string }) {
  const [lastCollectedAt, setLastCollectedAt] = useState<string | null>(null);
  const tools = useMemo(() => ({
    async [collectorPath ? observationQueryTool : legacyAnalyticsQueryTool]({ dateRange }: Record<string, unknown>) {
      const range = analyticsDateRange.parse(dateRange);
      const params = new URLSearchParams({ dateRange: range });
      if (collectorPath) {
        params.set("source", "observations");
        const data = await requestAnalytics<ObservationQueryResult>(path + "?" + params);
        setLastCollectedAt(data.lastCollectedAt);
        return data;
      }
      return requestAnalytics(path + "?" + params);
    },
  }), [path, collectorPath]);

  return (
    <ThemeProvider lightTheme={theme}>
      <Renderer response={source} library={analyticsLibrary} toolProvider={tools} publishObservability={false}>
        {collectorPath && <DashboardToolbar path={collectorPath} lastCollectedAt={lastCollectedAt} />}
        <Renderer.QueryError>
          <div className="analytics-feedback" role="alert">
            <p className="form-error">Couldn’t load the dashboard data.</p>
            <Renderer.Retry className={buttonVariants({ variant: "outline" })}>Try again</Renderer.Retry>
          </div>
        </Renderer.QueryError>
        <Renderer.Content className="analytics-canvas" />
      </Renderer>
    </ThemeProvider>
  );
}

function DashboardToolbar({ path, lastCollectedAt }: { path: string; lastCollectedAt: string | null }) {
  const { retry, isLoading } = useRendererQuery();
  const reloadData = useEffectEvent(() => retry());
  const wasActive = useRef(false);
  const [status, setStatus] = useState<AnalyticsCollectorStatus>();
  const [queueing, setQueueing] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const active = status?.state === "queued" || status?.state === "running";

  useEffect(() => {
    if (queueing) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function check() {
      try {
        const result = await requestAnalytics<AnalyticsCollectorStatus>(path + "/status", { signal: controller.signal });
        if (controller.signal.aborted) return;
        setStatus(result);
        setStatusError("");
        const pending = result.state === "queued" || result.state === "running";
        if (wasActive.current && !pending) reloadData();
        wasActive.current = pending;
      } catch (error) {
        if (controller.signal.aborted) return;
        setStatusError(error instanceof Error ? error.message : "Couldn’t check the collector status.");
      }
      timer = setTimeout(check, wasActive.current ? 2_000 : 30_000);
    }

    void check();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [path, queueing]);

  async function refresh() {
    setQueueing(true);
    setRefreshError("");
    try {
      const result = await requestAnalytics<Omit<AnalyticsCollectorStatus, "last_successful_refresh_at">>(path + "/refresh", { method: "POST" });
      wasActive.current = true;
      setStatus((previous) => ({
        ...result, last_successful_refresh_at: previous?.last_successful_refresh_at ?? null,
      }));
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "Couldn’t queue an analytics refresh.");
    } finally {
      setQueueing(false);
    }
  }

  return (
    <>
      <div className="analytics-toolbar">
        <div className="analytics-notice">
          <p role="status">
            {queueing ? "Requesting refresh…" : status?.state === "queued" ? "Refresh queued."
              : status?.state === "running" ? "Collecting analytics…" : status?.state === "unavailable" ? "Campaign analyst unavailable."
                : isLoading ? "Loading saved observations…" : lastCollectedAt
                  ? <>Latest observation saved <time dateTime={lastCollectedAt}>{dateTime.format(new Date(lastCollectedAt))}</time></>
                  : "Waiting for saved observations."}
          </p>
          {status?.last_successful_refresh_at && (
            <p>Last successful refresh <time dateTime={status.last_successful_refresh_at}>{dateTime.format(new Date(status.last_successful_refresh_at))}</time></p>
          )}
        </div>
        <Button type="button" variant="outline" disabled={queueing || active || status?.state === "unavailable"} onClick={refresh}>
          <RefreshCw size={15} aria-hidden="true" /> Refresh data
        </Button>
      </div>
      {statusError && <p className="form-error" role="alert">{statusError}</p>}
      {refreshError && <p className="form-error" role="alert">{refreshError}</p>}
      {!queueing && !active && status?.last_outcome && status.last_outcome !== "ok" && (
        <p className="analytics-notice">Previous collector result was {status.last_outcome}. Saved observations may include partial results.</p>
      )}
    </>
  );
}
