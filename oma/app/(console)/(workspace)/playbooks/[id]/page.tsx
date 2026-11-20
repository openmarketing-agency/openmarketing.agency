import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PlaybookDetail } from "@/components/playbook-detail";
import { Loading } from "@/components/ui";
import { loadToolWorkspace } from "@/lib/tool-workspace";
import { connectionFeedback } from "@/lib/connection-attempt";
import { findPlaybook } from "@/lib/playbooks";
type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export default function Page({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<Loading label="Loading playbook…" />}>
      <Detail params={params} searchParams={searchParams} />
    </Suspense>
  );
}
async function Detail({ params, searchParams }: Props) {
  const p = findPlaybook((await params).id);
  if (!p) notFound();
  const [workspace, query] = await Promise.all([loadToolWorkspace(), searchParams]);
  return (
    <PlaybookDetail
      playbook={p}
      {...workspace}
      initialAgent={typeof query.agent === "string" ? query.agent : undefined}
      initialView={typeof query.view === "string" ? query.view : undefined}
      feedback={connectionFeedback(query.connection_result)}
    />
  );
}
