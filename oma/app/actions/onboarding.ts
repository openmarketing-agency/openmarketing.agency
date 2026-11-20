"use server";

import { requireUser } from "@/lib/dal";
import { HermesUnavailable } from "@/lib/server/marketing/hermes";
import { clarifyOnboarding, refreshOnboarding, submitOnboarding } from "@/lib/server/marketing/onboarding";
import { activateCampaign, changeCampaignSources, setPaused, workspace, type OnboardingView } from "@/lib/server/marketing/state";

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

export async function generatePlaybookAction() {
  const user = await requireUser();
  try {
    return await submitOnboarding(user.id);
  } catch (error) {
    return fail(user.id, error);
  }
}

export async function activateCampaignAction(draftId: string, resources: Record<string, string>) {
  const user = await requireUser();
  return activateCampaign(user.id, draftId, resources);
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

export async function changeCampaignSourcesAction(resources: Record<string, string>) {
  const user = await requireUser();
  return changeCampaignSources(user.id, resources);
}
