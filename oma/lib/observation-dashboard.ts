/** Shares a valid live-query example with the generator and renders observations beside saved older layouts. */

import { observationQueryTool } from "./analytics";

export const observationQueryStatement = `activity = Query("${observationQueryTool}", {dateRange: $dateRange}, {}, 60)`;

export const observationDashboard = [
  "root = Dashboard([filters, overview])",
  '$dateRange = "7d"',
  observationQueryStatement,
  'filters = FilterBar([SelectFilter($dateRange, [{value: "7d", label: "Last 7 days"}, {value: "28d", label: "Last 28 days"}], "Observation period")])',
  'overview = Section("Campaign observations", [summary, coverage, records])',
  'summary = Kpis([Kpi("Observations shown", activity.sources.total, "number")])',
  'coverage = Row([Card("Observations by source", [Bars(activity.sources.labels, [Series("Observations", activity.sources.counts)], "number")], "full", activity.sources.note)], 320)',
  'records = Row([Card("Saved observations", [Table([Column("Source", activity.observations.source, "primary"), Column("Metric", activity.observations.metric, "text"), Column("Value", activity.observations.value, "text"), Column("Period", activity.observations.period, "text"), Column("Account", activity.observations.account, "text"), Column("Dimensions", activity.observations.dimensions, "text")])], "full", activity.observations.note)], 420)',
].join("\n");
