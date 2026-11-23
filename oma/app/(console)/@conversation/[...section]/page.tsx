/** Selects the workspace or campaign conversation for the current dashboard route. */

import { requireUser } from "@/lib/dal";
import { requireAgentSetup } from "@/lib/server/agent-setup";
import { agentStatus } from "@/lib/server/agent-chat";
import { workspaceId } from "@/lib/server/agent-workspace";
import { loadChatHistory } from "@/lib/server/chat-history";
import { HermesChat } from "@/components/hermes-chat";

type Props = {
  params: Promise<{ section: string[] }>;
  searchParams: Promise<{ chat?: string | string[] }>;
};

export default async function Conversation({ params, searchParams }: Props) {
  const user = await requireUser();
  requireAgentSetup(user.id);
  const [{ section }, { chat }] = await Promise.all([params, searchParams]);
  const [area, id] = section;
  const campaignId = area === "campaigns" && section.length === 2 ? workspaceId.safeParse(id).data : undefined;
  const [status, history] = await Promise.all([
    agentStatus("default"),
    loadChatHistory(user.id, campaignId, chat),
  ]);
  return <HermesChat key={history.active?.id ?? "new"} status={status} history={history} campaignId={campaignId} />;
}
