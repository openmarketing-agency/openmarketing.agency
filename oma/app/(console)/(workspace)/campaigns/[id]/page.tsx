import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CampaignDetail } from "@/components/campaign-detail";
import { CampaignOverview } from "@/components/workspace-records";
import { Loading } from "@/components/ui";
import { loadToolWorkspace } from "@/lib/tool-workspace";
import { connectionFeedback } from "@/lib/connection-attempt";
import { requireUser } from "@/lib/dal";
import { loadAgentWorkspace, savedCampaignToolAgents, workspaceId } from "@/lib/server/agent-workspace";
type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export default function Page({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<Loading label="Loading campaign…" />}>
      <Detail params={params} searchParams={searchParams} />
    </Suspense>
  );
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
      <div className="agent-playbook-page">
        <Link className="back-link" href="/dashboard"><ArrowLeft size={14} aria-hidden="true" /> Campaigns</Link>
        <p className="form-error" role="alert">{error}</p>
      </div>
    );
  }

  const overview = <CampaignOverview workspace={records} campaign={saved} />;
  const agents = savedCampaignToolAgents(records, saved);
  if (!agents.length) {
    return (
      <div className="agent-playbook-page">
        <Link className="back-link" href="/dashboard"><ArrowLeft size={14} aria-hidden="true" /> Campaigns</Link>
        <header className="agent-page-heading">
          <div>
            <div className="agent-title-line">
              <h1>{saved.name}</h1>
              {saved.version && <span className="version-label">v{saved.version}</span>}
            </div>
            {saved.description && <p>{saved.description}</p>}
          </div>
        </header>
        {overview}
      </div>
    );
  }
  const [workspace, query] = await Promise.all([loadToolWorkspace(), searchParams]);
  return (
    <CampaignDetail
      campaign={saved}
      agents={agents}
      overview={overview}
      {...workspace}
      initialAgent={typeof query.agent === "string" ? query.agent : undefined}
      initialView={typeof query.view === "string" ? query.view : undefined}
      feedback={connectionFeedback(query.connection_result)}
    />
  );
}
