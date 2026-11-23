/** Route the versioned control-plane API for external clients and in-process console callers. */

import { notFound } from "./common/api-error";
import { apiResponse, empty } from "./http";
import { loadSettings } from "./settings";

function dispatch(request: Request, segments: string[]): Promise<Response> {
  switch (segments[0]) {
    case "auth":
    case "users":
      return import("./identity/http").then(({ handleIdentity }) => handleIdentity(request, segments));
    case "mcp-integrations":
      return import("./integrations/http").then(({ handleIntegrations }) => handleIntegrations(request, segments));
    default:
      throw notFound();
  }
}

export async function controlPlane(request: Request, segments: string[]): Promise<Response> {
  const origin = request.headers.get("origin");
  const response = await apiResponse(() => {
    if (request.method === "OPTIONS") return empty();
    if (request.method === "HEAD") {
      const get = new Request(request, { method: "GET" });
      return dispatch(get, segments).then((result) => new Response(null, result));
    }
    return dispatch(request, segments);
  });
  if (!origin) return response;

  response.headers.append("Vary", "Origin");
  if (loadSettings().corsOrigins.includes(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
    if (request.method === "OPTIONS") {
      response.headers.set("Access-Control-Allow-Methods", "GET, HEAD, POST, PATCH, PUT, DELETE, OPTIONS");
      const headers = request.headers.get("access-control-request-headers");
      if (headers) response.headers.set("Access-Control-Allow-Headers", headers);
      response.headers.append("Vary", "Access-Control-Request-Headers");
    }
  }
  return response;
}
