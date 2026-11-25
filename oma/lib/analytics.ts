/** Defines the shared analytics API types and the workspace data that backs OpenUI reports. */

import { z } from "zod";

export const analyticsDateRange = z.enum(["7d", "28d"]);
export type AnalyticsDateRange = z.infer<typeof analyticsDateRange>;
export const legacyAnalyticsQueryTool = "workspace_activity";
export const observationQueryTool = "campaign_observations";
export const observationColumns = ["source", "account", "metric", "period", "value", "dimensions"] as const;
type LegacyMetric = "tasks" | "timeline" | "schedules" | "publications";

export type AnalyticsRows = { label: string; count: number }[];

export type AnalyticsSource = {
  rows: AnalyticsRows;
  available: boolean;
  partial: boolean;
};

export type AnalyticsSnapshot = {
  updatedAt: number;
  tasks: AnalyticsSource;
  timeline: AnalyticsRows;
  schedules: AnalyticsSource;
  publications: AnalyticsSource;
};

export type AnalyticsQueryResult = {
  updatedAt: number;
  campaignCount: number;
} & Record<LegacyMetric, {
  labels: string[];
  counts: number[];
  total: number | null;
  note: string;
}>;

export type ObservationQueryResult = {
  lastCollectedAt: string | null;
  sources: { labels: string[]; counts: number[]; total: number; note: string };
  observations: Record<typeof observationColumns[number], string[]> & { note: string };
  measurements: Record<string, {
    labels: string[];
    values: (number | null)[];
    display: (string | null)[];
    latest: number | null;
    note: string;
  }>;
};

export type AnalyticsCollectorStatus = {
  state: "queued" | "running" | "idle" | "unavailable";
  last_outcome: string | null;
  last_successful_refresh_at: string | null;
};

export type AnalyticsReport = {
  dataSource?: "observations";
  source: string;
  generatedAt: number;
  generation?: { systemPrompt: string; userMessage?: string };
};
export type AnalyticsView = {
  report: AnalyticsReport | null;
  generating: boolean;
};
