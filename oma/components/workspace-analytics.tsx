"use client";

/** Renders saved OpenUI dashboards and connects their read-only queries to the active workspace record. */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ThemeProvider, type ThemeProviderProps } from "@openuidev/dashboard-library";
import { Renderer, useRendererQuery } from "@openuidev/react-lang";
import { BarChart3, RefreshCw, Sparkles } from "lucide-react";

import { Loading } from "@/components/ui";
import { analyticsDateRange, analyticsQueryTool, type AnalyticsQueryResult, type AnalyticsView } from "@/lib/analytics";
import { analyticsLibrary } from "@/lib/analytics-library";
import "./workspace-analytics.css";

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
  const generateButton = view && (
    <button type="button" className={report ? "btn secondary" : "btn primary"} disabled={busy} onClick={generate}>
      <Sparkles size={16} aria-hidden="true" />
      {busy ? "Generating…" : report ? "Regenerate dashboard" : "Generate dashboard"}
    </button>
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
        {!report && generateButton}
      </header>

      {readError && (
        <div className="analytics-feedback" role="alert">
          <p className="form-error">{readError}</p>
          <button type="button" className="btn secondary" onClick={() => setRetry((revision) => revision + 1)}>Try again</button>
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
            <p>See task activity, scheduled job results, and recent publications.</p>
          </div>
        </div>
      )}

      {report && (
        <OpenUIAnalytics key={report.generatedAt} source={report.source} path={path} actions={generateButton} />
      )}
    </section>
  );
}

function OpenUIAnalytics({ source, path, actions }: { source: string; path: string; actions: ReactNode }) {
  const [updatedAt, setUpdatedAt] = useState<number>();
  const tools = useMemo(() => ({
    async [analyticsQueryTool]({ dateRange }: Record<string, unknown>) {
      const range = analyticsDateRange.parse(dateRange);
      const params = new URLSearchParams({ dateRange: range });
      const data = await requestAnalytics<AnalyticsQueryResult>(path + "?" + params);
      setUpdatedAt(data.updatedAt);
      return data;
    },
  }), [path]);

  return (
    <ThemeProvider lightTheme={theme}>
      <Renderer response={source} library={analyticsLibrary} toolProvider={tools} publishObservability={false}>
        <DashboardToolbar updatedAt={updatedAt} actions={actions} />
        <Renderer.QueryError>
          <div className="analytics-feedback" role="alert">
            <p className="form-error">Couldn’t load the dashboard data.</p>
            <Renderer.Retry className="btn secondary">Try again</Renderer.Retry>
          </div>
        </Renderer.QueryError>
        <Renderer.Content className="analytics-canvas" />
      </Renderer>
    </ThemeProvider>
  );
}

function DashboardToolbar({ updatedAt, actions }: { updatedAt?: number; actions: ReactNode }) {
  const { retry, isLoading } = useRendererQuery();
  return (
    <div className="analytics-toolbar">
      <p className="analytics-notice" role="status">
        {isLoading ? "Loading dashboard data…" : updatedAt !== undefined && (
          <>Data updated <time dateTime={new Date(updatedAt).toISOString()}>{dateTime.format(updatedAt)}</time></>
        )}
      </p>
      <div className="analytics-actions">
        <button type="button" className="btn secondary" disabled={isLoading} onClick={retry}>
          <RefreshCw size={15} aria-hidden="true" /> Refresh data
        </button>
        {actions}
      </div>
    </div>
  );
}
