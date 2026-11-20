/** Validates authenticated requests to list, create, update, or remove MCP integrations. */

import { notFound } from "../common/api-error";
import { parsePaging } from "../common/paging";
import { empty, json, readJson } from "../http";
import { requireUser } from "../identity/authenticate";
import { parseMcpIntegrationCreate, parseMcpIntegrationUpdate } from "./input";
import { createIntegration, deleteIntegration, getIntegration, listIntegrations, updateIntegration } from "./service";

export async function handleIntegrations(request: Request, segments: string[]): Promise<Response> {
  const { method } = request;
  const { id: userId } = await requireUser(request);
  if (segments.length === 1) {
    if (method === "GET") {
      const query = new URL(request.url).searchParams;
      const paging = parsePaging({ limit: query.get("limit") ?? undefined, offset: query.get("offset") ?? undefined });
      return json(await listIntegrations(userId, paging));
    }
    if (method === "POST") {
      const input = parseMcpIntegrationCreate(await readJson(request));
      return json(await createIntegration(userId, input), 201);
    }
  } else if (segments.length === 2) {
    const id = segments[1];
    if (method === "GET") return json(await getIntegration(userId, id));
    if (method === "PATCH") {
      const input = parseMcpIntegrationUpdate(await readJson(request));
      return json(await updateIntegration(userId, id, input));
    }
    if (method === "DELETE") {
      await deleteIntegration(userId, id);
      return empty();
    }
  }
  throw notFound();
}
