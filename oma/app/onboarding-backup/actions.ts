/** Authorizes setup actions and returns the signed-in user to their workspace. */

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/dal";
import { AgentChatError } from "@/lib/server/agent-chat";
import {
  beginOnboarding,
  completeOnboarding,
  readOnboarding,
  refreshOnboarding,
  resetOnboarding,
  skipOnboarding,
  submitOnboardingAnswer,
} from "@/lib/server/onboarding";

async function withUser<T>(operation: (userId: string) => T | Promise<T>) {
  const user = await requireUser();
  try {
    return { ok: true as const, data: await operation(user.id) };
  } catch (error) {
    if (error instanceof AgentChatError) return { ok: false as const, message: error.message };
    console.error("Onboarding request failed", error instanceof Error ? error.name : "Unknown error");
    return { ok: false as const, message: "Couldn’t update your setup. Try again." };
  }
}

export async function startSetup() {
  return withUser(beginOnboarding);
}

export async function refreshSetup() {
  return withUser(refreshOnboarding);
}

export async function resetDevelopmentSetup() {
  return withUser(process.env.NODE_ENV === "development" ? resetOnboarding : readOnboarding);
}

export async function answerSetup(id: string, generation: number, answer: string) {
  return withUser((userId) => submitOnboardingAnswer(userId, { id, generation, answer }));
}

export async function finishSetup() {
  const user = await requireUser();
  const persistCompletion = process.env.NODE_ENV !== "development";
  if (!completeOnboarding(user.id, persistCompletion)) redirect("/onboarding-backup", "replace");
  revalidatePath("/onboarding-backup");
  revalidatePath("/dashboard");
  redirect("/dashboard", "replace");
}

export async function skipSetup() {
  const user = await requireUser();
  skipOnboarding(user.id);
  revalidatePath("/dashboard");
  redirect("/dashboard", "replace");
}
