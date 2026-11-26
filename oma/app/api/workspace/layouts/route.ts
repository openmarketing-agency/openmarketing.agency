/** Streams an agent-designed OpenUI page for a saved brand, playbook, or research document as the model writes it. */

import { z } from "zod";

import { getSessionUser } from "@/lib/dal";
import type { DocumentTarget } from "@/lib/document-target";
import { loadAgentWorkspace, loadBrandDocument, workspaceId, WorkspaceRequestError } from "@/lib/server/agent-workspace";
import { generateDocumentLayout } from "@/lib/server/document-layout";

const headers = { "Cache-Control": "private, no-store" };
const target: z.ZodType<DocumentTarget> = z.object({
  kind: z.enum(["brand", "playbook", "research"]),
  id: workspaceId,
  documentId: z.string().regex(/^[a-f0-9]{16}$/).optional(),
});

/** Read the saved Markdown again on the server, so the design always matches what is stored. */
async function loadMarkdown({ kind, id, documentId }: DocumentTarget) {
  if (kind === "research") {
    if (!documentId) return undefined;
    return (await loadBrandDocument(id, documentId)).document?.content;
  }
  const { records } = await loadAgentWorkspace();
  return kind === "brand"
    ? records?.brands.find((brand) => brand.id === id)?.knowledge
    : records?.playbooks.find((playbook) => playbook.id === id)?.strategy;
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Sign in to design pages." }, { status: 401, headers });
  // A JSON request cannot be submitted by a cross-origin HTML form.
  if (request.headers.get("content-type") !== "application/json") {
    return Response.json({ error: "Page design requires a JSON request." }, { status: 415, headers });
  }
  const parsed = target.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "This document was not found." }, { status: 404, headers });
  const markdown = await loadMarkdown(parsed.data);
  if (markdown === undefined) return Response.json({ error: "This document was not found." }, { status: 404, headers });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: object) => {
        if (!open) return;
        try { controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); } catch { open = false; }
      };
      try {
        // Generation continues if the reader leaves, so the finished design is still saved.
        const layout = await generateDocumentLayout(user.id, markdown, send);
        send({ type: "saved", layout });
      } catch (error) {
        send({ type: "error", message: error instanceof WorkspaceRequestError ? error.message : "Couldn’t design this page. Try again." });
      } finally {
        if (open) controller.close();
      }
    },
  });
  return new Response(body, { headers: { ...headers, "Content-Type": "application/x-ndjson" } });
}
