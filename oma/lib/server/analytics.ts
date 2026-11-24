/** Saves one dashboard per account and campaign while reading its metrics live from oma-agent. */

import { randomUUID } from "node:crypto";
import type { AnalyticsDateRange, AnalyticsReport, AnalyticsView } from "../analytics";
import { getDb } from "../db";
import { loadAgentWorkspace, workspaceRequest, WorkspaceRequestError } from "./agent-workspace";
import { analyticsQueryResult, summarizeAnalytics } from "./analytics-data";
import { dashboardSystemPrompt, validateAnalyticsProgram } from "./analytics-program";
import { readCampaignProgress } from "./campaign-progress";

type AnalyticsKey = { userId: string; id: string };

export async function requireAnalyticsCampaign(id: string) {
  const { records } = await loadAgentWorkspace();
  if (!records) throw new WorkspaceRequestError(503, "Check that oma-agent is running to view analytics.");
  if (!records.campaigns.some((record) => record.id === id)) {
    throw new WorkspaceRequestError(404, "Campaign not found.");
  }
}

export async function queryAnalytics(id: string, dateRange: AnalyticsDateRange) {
  const progress = await readCampaignProgress(id).catch(() => {
    throw new WorkspaceRequestError(503, "Campaign analytics are unavailable. Check oma-agent and try again.");
  });
  return analyticsQueryResult(summarizeAnalytics(progress), dateRange);
}

export function readAnalytics(key: AnalyticsKey): AnalyticsView {
  const db = getDb();
  const row = db.prepare(`
    SELECT layout, generated_at, lease_until FROM workspace_analytics
    WHERE user_id = ? AND scope = 'campaigns' AND target_id = ?
  `).get(key.userId, key.id);
  const generating = Number(row?.lease_until) > Date.now();
  if (typeof row?.layout !== "string") return { report: null, generating };

  // Existing databases store JSON in this column. Previous layouts are JSON objects; OpenUI source is a JSON string.
  const source: unknown = JSON.parse(row.layout);
  const report = typeof source === "string" ? { source, generatedAt: Number(row.generated_at) } : null;
  return { report, generating };
}

export async function generateAnalytics(key: AnalyticsKey): Promise<AnalyticsView> {
  const db = getDb();
  const attempt = randomUUID();
  const now = Date.now();
  const savedKey = [key.userId, "campaigns", key.id] as const;
  const claim = db.prepare(`
    INSERT INTO workspace_analytics (user_id, scope, target_id, attempt, lease_until)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, scope, target_id) DO UPDATE SET
      attempt = excluded.attempt, lease_until = excluded.lease_until
    WHERE workspace_analytics.lease_until IS NULL OR workspace_analytics.lease_until <= ?
  `).run(...savedKey, attempt, now + 185_000, now);
  if (!claim.changes) throw new WorkspaceRequestError(409, "Analytics generation is already running.");

  try {
    const data = await queryAnalytics(key.id, "28d");
    const request = { scope: "campaigns", targetId: key.id, campaignIds: [key.id], snapshot: data };
    let correction = "";
    let source: string | undefined;
    for (let attemptNo = 0; attemptNo < 2; attemptNo++) {
      const reply = await workspaceRequest("/workspace/analytics", {
        ...request, prompt: dashboardSystemPrompt + correction,
      }, "POST");
      try {
        if (typeof reply !== "string") throw new Error("Return OpenUI Lang source as plain text.");
        source = validateAnalyticsProgram(reply);
        break;
      } catch (error) {
        const guidance = error instanceof Error ? error.message : "Follow the dashboard example.";
        correction = "\n\nCorrect the following validation issue in a new complete program: " + guidance;
      }
    }
    if (!source) throw new WorkspaceRequestError(502, "The default agent returned an invalid OpenUI dashboard. Try regenerating.");
    const report: AnalyticsReport = { source, generatedAt: Date.now() };
    const update = db.prepare(`
      UPDATE workspace_analytics SET layout = ?, generated_at = ?, attempt = NULL, lease_until = NULL
      WHERE user_id = ? AND scope = ? AND target_id = ? AND attempt = ?
    `).run(JSON.stringify(source), report.generatedAt, ...savedKey, attempt);
    if (!update.changes) throw new WorkspaceRequestError(409, "Analytics generation was superseded. Reload the report.");
    return { report, generating: false };
  } finally {
    db.prepare(`
      UPDATE workspace_analytics SET attempt = NULL, lease_until = NULL
      WHERE user_id = ? AND scope = ? AND target_id = ? AND attempt = ?
    `).run(...savedKey, attempt);
  }
}
