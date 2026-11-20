import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { CampaignLibrary } from "@/components/campaign-library";
import { Loading } from "@/components/ui";
import { WorkspaceIndex } from "@/components/workspace-records";
import { requireUser } from "@/lib/dal";
import { loadAgentWorkspace } from "@/lib/server/agent-workspace";
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
  return (
    <Suspense fallback={<Loading label="Loading campaigns…" />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  await requireUser();
  const { records, error } = await loadAgentWorkspace();
  const saved = records?.campaigns.map((campaign) => {
    const playbook = records.playbooks.find((item) => item.id === campaign.playbookId);
    const brand = records.brands.find((item) => item.id === playbook?.brandId);
    return {
      id: campaign.id, name: campaign.name, description: campaign.description, version: campaign.version,
      agentCount: campaign.agentIds.length, playbook: playbook && { id: playbook.id, name: playbook.name },
      brand: brand && { id: brand.id, name: brand.name },
    };
  });
  return (
    <CampaignLibrary saved={saved} setup={
      <>
        <SetupLink />
        {error && <p className="form-error" role="alert">{error}</p>}
        {!records && !error && <p>Start the full Docker stack to see saved campaigns.</p>}
        {records && <WorkspaceIndex workspace={records} />}
      </>
    } />
  );
}
