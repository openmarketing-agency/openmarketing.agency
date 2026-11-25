/** Saves one dashboard per account and campaign while reading its metrics live from oma-agent. */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AnalyticsDateRange, AnalyticsReport, AnalyticsView } from "../analytics";
import { getDb, writeTransaction } from "../db";
import { loadAgentWorkspace, workspaceRequest, WorkspaceRequestError } from "./agent-workspace";
import { analyticsQueryResult, summarizeAnalytics } from "./analytics-data";
import { dashboardSystemPrompt, validateAnalyticsProgram } from "./analytics-program";
import { readCampaignProgress } from "./campaign-progress";

type AnalyticsKey = { userId: string; id: string };

const generatedDashboard = z.object({ source: z.string(), userMessage: z.string().min(1) });
const savedDashboard = z.object({
  source: z.string(),
  dataSource: z.literal("observations").optional(),
  generation: z.object({ systemPrompt: z.string(), userMessage: z.string().optional() }),
});

export async function requireAnalyticsCampaign(id: string) {
  const { records } = await loadAgentWorkspace();
  if (!records) throw new WorkspaceRequestError(503, "Check that oma-agent is running to view analytics.");
  if (!records.campaigns.some((record) => record.id === id)) {
    throw new WorkspaceRequestError(404, "Campaign not found.");
  }
}

export async function queryLegacyAnalytics(id: string, dateRange: AnalyticsDateRange) {
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

  // Older OpenUI reports save only the source string. Pre-OpenUI layouts cannot be rendered by OpenUI.
  const layout: unknown = JSON.parse(row.layout);
  const dashboard = typeof layout === "string" ? { source: layout } : savedDashboard.safeParse(layout).data;
  const report = dashboard ? { ...dashboard, generatedAt: Number(row.generated_at) } : null;
  return { report, generating };
}

export async function generateAnalytics(key: AnalyticsKey): Promise<AnalyticsView> {
  const db = getDb();
  const attempt = randomUUID();
  const now = Date.now();
  const savedKey = [key.userId, "campaigns", key.id] as const;
  const existing = writeTransaction(db, () => {
    const view = readAnalytics(key);
    if (view.report) return view;
    if (view.generating) throw new WorkspaceRequestError(409, "Analytics generation is already running.");

    db.prepare(`
      INSERT INTO workspace_analytics (user_id, scope, target_id, attempt, lease_until)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, scope, target_id) DO UPDATE SET attempt = excluded.attempt, lease_until = excluded.lease_until
    `).run(...savedKey, attempt, now + 185_000);
  });
  if (existing) return existing;

  try {
    const request = { scope: "campaigns", targetId: key.id, campaignIds: [key.id] };
    let correction = "";
    let dashboard: Omit<AnalyticsReport, "generatedAt"> | undefined;
    for (let attemptNo = 0; attemptNo < 2; attemptNo++) {
      const systemPrompt = dashboardSystemPrompt + correction;
      const reply = await workspaceRequest("/workspace/analytics", {
        ...request, prompt: systemPrompt,
      }, "POST", { "X-OMA-Analytics-Details": "1" });
      try {
        // Older VMs return the OpenUI source without the exact serialized user message.
        const output = typeof reply === "string" ? { source: reply } : generatedDashboard.safeParse(reply).data;
        if (!output) throw new Error("Return OpenUI Lang source as plain text.");
        dashboard = {
          source: validateAnalyticsProgram(output.source),
          dataSource: "observations",
          generation: { systemPrompt, ...("userMessage" in output && { userMessage: output.userMessage }) },
        };
        break;
      } catch (error) {
        const guidance = error instanceof Error ? error.message : "Follow the dashboard example.";
        correction = "\n\nCorrect the following validation issue in a new complete program: " + guidance;
      }
    }
    if (!dashboard) throw new WorkspaceRequestError(502, "The default agent returned an invalid OpenUI dashboard. Try regenerating.");
    const report: AnalyticsReport = { ...dashboard, generatedAt: Date.now() };
    const update = db.prepare(`
      UPDATE workspace_analytics SET layout = ?, generated_at = ?, attempt = NULL, lease_until = NULL
      WHERE user_id = ? AND scope = ? AND target_id = ? AND attempt = ?
    `).run(JSON.stringify(dashboard), report.generatedAt, ...savedKey, attempt);
    if (!update.changes) throw new WorkspaceRequestError(409, "Analytics generation was superseded. Reload the report.");
    return { report, generating: false };
  } finally {
    db.prepare(`
      UPDATE workspace_analytics SET attempt = NULL, lease_until = NULL
      WHERE user_id = ? AND scope = ? AND target_id = ? AND attempt = ?
    `).run(...savedKey, attempt);
  }
}
