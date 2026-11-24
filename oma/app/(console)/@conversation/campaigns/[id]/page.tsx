/** Loads the conversation history scoped to the campaign in the URL. */

import { workspaceId } from "@/lib/server/agent-workspace";
import { Conversation, type ConversationParams } from "../../conversation";

export default async function CampaignConversationPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: ConversationParams;
}) {
  const campaign = workspaceId.safeParse((await params).id);
  return <Conversation searchParams={searchParams} campaignId={campaign.data} />;
}
