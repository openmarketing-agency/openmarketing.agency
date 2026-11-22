/** Serves a private, uncached dashboard snapshot for the signed-in account. */

import { getSessionUser } from "@/lib/dal";
import { readDashboardAgentActivity } from "@/lib/server/agent-activity";

const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Sign in to view agent activity." }, { status: 401, headers });
  return Response.json(await readDashboardAgentActivity(user.id), { headers });
}
