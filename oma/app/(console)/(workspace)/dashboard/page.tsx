import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AgentActivity } from "@/components/agent-activity";
import { CampaignLibrary } from "@/components/campaign-library";
import { Loading } from "@/components/ui";
import { campaignAgentIds, WorkspaceIndex } from "@/components/workspace-records";
import { requireUser } from "@/lib/dal";
import { loadAgentWorkspace } from "@/lib/server/agent-workspace";
import { isProjectSetupComplete, readProjectSetup } from "@/lib/server/project-setup";
import "@/components/campaign-pages.css";

export const metadata: Metadata = { title: "Campaigns" };

async function SetupLink() {
  const user = await requireUser();
  const project = readProjectSetup(user.id);
  if (isProjectSetupComplete(project)) return null;

  return (
    <Link href="/onboarding" className="btn secondary">
      {project?.setup.status === "done" ? "Finish project setup" : "Set up your workspace"}
    </Link>
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
      status: campaign.installationState === "installed" ? "Installed" : campaign.installationState === "installing" ? "Installation incomplete"
        : campaign.board ? undefined : "Draft",
      agentCount: campaignAgentIds(records, campaign).length, playbook: playbook && { id: playbook.id, name: playbook.name },
      brand: brand && { id: brand.id, name: brand.name },
    };
  });
  return (
    <CampaignLibrary
      saved={saved}
      setup={<SetupLink />}
      notice={error ? <p className="form-error" role="alert">{error}</p>
        : !records && <p className="notice">Start the full Docker stack to see saved campaigns.</p>}
      sidebar={<><AgentActivity />{records && <WorkspaceIndex workspace={records} />}</>}
    />
  );
}
