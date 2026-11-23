/** Saves the signed-in owner’s workspace and campaign settings edits back to oma-agent. */

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/dal";
import { generateCampaignMcpUrl } from "@/lib/tool-workspace";
import { approveCampaignPublication } from "@/lib/server/agent-publications";
import { completeAgentSetup, needsAgentSetup, requireAgentSetup } from "@/lib/server/agent-setup";
import { isProjectSetupComplete, readProjectSetup } from "@/lib/server/project-setup";
import { approveWorkspacePublication, listWorkspacePublications, publicationRevision, brandUpdate, knowledgeUpdate, playbookUpdate, previewCampaignPlan, saveCampaignConfiguration, saveCampaignMode, saveCampaignPlan, saveStandaloneModel, saveWorkspaceRecord, WorkspaceRequestError, type CampaignConfigurationResult, type StandaloneModelResult, type WorkspaceEdit } from "@/lib/server/agent-workspace";

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
  const user = await requireUser();
  requireAgentSetup(user.id);
  const result = await saveCampaignConfiguration(id, Object.fromEntries(form), (required) => generateCampaignMcpUrl(user.id, required));
  if (result.configuration) revalidatePath("/campaigns/" + id);
  return result;
}

export async function saveCampaignModeAction(
  id: string, _previous: { error?: string; saved?: boolean }, form: FormData,
): Promise<{ error?: string; saved?: boolean }> {
  const user = await requireUser();
  requireAgentSetup(user.id);
  try {
    await saveCampaignMode(id, { revision: form.get("revision"), mode: form.get("mode") });
    revalidatePath("/campaigns/" + id);
    return { saved: true };
  } catch (error) {
    revalidatePath("/campaigns/" + id);
    return { error: error instanceof WorkspaceRequestError ? error.message : "Couldn’t save the campaign mode." };
  }
}

export async function approveCampaignPublicationAction(
  campaignId: string, publicationId: string, _previous: { error?: string; queued?: boolean }, form: FormData,
): Promise<{ error?: string; queued?: boolean }> {
  const user = await requireUser();
  requireAgentSetup(user.id);
  const revision = form.get("revision");
  try {
    await approveCampaignPublication(campaignId, publicationId, {
      revision: typeof revision === "string" && /^[0-9]+$/.test(revision) ? Number(revision) : undefined,
      approver: user.id,
    });
    revalidatePath("/approvals");
    return { queued: true };
  } catch (error) {
    revalidatePath("/approvals");
    return { error: error instanceof WorkspaceRequestError ? error.message : "Couldn’t queue the publisher." };
  }
}

export async function saveStandaloneModelAction(
  setup: boolean, _previous: StandaloneModelResult, form: FormData,
): Promise<StandaloneModelResult> {
  const user = await requireUser();
  const result = await saveStandaloneModel({
    revision: form.get("revision"), provider: form.get("provider"), modelId: form.get("modelId"), baseUrl: form.get("baseUrl"),
    modelKey: form.get("modelKey"),
    reasoningEffort: form.get("reasoningEffort"),
  }, { requireKey: setup || needsAgentSetup(user.id) });
  if (result.models && !result.error) {
    completeAgentSetup(user.id);
    revalidatePath("/settings");
    revalidatePath("/dashboard");
    if (setup) redirect(isProjectSetupComplete(readProjectSetup(user.id)) ? "/dashboard" : "/onboarding", "replace");
  }
  return result;
}

export async function saveCampaignPlanAction(id: string, input: unknown) {
  await requireUser();
  try {
    const saved = await saveCampaignPlan(id, input);
    revalidatePath("/campaigns/" + id);
    revalidatePath("/dashboard");
    return { ok: true as const, ...saved };
  } catch (error) {
    if (error instanceof WorkspaceRequestError) return { ok: false as const, message: error.message };
    throw error;
  }
}

export async function askCampaignPlanAction(id: string, input: unknown) {
  await requireUser();
  try {
    return { ok: true as const, ...(await previewCampaignPlan(id, input)) };
  } catch (error) {
    if (error instanceof WorkspaceRequestError) return { ok: false as const, message: error.message };
    throw error;
  }
}

export async function deployCampaignAction(
  id: string,
  _previous: CampaignConfigurationResult,
  form: FormData,
): Promise<CampaignConfigurationResult> {
  const user = await requireUser();
  requireAgentSetup(user.id);
  const result = await saveCampaignConfiguration(id, Object.fromEntries(form), (required) => generateCampaignMcpUrl(user.id, required), true);
  if (result.configuration) {
    revalidatePath("/campaigns/" + id);
    revalidatePath("/dashboard");
  }
  return result;
}

export async function loadSavedCampaignPublications(id: string, before?: number) {
  await requireUser();
  if (before !== undefined && !publicationRevision.safeParse(before).success) {
    return { ok: false, status: 422, message: "Invalid publications page." };
  }
  try {
    return { ok: true, page: await listWorkspacePublications(id, before) };
  } catch (error) {
    if (error instanceof WorkspaceRequestError) return { ok: false, status: error.status, message: error.message };
    throw error;
  }
}

export async function approveSavedCampaignPublication(id: string, publicationId: string, revision: unknown) {
  const user = await requireUser();
  requireAgentSetup(user.id);
  const parsed = publicationRevision.safeParse(revision);
  if (!parsed.success) return { ok: false, status: 422, message: "A positive publication revision is required." };
  try {
    const publication = await approveWorkspacePublication(id, publicationId, parsed.data, user.id);
    revalidatePath("/campaigns/" + id);
    revalidatePath("/approvals");
    return { ok: true, publication };
  } catch (error) {
    if (error instanceof WorkspaceRequestError) return { ok: false, status: error.status, message: error.message };
    throw error;
  }
}
