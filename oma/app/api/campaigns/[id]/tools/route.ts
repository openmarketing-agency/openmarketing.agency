/** Returns whether each of a campaign’s Composio tools is connected, checked over the default agent’s MCP server. */

import { getSessionUser } from "@/lib/dal";
import { readCampaignToolConnections, workspaceId, WorkspaceRequestError } from "@/lib/server/agent-workspace";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(_request: Request, context: RouteContext<"/api/campaigns/[id]/tools">) {
  if (!await getSessionUser()) return Response.json({ error: "Sign in to view campaign tools." }, { status: 401, headers });
  const { id } = await context.params;
  if (!workspaceId.safeParse(id).success) return Response.json({ error: "Campaign not found." }, { status: 404, headers });
  try {
    return Response.json(await readCampaignToolConnections(id), { headers });
  } catch (error) {
    const known = error instanceof WorkspaceRequestError && [404, 429, 502].includes(error.status);
    return Response.json({ error: known ? error.message
      : "Couldn’t check tool connections. Check that oma-agent is running with the updated workspace service." },
    { status: known ? error.status : 503, headers });
  }
}
