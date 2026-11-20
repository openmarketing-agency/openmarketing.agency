import { Suspense } from "react";
import { WorkspaceConnections } from "@/components/workspace-connections";
import { Loading } from "@/components/ui";
import { loadToolWorkspace } from "@/lib/tool-workspace";
import { connectionFeedback } from "@/lib/connection-attempt";
type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export default function Page({ searchParams }: Props) {
  return (
    <Suspense fallback={<Loading label="Loading connections…" />}>
      <Connections searchParams={searchParams} />
    </Suspense>
  );
}
async function Connections({ searchParams }: Props) {
  const data = await loadToolWorkspace();
  const query = await searchParams;
  return (
    <WorkspaceConnections
      {...data}
      feedback={connectionFeedback(query.connection_result)}
    />
  );
}
