import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CampaignDetail } from "@/components/campaign-detail";
import { HermesChat } from "@/components/hermes-chat";
import { campaignAgentIds, CampaignAgents, CampaignOverview } from "@/components/workspace-records";
import { Loading } from "@/components/ui";
import { loadCampaignTools } from "@/lib/tool-workspace";
import { connectionFeedback } from "@/lib/connection-attempt";
import { requireUser } from "@/lib/dal";
import { agentStatus } from "@/lib/server/agent-chat";
import { loadChatHistory } from "@/lib/server/chat-history";
import { loadAgentWorkspace, readCampaignKanbanStatus, workspaceId } from "@/lib/server/agent-workspace";
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
  const user = await requireUser();
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

  const [workspace, query, kanban, chatStatus] = await Promise.all([
    loadCampaignTools(saved.requiredIntegrations),
    searchParams,
    readCampaignKanbanStatus(saved),
    agentStatus("default"),
  ]);
  const agents = campaignAgentIds(records, saved);
  const history = await loadChatHistory(user.id, saved.id, query.chat);

  return (
    <div className="campaign-workspace" key={saved.id}>
      <CampaignDetail
        campaign={saved}
        kanban={kanban}
        overview={<CampaignOverview workspace={records} campaign={saved} />}
        agents={<CampaignAgents workspace={records} campaign={saved} ids={agents} />}
        agentCount={agents.length}
        {...workspace}
        feedback={connectionFeedback(query.connection_result)}
      />
      <aside className="campaign-chat-rail" aria-label="Campaign conversation">
        <HermesChat key={history.active?.id ?? "new"} status={chatStatus} history={history} campaignId={saved.id} />
      </aside>
    </div>
  );
}
