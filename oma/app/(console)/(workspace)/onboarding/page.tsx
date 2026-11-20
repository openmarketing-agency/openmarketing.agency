import type { Metadata } from "next";
import { OnboardingPanel } from "@/components/onboarding-panel";
import { requireUser } from "@/lib/dal";
import { hermesConfigured } from "@/lib/server/marketing/hermes";
import { workspace } from "@/lib/server/marketing/state";

export const metadata: Metadata = { title: "Brand & Campaign" };

export default async function OnboardingPage() {
  const user = await requireUser();
  return <OnboardingPanel initial={workspace(user.id)} available={hermesConfigured()} />;
}
