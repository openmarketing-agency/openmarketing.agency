import type { Metadata } from "next";
import { Suspense } from "react";

import { AgentActivity } from "@/components/agent-activity";
import { CampaignLibrary } from "@/components/campaign-library";
import { StandaloneModelSettings } from "@/components/standalone-model-settings";
import { Loading } from "@/components/ui";
import { campaignAgentIds, campaignLifecycleLabel, WorkspaceIndex } from "@/components/workspace-records";
import { requireUser } from "@/lib/dal";
import { loadAgentWorkspace } from "@/lib/server/agent-workspace";
import { isProjectSetupComplete, readProjectSetup } from "@/lib/server/project-setup";
import "@/components/campaign-pages.css";

export const metadata: Metadata = { title: "Campaigns" };

export default function DashboardPage() {
  return (
    <Suspense fallback={<Loading label="Loading campaigns…" />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const user = await requireUser();
  const project = readProjectSetup(user.id);
  const { records, error } = await loadAgentWorkspace();
  const saved = records?.campaigns.map((campaign) => {
    const playbook = records.playbooks.find((item) => item.id === campaign.playbookId);
    const brand = records.brands.find((item) => item.id === playbook?.brandId);
    return {
      id: campaign.id, name: campaign.name, description: campaign.description, version: campaign.version,
      status: campaignLifecycleLabel(campaign),
      agentCount: campaignAgentIds(records, campaign).length, playbook: playbook && { id: playbook.id, name: playbook.name },
      brand: brand && { id: brand.id, name: brand.name },
    };
  });
  return (
    <CampaignLibrary
      saved={saved}
      setup={isProjectSetupComplete(project) ? undefined : { needsRetry: project?.setup.status === "done" }}
      error={error}
      sidebar={<>
        <AgentActivity />
        {records && <WorkspaceIndex workspace={records} modelSettings={
          records.standaloneModels && <StandaloneModelSettings models={records.standaloneModels} />
        } />}
      </>}
    />
  );
}
