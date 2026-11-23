/** Serves a private, uncached dashboard snapshot and public agent reply stream for the signed-in account. */

import { getSessionUser } from "@/lib/dal";
import { readDashboardAgentActivity, streamDashboardAgentActivity } from "@/lib/server/agent-activity";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Sign in to view agent activity." }, { status: 401, headers });
  if (new URL(request.url).searchParams.get("stream") === "1") {
    const body = await streamDashboardAgentActivity(user.id, request.signal);
    return body ? new Response(body, { headers: { ...headers, "Content-Type": "text/event-stream; charset=utf-8" } })
      : new Response(null, { status: 204, headers });
  }
  return Response.json(await readDashboardAgentActivity(user.id), { headers });
}
