/** Authenticates chat actions before sending messages and prompt responses to the gateway. */

"use server";

import { requireUser } from "@/lib/dal";
import { AgentChatError, answerAgentPrompt, getAgentRun, startAgentRun } from "@/lib/server/agent-chat";

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

export async function sendChatMessage(sessionId: string, turnId: string, message: string) {
  return withUser((userId) => startAgentRun(userId, { sessionId, turnId, message }));
}

export async function readChatTurn(handle: string) {
  return withUser((userId) => getAgentRun(userId, handle));
}

export async function answerChatPrompt(handle: string, prompt: unknown) {
  return withUser((userId) => answerAgentPrompt(userId, handle, prompt));
}
