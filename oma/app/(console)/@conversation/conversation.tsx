/** Loads the authenticated conversation and its Hermes history for a workspace or campaign. */

import { requireUser } from "@/lib/dal";
import { requireAgentSetup } from "@/lib/server/agent-setup";
import { agentStatus } from "@/lib/server/agent-chat";
import { loadChatHistory } from "@/lib/server/chat-history";
import { HermesChat } from "@/components/hermes-chat";

export type ConversationParams = Promise<{ chat?: string | string[] }>;

export async function Conversation({ searchParams, campaignId }: {
  searchParams?: ConversationParams;
  campaignId?: string;
}) {
  const user = await requireUser();
  requireAgentSetup(user.id);
  const chat = (await searchParams)?.chat;
  const [status, history] = await Promise.all([
    agentStatus("default"),
    loadChatHistory(user.id, campaignId, chat),
  ]);
  return <HermesChat key={history.active?.id ?? "new"} status={status} history={history} campaignId={campaignId} />;
}
