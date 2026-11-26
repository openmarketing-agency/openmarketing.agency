/** Loads the authenticated campaign agent record and its saved profile document. */

import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AgentProfileDetail } from "@/components/agent-profile-detail";
import { Loading } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { loadAgentProfile, loadAgentWorkspace, workspaceId } from "@/lib/server/agent-workspace";
import "@/components/workspace-record-detail.css";
import "@/components/workspace-document.css";

type Props = { params: Promise<{ id: string }> };

export const metadata = { title: "Agent profile" };

export default function AgentPage(props: Props) {
  return <Suspense fallback={<Loading label="Loading agent profile…" />}><AgentProfile {...props} /></Suspense>;
}

async function AgentProfile({ params }: Props) {
  const { id } = await params;
  if (!workspaceId.safeParse(id).success) notFound();
  await requireUser();
  const { records, error } = await loadAgentWorkspace();
  const agent = records?.agents.find((item) => item.id === id);
  if (!agent) {
    if (!error) notFound();
    return (
      <div className="agent-playbook-page record-detail">
        <Link className="back-link" href="/dashboard"><ArrowLeft size={14} aria-hidden="true" /> Campaigns</Link>
        <header className="record-heading">
          <div>
            <h1>Agent profile unavailable</h1>
            <p className="form-error" role="alert">{error}</p>
          </div>
        </header>
      </div>
    );
  }

  const campaign = records?.campaigns.find((item) => item.id === agent.campaignId);
  const result = await loadAgentProfile(id);
  return <AgentProfileDetail agent={agent} campaign={campaign} {...result} />;
}
