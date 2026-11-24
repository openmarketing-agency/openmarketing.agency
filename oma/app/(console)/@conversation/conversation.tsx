/** Loads the authenticated conversation and its Hermes history for a workspace or campaign. */

import { Suspense } from "react";
import { Loading } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { requireAgentSetup } from "@/lib/server/agent-setup";
import { agentStatus } from "@/lib/server/agent-chat";
import { workspaceId } from "@/lib/server/agent-workspace";
import { loadChatHistory } from "@/lib/server/chat-history";
import { HermesChat } from "@/components/hermes-chat";

export type ConversationParams = Promise<{ chat?: string | string[] }>;

type Props = {
  searchParams?: ConversationParams;
  campaignParams?: Promise<{ id: string }>;
};

export function Conversation(props: Props) {
  return (
    <Suspense fallback={<Loading label="Loading chat…" />}>
      <LoadConversation {...props} />
    </Suspense>
  );
}

async function LoadConversation({ searchParams, campaignParams }: Props) {
  const user = await requireUser();
  requireAgentSetup(user.id);
  const chat = (await searchParams)?.chat;
  const campaignId = campaignParams ? workspaceId.safeParse((await campaignParams).id).data : undefined;
  const [status, history] = await Promise.all([
    agentStatus("default"),
    loadChatHistory(user.id, campaignId, chat),
  ]);
  return <HermesChat key={history.active?.id ?? "new"} status={status} history={history} campaignId={campaignId} />;
}
