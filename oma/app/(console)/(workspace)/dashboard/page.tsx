import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { CampaignLibrary } from "@/components/campaign-library";
import { requireUser } from "@/lib/dal";
import { readOnboarding } from "@/lib/server/onboarding";

export const metadata: Metadata = { title: "Campaigns" };

async function SetupLink() {
  const user = await requireUser();
  const { step } = readOnboarding(user.id);
  if (step.status === "closed") return null;

  return (
    <div className="mb-6">
      <Link href="/onboarding" className="btn secondary">
        {step.status === "intro" ? "Set up your workspace" : "Resume workspace setup"}
      </Link>
    </div>
  );
}

export default function DashboardPage() {
  return <CampaignLibrary setup={<Suspense fallback={null}><SetupLink /></Suspense>} />;
}
