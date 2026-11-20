/** Routes authenticated toolkit selection reads and idempotent writes. */

import { notFound } from "../common/api-error";
import { empty, json } from "../http";
import { requireUser } from "../identity/authenticate";
import { listAssignments, saveAssignment } from "./service";

export async function handleToolAssignments(request: Request, segments: string[]): Promise<Response> {
  const { method } = request;
  const { id } = await requireUser(request);
  if (method === "GET" && segments.length === 1) return json(await listAssignments(id));
  if (segments.length === 4 && (method === "PUT" || method === "DELETE")) {
    const [, playbookId, agentId, toolkitSlug] = segments;
    await saveAssignment(id, playbookId, agentId, toolkitSlug, method === "PUT");
    return empty();
  }
  throw notFound();
}
