import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CampaignDetail } from "@/components/campaign-detail";
import { CampaignOverview } from "@/components/workspace-records";
import { Loading } from "@/components/ui";
import { suggestCampaignTools } from "@/lib/campaign-tool-suggestions";
import { loadToolWorkspace } from "@/lib/tool-workspace";
import { connectionFeedback } from "@/lib/connection-attempt";
import { requireUser } from "@/lib/dal";
import { loadAgentWorkspace, workspaceId } from "@/lib/server/agent-workspace";

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
      <div className="agent-playbook-page">
        <Link className="back-link" href="/dashboard"><ArrowLeft size={14} aria-hidden="true" /> Campaigns</Link>
        <p className="form-error" role="alert">{error}</p>
      </div>
    );
  }

  const linkedPlaybook = records.playbooks.find((item) => item.id === saved.playbookId);
  const brand = records.brands.find((item) => item.id === linkedPlaybook?.brandId);
  const [workspace, query] = await Promise.all([loadToolWorkspace(suggestCampaignTools(saved, brand)), searchParams]);
  const initialView = query.view === "mcp" ? "mcp"
    : query.view === "tools" || query.view === "team" || (query.view !== "overview" && typeof query.agent === "string")
      ? "tools" : "overview";

  return (
    <CampaignDetail
      campaign={saved}
      overview={<CampaignOverview workspace={records} campaign={saved} />}
      {...workspace}
      initialView={initialView}
      feedback={connectionFeedback(query.connection_result)}
    />
  );
}
