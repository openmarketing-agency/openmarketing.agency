"use server";

import { requireUser } from "@/lib/dal";
import { HermesUnavailable } from "@/lib/server/marketing/hermes";
import { clarifyOnboarding, refreshOnboarding, submitOnboarding } from "@/lib/server/marketing/onboarding";
import { changeCampaignProperty, propertySchema, setPaused, workspace, type OnboardingView } from "@/lib/server/marketing/state";

function fail(userId: string, error: unknown): OnboardingView {
  return {
    ...workspace(userId),
    requestError: error instanceof HermesUnavailable ? error.message : "We couldn’t complete that request. Try again.",
  };
}

export async function refreshOnboardingAction() {
  const user = await requireUser();
  try {
    return await refreshOnboarding(user.id);
  } catch (error) {
    return fail(user.id, error);
  }
}

export async function sendOnboardingAction(text: string) {
  const user = await requireUser();
  try {
    return await submitOnboarding(user.id, text);
  } catch (error) {
    return fail(user.id, error);
  }
}

export async function saveOnboardingAction(property: string) {
  const user = await requireUser();
  try {
    return await submitOnboarding(user.id, property, true);
  } catch (error) {
    return fail(user.id, error);
  }
}

export async function answerOnboardingAction(promptId: string, text: string) {
  const user = await requireUser();
  try {
    return await clarifyOnboarding(user.id, promptId, text);
  } catch (error) {
    return fail(user.id, error);
  }
}

export async function pauseCampaignAction(paused: boolean) {
  const user = await requireUser();
  if (typeof paused === "boolean") setPaused(user.id, paused);
  return workspace(user.id);
}

export async function changeCampaignPropertyAction(value: string): Promise<OnboardingView> {
  const user = await requireUser();
  const property = propertySchema.safeParse(value);
  if (!property.success) return { ...workspace(user.id), requestError: "Enter the exact Search Console property." };
  changeCampaignProperty(user.id, property.data);
  return workspace(user.id);
}
