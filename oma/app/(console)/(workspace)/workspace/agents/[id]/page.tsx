/** Displays the saved role, tools, recurring jobs, and profile document for a campaign agent. */

import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Loading } from "@/components/ui";
import { WorkspaceText } from "@/components/workspace-text";
import { requireUser } from "@/lib/dal";
import { loadAgentProfile, loadAgentWorkspace, workspaceId } from "@/lib/server/agent-workspace";

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
  if (!agent && !error) notFound();
  const campaign = records?.campaigns.find((item) => item.id === agent?.campaignId);
  const result = agent ? await loadAgentProfile(id) : undefined;

  return (
    <div className="agent-playbook-page">
      <Link className="back-link" href={campaign ? "/campaigns/" + campaign.id : "/dashboard"}>
        <ArrowLeft size={14} aria-hidden="true" /> {campaign?.name || "Campaigns"}
      </Link>
      {agent ? (
        <>
          <header className="workspace-record-heading">
            <div>
              <h1>{agent.name}</h1>
              {agent.description && <p>{agent.description}</p>}
            </div>
          </header>
          <div className="workspace-overview">
            {(campaign || agent.model || agent.skills?.length || agent.toolsets.length) && (
              <dl className="workspace-facts">
                {campaign && <div><dt>Campaign</dt><dd>{campaign.name}</dd></div>}
                {agent.model && <div><dt>Model</dt><dd>{agent.model}</dd></div>}
                {!!agent.skills?.length && <div><dt>Skills</dt><dd>{agent.skills.join(", ")}</dd></div>}
                {!!agent.toolsets.length && <div><dt>Toolsets</dt><dd>{agent.toolsets.join(", ")}</dd></div>}
              </dl>
            )}
            <section>
              <h2>Agent profile</h2>
              {result?.error
                ? <p className="form-error" role="alert">{result.error}</p>
                : <WorkspaceText text={result?.profile?.content ?? ""} html={result?.profile?.html}
                  empty="No profile document saved yet." />}
            </section>
            {!!agent.jobs.length && (
              <section>
                <h2>Scheduled work</h2>
                <dl className="workspace-source-list">
                  {agent.jobs.map((job, index) => (
                    <div key={index}>
                      <dt>{job.name}</dt>
                      <dd>{[job.schedule, job.timezone, job.repeat ? job.repeat + (job.repeat === 1 ? " run" : " runs") : ""].filter(Boolean).join(" · ")}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
          </div>
        </>
      ) : <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
