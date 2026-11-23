import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CampaignDetail } from "@/components/campaign-detail";
import { campaignAgentIds, CampaignAgents, CampaignOverview } from "@/components/workspace-records";
import { Loading } from "@/components/ui";
import { suggestCampaignTools } from "@/lib/campaign-tool-suggestions";
import { loadToolWorkspace } from "@/lib/tool-workspace";
import { connectionFeedback } from "@/lib/connection-attempt";
import { requireUser } from "@/lib/dal";
import { loadAgentWorkspace, loadCampaignModelDefaults, workspaceId } from "@/lib/server/agent-workspace";
import "@/components/campaign-pages.css";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function Page(props: Props) {
  return <Suspense fallback={<Loading label="Loading campaign…" />}><Detail {...props} /></Suspense>;
}

async function Detail({ params, searchParams }: Props) {
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

  const linkedPlaybook = records.playbooks.find((item) => item.id === saved.playbookId);
  const brand = records.brands.find((item) => item.id === linkedPlaybook?.brandId);
  const [workspace, query] = await Promise.all([loadToolWorkspace(suggestCampaignTools(saved, brand)), searchParams]);
  const agents = campaignAgentIds(records, saved);

  return (
    <CampaignDetail
      key={saved.id}
      campaign={saved}
      modelDefaults={loadCampaignModelDefaults()}
      overview={<CampaignOverview workspace={records} campaign={saved} />}
      agents={<CampaignAgents workspace={records} campaign={saved} ids={agents} />}
      agentCount={agents.length}
      {...workspace}
      feedback={connectionFeedback(query.connection_result)}
    />
  );
}
