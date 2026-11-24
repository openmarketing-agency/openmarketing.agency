/** Defines the shared analytics API types and the workspace data that backs OpenUI reports. */

import { z } from "zod";

export const analyticsDateRange = z.enum(["7d", "28d"]);
export type AnalyticsDateRange = z.infer<typeof analyticsDateRange>;
export const analyticsQueryTool = "workspace_activity";
export const analyticsMetrics = ["tasks", "timeline", "schedules", "publications"] as const;

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
} & Record<typeof analyticsMetrics[number], {
  labels: string[];
  counts: number[];
  total: number | null;
  note: string;
}>;

export type AnalyticsReport = { source: string; generatedAt: number };
export type AnalyticsView = {
  report: AnalyticsReport | null;
  generating: boolean;
};
