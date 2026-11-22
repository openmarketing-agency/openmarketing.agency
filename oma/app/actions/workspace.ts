/** Saves the signed-in owner’s workspace and campaign settings edits back to oma-agent. */

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/dal";
import { brandUpdate, knowledgeUpdate, playbookUpdate, saveCampaignConfiguration, saveWorkspaceRecord, WorkspaceRequestError, type CampaignConfigurationResult, type WorkspaceEdit } from "@/lib/server/agent-workspace";

export async function saveWorkspaceEdit(
  collection: WorkspaceEdit,
  id: string,
  _previous: { message: string },
  form: FormData,
) {
  await requireUser();
  if (collection !== "brands" && collection !== "playbooks" && collection !== "brand-knowledge") return { message: "This workspace record was not found." };
  const revision = form.get("revision");
  const parsed = collection === "brands"
    ? brandUpdate.safeParse({
      revision, name: form.get("name"), description: form.get("description"), knowledge_base: form.get("knowledge_base") ?? undefined,
    })
    : collection === "brand-knowledge"
      ? knowledgeUpdate.safeParse({ revision, knowledge_base: form.get("knowledge_base") })
      : playbookUpdate.safeParse({ revision, strategy: form.get("strategy") });
  if (!parsed.success) return { message: "Check the required fields and character limits." };

  try {
    await saveWorkspaceRecord(collection, id, parsed.data);
  } catch (error) {
    if (error instanceof WorkspaceRequestError) return { message: error.message };
    throw error;
  }

  const path = "/workspace/" + (collection === "brand-knowledge" ? "brands" : collection) + "/" + id;
  revalidatePath("/dashboard");
  revalidatePath("/campaigns/[id]", "page");
  revalidatePath(path);
  redirect(path + (collection === "brand-knowledge" ? "?saved=knowledge" : "?saved=1"));
}

export async function saveCampaignSettingsAction(
  id: string,
  _previous: CampaignConfigurationResult,
  form: FormData,
): Promise<CampaignConfigurationResult> {
  await requireUser();
  const result = await saveCampaignConfiguration(id, Object.fromEntries(form));
  if (result.configuration) revalidatePath("/campaigns/" + id);
  return result;
}
