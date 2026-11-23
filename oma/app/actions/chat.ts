/** Authenticates conversation reads and run controls before forwarding them to oma-agent. */

"use server";

import { requireUser } from "@/lib/dal";
import { AgentChatError, answerAgentPrompt, getAgentRun } from "@/lib/server/agent-chat";
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
  return withUser((userId) => sendNativeChatTurn(userId, { threadId, turnId, message, campaignId }));
}

export async function readOlderChatMessages(threadId: string, offset: number, campaignId?: string) {
  return withUser((userId) => loadOlderChatMessages(userId, threadId, offset, campaignId));
}

export async function readChatTurn(handle: string) {
  return withUser((userId) => getAgentRun(userId, handle, "default"));
}

export async function answerChatPrompt(handle: string, prompt: unknown) {
  return withUser((userId) => answerAgentPrompt(userId, handle, prompt, "default"));
}
