/** Returns private, uncached monitoring data for a saved campaign and its Kanban tasks. */

import { getSessionUser } from "@/lib/dal";
import { campaignTaskId, readCampaignProgress, readCampaignTaskActivity } from "@/lib/server/campaign-progress";
import { workspaceId, WorkspaceRequestError } from "@/lib/server/agent-workspace";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, context: RouteContext<"/api/campaigns/[id]/progress">) {
  if (!await getSessionUser()) return Response.json({ error: "Sign in to view campaign progress." }, { status: 401, headers });
  const { id } = await context.params;
  const task = new URL(request.url).searchParams.get("task");
  if (!workspaceId.safeParse(id).success || (task !== null && !campaignTaskId.safeParse(task).success)) {
    return Response.json({ error: "Campaign or task not found." }, { status: 404, headers });
  }
  try {
    const data = task ? await readCampaignTaskActivity(id, task) : await readCampaignProgress(id);
    return Response.json(data, { headers });
  } catch (error) {
    const missing = error instanceof WorkspaceRequestError && error.status === 404;
    return Response.json({ error: missing && task ? "Task not found on this campaign’s board."
      : "Couldn’t read campaign progress. Check that oma-agent is running with the updated workspace service." },
    { status: missing ? 404 : 503, headers });
  }
}
