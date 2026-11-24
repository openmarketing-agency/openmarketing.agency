/** Lets the signed-in console observe a pending campaign pause as the workspace finishes it. */

import { z } from "zod";
import { getSessionUser } from "@/lib/dal";
import { workspaceId, workspaceRequest, WorkspaceRequestError } from "@/lib/server/agent-workspace";

const headers = { "Cache-Control": "private, no-store" };
const status = z.object({ state: z.enum(["paused", "pausing", "resumed"]) });

export async function GET(_request: Request, context: RouteContext<"/api/campaigns/[id]/lifecycle">) {
  if (!await getSessionUser()) return Response.json({ error: "Sign in to view campaign status." }, { status: 401, headers });
  const { id } = await context.params;
  if (!workspaceId.safeParse(id).success) return Response.json({ error: "Campaign not found." }, { status: 404, headers });

  try {
    return Response.json(status.parse(await workspaceRequest(`/workspace/campaigns/${id}/lifecycle`)), { headers });
  } catch (error) {
    const missing = error instanceof WorkspaceRequestError && error.status === 404;
    return Response.json({ error: "Campaign status is unavailable." }, { status: missing ? 404 : 503, headers });
  }
}
