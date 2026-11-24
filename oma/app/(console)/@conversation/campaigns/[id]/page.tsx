/** Passes the current campaign ID to the authenticated chat pane. */

import { Conversation, type ConversationParams } from "../../conversation";

export default function CampaignConversationPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: ConversationParams;
}) {
  return <Conversation searchParams={searchParams} campaignParams={params} />;
}
