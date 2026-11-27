import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CampaignDetail } from "@/components/campaign-detail";
import { campaignAgentIds, CampaignAgents, CampaignOverview } from "@/components/workspace-records";
import { agentDisplayName } from "@/lib/agent-name";
import { Loading } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { loadAgentWorkspace, readCampaignKanbanStatus, workspaceId } from "@/lib/server/agent-workspace";
import "@/components/campaign-pages.css";
import "@/components/workspace-document.css";

type Props = {
  params: Promise<{ id: string }>;
};

export default function Page(props: Props) {
  return <Suspense fallback={<Loading label="Loading campaign…" />}><Detail {...props} /></Suspense>;
}

async function Detail({ params }: Props) {
  const { id } = await params;
  if (!workspaceId.safeParse(id).success) notFound();
  await requireUser();
  const { records, error } = await loadAgentWorkspace();
  const saved = records?.campaigns.find((item) => item.id === id);
  if (!saved || !records) {
    if (!error) notFound();
    return (
      <div className="agent-playbook-page campaign-page">
        <Link className="back-link" href="/dashboard"><ArrowLeft size={14} aria-hidden="true" /> Campaigns</Link>
        <header className="campaign-heading"><h1>Campaign unavailable</h1></header>
        <p className="form-error" role="alert">{error}</p>
      </div>
    );
  }

  const kanban = await readCampaignKanbanStatus(saved);
  const agents = campaignAgentIds(records, saved);

  return (
    <CampaignDetail
      key={saved.id}
      campaign={saved}
      kanban={kanban}
      overview={<CampaignOverview workspace={records} campaign={saved} />}
      agents={<CampaignAgents workspace={records} campaign={saved} ids={agents} />}
      agentNames={Object.fromEntries(agents.map((id) => [id, agentDisplayName(records.agents.find((agent) => agent.id === id) ?? { id, name: id })]))}
    />
  );
}
