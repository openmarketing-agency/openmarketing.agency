/** Converts live campaign monitoring records into bounded, read-only analytics metrics. */

import type { AnalyticsDateRange, AnalyticsQueryResult, AnalyticsSnapshot, AnalyticsSource } from "../analytics";
import type { CampaignProgressSnapshot } from "./campaign-progress";

const DAY = 86_400_000;
const taskLabels = ["Queued", "In progress", "Needs attention", "Done"];
const scheduleLabels = ["Succeeded", "Failed", "Delivery failed", "No result"];
const publicationLabels = ["Needs approval", "Approved", "Publishing", "Published", "Failed"];

function source(labels: string[]): AnalyticsSource {
  return { rows: labels.map((label) => ({ label, count: 0 })), available: false, partial: false };
}

function taskIndex(status: string) {
  if (status === "done") return 3;
  if (status === "running") return 1;
  return ["blocked", "review", "failed", "triage"].includes(status) ? 2 : 0;
}

function scheduleIndex(status: string) {
  if (status === "ok") return 0;
  if (status === "error") return 1;
  return status === "delivery_failed" ? 2 : 3;
}

const publicationIndex = new Map(["pending_approval", "approved", "publishing", "published", "failed"]
  .map((status, index) => [status, index]));

export function summarizeAnalytics(
  progress: CampaignProgressSnapshot, now = Date.now(),
): AnalyticsSnapshot {
  const tasks = source(taskLabels);
  const schedules = source(scheduleLabels);
  const publications = source(publicationLabels);
  const start = Math.floor(now / DAY) * DAY - 27 * DAY;
  const timeline = Array.from({ length: 28 }, (_, index) => ({
    label: new Date(start + index * DAY).toISOString().slice(0, 10),
    count: 0,
  }));

  if (progress.board.state === "ready") {
    tasks.available = true;
    for (const task of progress.board.tasks) {
      tasks.rows[taskIndex(task.status)].count++;
      const completedAt = task.completedAt === null ? 0 : task.completedAt * 1000;
      const day = timeline[Math.floor((completedAt - start) / DAY)];
      if (task.status === "done" && day && completedAt <= now) day.count++;
    }
  }
  schedules.available = true;
  schedules.partial = progress.schedule.state === "partial";
  for (const job of progress.schedule.jobs) schedules.rows[scheduleIndex(job.lastStatus)].count++;
  if (progress.publications.state === "ready") {
    publications.available = true;
    publications.partial = progress.publications.skipped > 0;
    for (const record of progress.publications.items) {
      const index = publicationIndex.get(record.status);
      if (index !== undefined) publications.rows[index].count++;
    }
  }
  return { updatedAt: now, tasks, timeline, schedules, publications };
}

const utcDay = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });

/** Expose only chart labels, derived counts, and source coverage to the OpenUI query. */
export function analyticsQueryResult(snapshot: AnalyticsSnapshot, dateRange: AnalyticsDateRange): AnalyticsQueryResult {
  function metric(source: AnalyticsSource, note: string) {
    const { rows, available, partial } = source;
    if (!available) return { labels: [], counts: [], total: null, note: "This source is unavailable." };
    const counts = rows.map(({ count }) => count);
    const coverage = partial ? " · Some records unavailable" : "";
    return { labels: rows.map(({ label }) => label), counts, total: counts.reduce((sum, count) => sum + count, 0), note: note + coverage };
  }

  const days = dateRange === "7d" ? 7 : 28;
  const timeline = snapshot.timeline.slice(-days).map(({ label, count }) => ({
    label: utcDay.format(new Date(label)), count,
  }));
  return {
    updatedAt: snapshot.updatedAt,
    campaignCount: 1,
    tasks: metric(snapshot.tasks, "Current Kanban status"),
    timeline: metric({ ...snapshot.tasks, rows: timeline }, `Last ${days} days · UTC`),
    schedules: metric(snapshot.schedules, "Latest result per scheduled job"),
    publications: metric(snapshot.publications, "Up to six recent records"),
  };
}
