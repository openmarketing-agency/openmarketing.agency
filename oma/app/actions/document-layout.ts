/** Asks the default agent to design an OpenUI page for a saved brand, playbook, or research document. */

"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/dal";
import { loadAgentWorkspace, loadBrandDocument, workspaceId, WorkspaceRequestError } from "@/lib/server/agent-workspace";
import { generateDocumentLayout, type DocumentKind } from "@/lib/server/document-layout";

export type DocumentTarget = { kind: DocumentKind; id: string; documentId?: string };
export type DesignResult = { error?: string; designed?: number };

async function loadTarget(target: DocumentTarget) {
  if (!workspaceId.safeParse(target.id).success) return undefined;
  if (target.kind === "research") {
    if (!target.documentId) return undefined;
    const { document } = await loadBrandDocument(target.id, target.documentId);
    return document && { title: document.title, markdown: document.content };
  }
  const { records } = await loadAgentWorkspace();
  if (target.kind === "brand") {
    const brand = records?.brands.find(({ id }) => id === target.id);
    return brand && { title: brand.name, markdown: brand.knowledge };
  }
  const playbook = records?.playbooks.find(({ id }) => id === target.id);
  return playbook && { title: playbook.name, markdown: playbook.strategy };
}

export async function designDocumentAction(target: DocumentTarget): Promise<DesignResult> {
  const user = await requireUser();
  try {
    // The document is read again on the server, so the layout always matches what is saved.
    const document = await loadTarget(target);
    if (!document) return { error: "This document was not found." };
    const { generatedAt } = await generateDocumentLayout(user.id, target.kind, document.title, document.markdown);
    revalidatePath("/workspace/" + (target.kind === "playbook" ? "playbooks" : "brands") + "/" + target.id);
    return { designed: generatedAt };
  } catch (error) {
    if (error instanceof WorkspaceRequestError) return { error: error.message };
    throw error;
  }
}
