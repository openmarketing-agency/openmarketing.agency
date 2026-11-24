/** Authenticates conversation reads and run controls before forwarding them to oma-agent. */

"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/dal";
import { requireAgentSetup } from "@/lib/server/agent-setup";
import { readCampaignChanges, syncCampaignChatChanges, WorkspaceRequestError, workspaceId } from "@/lib/server/agent-workspace";
import { generateCampaignMcpUrl } from "@/lib/tool-workspace";
import { AgentChatError, answerAgentPrompt, getAgentRun, steerAgentRun } from "@/lib/server/agent-chat";
import { loadOlderChatMessages, sendNativeChatTurn } from "@/lib/server/chat-history";

async function withUser<T>(operation: (userId: string) => Promise<T>) {
  const user = await requireUser();
  try {
    return { ok: true as const, data: await operation(user.id) };
  } catch (error) {
    if (error instanceof AgentChatError) {
      return { ok: false as const, status: error.status, message: error.message };
    }
    console.error("Agent chat failed", error instanceof Error ? error.name : "Unknown error");
    return { ok: false as const, status: 500, message: "The chat request failed. Try again." };
  }
}

export async function sendChatMessage(threadId: string, turnId: string, message: string, campaignId?: string) {
  return withUser(async (userId) => {
    const changes = campaignId ? await readCampaignChanges(campaignId) : undefined;
    const run = await sendNativeChatTurn(userId, { threadId, turnId, message, campaignId });
    return { ...run, changes };
  });
}

export async function steerChatMessage(handle: string, message: string, campaignId?: string) {
  return withUser((userId) => steerAgentRun(userId, handle, { message, campaignId }));
}

export async function readOlderChatMessages(threadId: string, offset: number, campaignId?: string) {
  return withUser((userId) => loadOlderChatMessages(userId, threadId, offset, campaignId));
}

export async function readChatTurn(handle: string) {
  return withUser((userId) => getAgentRun(userId, handle, "default"));
}

export async function syncCompletedCampaignChat(id: string, handle: string, previous: unknown) {
  const user = await requireUser();
  requireAgentSetup(user.id);
  if (!workspaceId.safeParse(id).success) return { error: "Campaign not found." };
  try {
    if ((await getAgentRun(user.id, handle, "default")).status !== "completed") return undefined;
    return await syncCampaignChatChanges(id, previous, (required) => generateCampaignMcpUrl(user.id, required));
  } catch (error) {
    return { error: error instanceof WorkspaceRequestError ? error.message : "Couldn’t sync the agent’s changes. Open Agents to retry." };
  } finally {
    revalidatePath("/campaigns/" + id);
    revalidatePath("/dashboard");
  }
}

export async function answerChatPrompt(handle: string, prompt: unknown) {
  return withUser((userId) => answerAgentPrompt(userId, handle, prompt, "default"));
}
