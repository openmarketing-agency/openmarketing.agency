/** Exposes the signed-in campaign's saved observations and managed collector over the private workspace socket. */

import { getSessionUser } from "@/lib/dal";
import { readCampaignCollector, readCampaignObservations } from "@/lib/server/campaign-observations";
import { workspaceId, WorkspaceRequestError } from "@/lib/server/agent-workspace";

type Context = RouteContext<"/api/campaigns/[id]/analytics/[[...action]]">;
const headers = { "Cache-Control": "private, no-store" };

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status, headers });
}

async function hasBody(request: Request) {
  const length = request.headers.get("content-length");
  if (length !== null) return length !== "0";
  if (!request.body) return false;

  // Next can wrap a bodyless POST in a stream. Check for bytes without buffering the payload.
  const reader = request.body.getReader();
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      if (chunk.value.byteLength) return true;
    }
    return false;
  } finally {
    await reader.cancel();
  }
}

async function analytics(request: Request, { params }: Context) {
  if (!await getSessionUser()) return errorResponse("Sign in to view campaign analytics.", 401);
  const { id, action = [] } = await params;
  const refresh = request.method === "POST";
  if (!workspaceId.safeParse(id).success || action.length > 1 ||
      (refresh ? action[0] !== "refresh" : action.length && action[0] !== "status")) {
    return errorResponse("Campaign analytics route not found.", 404);
  }

  const url = new URL(request.url);
  if (refresh) {
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    // Next can normalize the request URL to its internal hostname.
    const host = request.headers.get("host");
    const publicOrigin = host && `${url.protocol}//${host}`;
    const appOrigin = process.env.OMA_APP_URL && new URL(process.env.OMA_APP_URL).origin;
    if ((origin && origin !== url.origin && origin !== publicOrigin && origin !== appOrigin) ||
        (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none")) {
      return errorResponse("Refresh analytics from the console.", 403);
    }
  }
  try {
    if (action.length && (url.search || await hasBody(request))) {
      return errorResponse("This analytics action takes no query parameters or request body.", 422);
    }
    const result = action.length
      ? await readCampaignCollector(id, refresh)
      : await readCampaignObservations(id, url.searchParams);
    return Response.json(result, { status: refresh ? 202 : 200, headers });
  } catch (error) {
    if (error instanceof WorkspaceRequestError && !(error.status === 404 && error.message === "Unknown workspace request.")) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse("Campaign analytics are unavailable. Check that the agent image supports analytics.", 503);
  }
}

export async function GET(request: Request, context: Context) {
  return analytics(request, context);
}

export async function POST(request: Request, context: Context) {
  return analytics(request, context);
}
