/** Reads the campaign collector's saved observations and projects display values for OpenUI. */

import { createHash } from "node:crypto";
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
type Observation = z.infer<typeof observation>;
type ValuePath = (string | number)[];

export const measurementField = z.object({
  id: z.string().regex(/^m[a-f0-9]{16}$/),
  source: z.string(), account: z.string(), metric: z.string(), unit: z.string(),
  path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
  numeric: z.boolean(),
});
export type MeasurementField = z.infer<typeof measurementField>;

const observationPromptBudget = 28 * 1024;
const fieldPromptBudget = 6 * 1024;
const measurementFieldLimit = 32;

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

function observationWindow(range: AnalyticsDateRange, now: number) {
  const today = Math.floor(now / day) * day;
  const days = range === "7d" ? 7 : 28;
  return new URLSearchParams({
    start: new Date(today - (days - 1) * day).toISOString(),
    end: new Date(today + day).toISOString(),
    limit: "100",
  });
}

function* valueLeaves(value: Observation["value"], path: ValuePath = []): Generator<{ path: ValuePath; numeric: boolean }> {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) yield* valueLeaves(item, [...path, index]);
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) yield* valueLeaves(item, [...path, key]);
  } else if (value !== null) {
    yield { path, numeric: typeof value === "number" };
  }
}

/** Offer whole records as examples alongside field IDs the saved dashboard can bind. */
export async function campaignObservationContext(id: string, now: number) {
  const window = observationWindow("28d", now);
  const page = await readCampaignObservations(id, window);
  const observations: Observation[] = [];
  let bytes = 2;
  for (const row of page.observations) {
    const rowBytes = Buffer.byteLength(JSON.stringify(row)) + 1;
    if (bytes + rowBytes <= observationPromptBudget) {
      observations.push(row);
      bytes += rowBytes;
    }
  }
  if (page.observations.length && !observations.length) {
    throw new WorkspaceRequestError(422, "The saved observation records exceed the dashboard generation limit.");
  }

  const byPath = new Map<string, MeasurementField>();
  let fieldBytes = 2;
  for (const { source, account, metric, unit, value } of observations) {
    for (const { path, numeric } of valueLeaves(value)) {
      const key = JSON.stringify([source, account, metric, unit, path]);
      const existing = byPath.get(key);
      if (existing) {
        existing.numeric &&= numeric;
      } else if (byPath.size < measurementFieldLimit) {
        // A refreshed layout must never reuse an old binding ID for a different measurement.
        const id = "m" + createHash("sha256").update(key).digest("hex").slice(0, 16);
        const field = { id, source, account, metric, unit, path, numeric };
        const size = Buffer.byteLength(JSON.stringify(field)) + 1;
        if (fieldBytes + size <= fieldPromptBudget) {
          byPath.set(key, field);
          fieldBytes += size;
        }
      }
    }
  }

  return {
    ...page, observations,
    start: window.get("start"), end: window.get("end"),
    sample_truncated: page.next_cursor !== null || observations.length !== page.observations.length,
    measurement_fields: [...byPath.values()],
  };
}

function readValue(value: Observation["value"], path: ValuePath): Observation["value"] {
  for (const key of path) {
    if (typeof key === "number") {
      if (!Array.isArray(value) || key >= value.length) return null;
      value = value[key];
    } else {
      if (value === null || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, key)) return null;
      value = value[key];
    }
  }
  return value;
}

function projectMeasurements(rows: Observation[], fields: MeasurementField[], note: string) {
  if (!fields.length) return {};
  const ordered = rows.map((row) => ({ row, start: Date.parse(row.period_start), end: Date.parse(row.period_end) }))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.row.id - b.row.id);
  return Object.fromEntries(fields.map(({ id, source, account, metric, unit, path, numeric }) => {
    const labels: string[] = [];
    const values: (number | null)[] = [];
    const display: (string | null)[] = [];
    for (const { row } of ordered) {
      if (row.source !== source || row.account !== account || row.metric !== metric || row.unit !== unit) continue;
      const value = readValue(row.value, path);
      const dimensions = Object.keys(row.dimensions).length ? ` · ${JSON.stringify(row.dimensions)}` : "";
      labels.push(`${utcLabel(row.period_start)} – ${utcLabel(row.period_end)} UTC${dimensions}`);
      values.push(numeric && typeof value === "number" ? value : null);
      display.push(value !== null && typeof value !== "object" ? String(value) : null);
    }
    return [id, {
      labels, values, display, latest: values.at(-1) ?? null,
      note: display.some((value) => value !== null) ? [!path.length && unit, note].filter(Boolean).join(" · ")
        : "No saved values for this measurement in this period.",
    }];
  }));
}

export async function queryCampaignObservations(
  id: string, range: AnalyticsDateRange, fields: MeasurementField[] = [], now = Date.now(),
): Promise<ObservationQueryResult> {
  const page = await readCampaignObservations(id, observationWindow(range, now));
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
    measurements: projectMeasurements(rows, fields, note),
  };
}
