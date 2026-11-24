/** Reads a campaign’s operational snapshots through the private oma-agent workspace socket. */

import { z } from "zod";
import { listCampaignPublications } from "./agent-publications";
import { workspaceRequest } from "./agent-workspace";

const timestamp = z.number().int().positive().max(253402300799).nullable();
export const campaignTaskId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const task = z.object({
  id: campaignTaskId, title: z.string(), status: z.string(), assignee: z.string(),
  createdAt: timestamp, startedAt: timestamp, completedAt: timestamp,
  summary: z.string(), failure: z.string(),
});
const board = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ready"), tasks: z.array(task) }),
  z.object({ state: z.enum(["unconfigured", "missing", "ambiguous", "unavailable"]) }),
]);
const schedule = z.object({
  state: z.enum(["ready", "partial"]),
  jobs: z.array(z.object({
    id: z.string(), agent: z.string(), name: z.string(), schedule: z.string(), state: z.string(),
    nextRun: z.string(), lastRun: z.string(), lastStatus: z.string(),
  })),
});
const workspaceProgress = z.object({ board, schedule });
const taskActivity = z.object({
  body: z.string(), result: z.string(), blockReason: z.string(),
  events: z.array(z.object({ id: z.number().int(), kind: z.string(), at: timestamp })),
  runs: z.array(z.object({
    id: z.number().int(), profile: z.string(), status: z.string(), outcome: z.string(), summary: z.string(),
    error: z.string(), startedAt: timestamp, endedAt: timestamp,
  })),
});

export type CampaignTask = z.infer<typeof task>;
export type CampaignTaskActivity = z.infer<typeof taskActivity>;
export type CampaignProgressSnapshot = Awaited<ReturnType<typeof readCampaignProgress>>;

async function readRecentPublications(id: string) {
  try {
    const { publications, skipped } = await listCampaignPublications(id, undefined, 6);
    return {
      state: "ready" as const,
      items: publications.map(({ id, status, platform, account }) => ({
        id, status, platform, account: account.displayName || account.handle,
      })),
      skipped,
    };
  } catch {
    return { state: "unavailable" as const };
  }
}

export async function readCampaignProgress(id: string) {
  const [workspace, publications] = await Promise.all([
    workspaceRequest(`/workspace/campaigns/${id}/progress`).then((result) => workspaceProgress.parse(result)),
    readRecentPublications(id),
  ]);
  return { ...workspace, publications };
}

export async function readCampaignTaskActivity(id: string, taskId: string) {
  return taskActivity.parse(await workspaceRequest(`/workspace/campaigns/${id}/tasks/${taskId}`));
}
