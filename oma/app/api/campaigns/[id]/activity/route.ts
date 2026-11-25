/** Reads the signed-in operator’s campaign activity through the private workspace service. */

import { getSessionUser } from "@/lib/dal";
import { workspaceId, WorkspaceRequestError } from "@/lib/server/agent-workspace";
import { campaignActivityQuery, readCampaignActivity } from "@/lib/server/campaign-activity";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, context: RouteContext<"/api/campaigns/[id]/activity">) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Sign in to view campaign activity." }, { status: 401, headers });
  const { id } = await context.params;
  if (!workspaceId.safeParse(id).success) return Response.json({ error: "Campaign not found." }, { status: 404, headers });
  const query = campaignActivityQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return Response.json({ error: "Invalid campaign activity request." }, { status: 422, headers });
  try {
    return Response.json(await readCampaignActivity(user.id, id, query.data), { headers });
  } catch (error) {
    const status = error instanceof WorkspaceRequestError ? error.status : 503;
    const message = status === 404 ? "This campaign activity is unavailable. Confirm the workspace service is up to date."
      : status === 413 ? "This runtime log exceeds the display size limit."
        : "Couldn’t read campaign activity from oma-agent. Try refreshing.";
    return Response.json({ error: message }, { status: status === 404 || status === 413 ? status : 503, headers });
  }
}
