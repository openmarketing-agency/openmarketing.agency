/** Reads the campaign collector's saved observations and projects display values for OpenUI. */

import { z } from "zod";

import type { AnalyticsDateRange, ObservationQueryResult } from "../analytics";
import { workspaceRequest, WorkspaceRequestError } from "./agent-workspace";

const observation = z.object({
  id: z.number().int().positive(),
  source: z.string(),
  account: z.string(),
  metric: z.string(),
  period_start: z.iso.datetime({ offset: true }),
  period_end: z.iso.datetime({ offset: true }),
  dimensions: z.record(z.string(), z.json()),
  value: z.json(),
  unit: z.string(),
  collected_at: z.iso.datetime({ offset: true }),
});

const observationPage = z.object({
  campaign_id: z.string(),
  observations: z.array(observation).max(100),
  last_collected_at: z.iso.datetime({ offset: true }).nullable(),
  next_cursor: z.number().int().positive().nullable(),
});

const collectorFields = {
  campaign_id: z.string(),
  running: z.boolean(),
  run_id: z.string().nullable(),
  last_outcome: z.string().nullable(),
  last_finished_at: z.string().nullable(),
};
const collectorStatus = z.object({
  ...collectorFields,
  state: z.enum(["queued", "running", "idle", "unavailable"]),
  last_successful_refresh_at: z.iso.datetime({ offset: true }).nullable(),
});
const collectorRefresh = z.object({ ...collectorFields, state: z.enum(["queued", "running"]) });

const day = 86_400_000;
const sourceNames: Record<string, string> = {
  "oma-publications": "OMA publications",
  "google-analytics": "Google Analytics 4",
  "google-search-console": "Google Search Console",
};

function campaignAnalyticsPath(id: string) {
  return `/workspace/campaigns/${encodeURIComponent(id)}/analytics`;
}

export async function readCampaignObservations(id: string, filters: URLSearchParams) {
  const query = filters.toString();
  const raw = await workspaceRequest(campaignAnalyticsPath(id) + (query ? "?" + query : ""));
  const page = observationPage.safeParse(raw);
  if (!page.success || page.data.campaign_id !== id) {
    throw new WorkspaceRequestError(503, "The agent workspace returned invalid campaign observations.");
  }
  return page.data;
}

export async function readCampaignCollector(id: string, refresh: boolean) {
  const raw = await workspaceRequest(
    campaignAnalyticsPath(id) + (refresh ? "/refresh" : "/status"), undefined, refresh ? "POST" : "GET",
  );
  const result = (refresh ? collectorRefresh : collectorStatus).safeParse(raw);
  if (!result.success || result.data.campaign_id !== id) {
    throw new WorkspaceRequestError(503, "The agent workspace returned an invalid collector status.");
  }
  return result.data;
}

function utcLabel(timestamp: string) {
  return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
}

export async function queryCampaignObservations(id: string, range: AnalyticsDateRange, now = Date.now()): Promise<ObservationQueryResult> {
  const today = Math.floor(now / day) * day;
  const days = range === "7d" ? 7 : 28;
  const filters = new URLSearchParams({
    start: new Date(today - (days - 1) * day).toISOString(),
    end: new Date(today + day).toISOString(),
    limit: "100",
  });
  const page = await readCampaignObservations(id, filters);
  const rows = page.observations;
  const countsBySource = new Map<string, number>();
  const source = rows.map((row) => {
    const label = Object.hasOwn(sourceNames, row.source) ? sourceNames[row.source] : row.source;
    countsBySource.set(label, (countsBySource.get(label) ?? 0) + 1);
    return label;
  });
  const note = rows.length === 0 ? "No saved observations in this period."
    : page.next_cursor ? "Showing the 100 newest observations in this period."
      : `${rows.length} saved observation${rows.length === 1 ? "" : "s"} in this period.`;

  return {
    lastCollectedAt: page.last_collected_at,
    sources: {
      labels: [...countsBySource.keys()],
      counts: [...countsBySource.values()],
      total: rows.length,
      note: page.next_cursor ? "Counts of the observations shown below." : "Counts of saved observation records by source.",
    },
    observations: {
      source,
      account: rows.map((row) => row.account || "—"),
      metric: rows.map((row) => row.metric),
      period: rows.map((row) => `${utcLabel(row.period_start)} – ${utcLabel(row.period_end)} UTC`),
      value: rows.map((row) => [JSON.stringify(row.value), row.unit].filter(Boolean).join(" ")),
      dimensions: rows.map((row) => Object.keys(row.dimensions).length ? JSON.stringify(row.dimensions) : "—"),
      note,
    },
  };
}
