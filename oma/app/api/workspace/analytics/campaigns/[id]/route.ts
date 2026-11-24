/** Reads or generates an authenticated dashboard for a saved campaign. */

import { analyticsDateRange } from "@/lib/analytics";
import { getSessionUser } from "@/lib/dal";
import { generateAnalytics, queryAnalytics, readAnalytics, requireAnalyticsCampaign } from "@/lib/server/analytics";
import { workspaceId, WorkspaceRequestError } from "@/lib/server/agent-workspace";

type Context = RouteContext<"/api/workspace/analytics/campaigns/[id]">;
const headers = { "Cache-Control": "private, no-store" };

async function analytics(request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Sign in to view analytics." }, { status: 401, headers });
  const { id } = await params;
  if (!workspaceId.safeParse(id).success) {
    return Response.json({ error: "Campaign not found." }, { status: 404, headers });
  }

  const generate = request.method === "POST";
  // A JSON request cannot be submitted by a cross-origin HTML form.
  if (generate && request.headers.get("content-type") !== "application/json") {
    return Response.json({ error: "Analytics generation requires a JSON request." }, { status: 415, headers });
  }
  try {
    const key = { userId: user.id, id };
    await requireAnalyticsCampaign(id);
    const dateRanges = new URL(request.url).searchParams.getAll("dateRange");
    if (!generate && dateRanges.length) {
      const range = analyticsDateRange.safeParse(dateRanges[0]);
      if (dateRanges.length !== 1 || !range.success) {
        return Response.json({ error: "Choose a 7- or 28-day date range." }, { status: 422, headers });
      }
      return Response.json(await queryAnalytics(id, range.data), { headers });
    }
    const result = generate ? await generateAnalytics(key) : readAnalytics(key);
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof WorkspaceRequestError) {
      return Response.json({ error: error.message }, { status: error.status, headers });
    }
    const message = generate ? "Couldn’t save the analytics report. Try again."
      : "Couldn’t load analytics. Try refreshing the report.";
    return Response.json({ error: message }, { status: generate ? 502 : 503, headers });
  }
}

export async function GET(request: Request, context: Context) {
  return analytics(request, context);
}

export async function POST(request: Request, context: Context) {
  return analytics(request, context);
}
