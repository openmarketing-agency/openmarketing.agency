/** Keeps chat selection from the current URL on console pages that share workspace history. */

import { Conversation, type ConversationParams } from "./conversation";

export default function WorkspaceConversationPage({ searchParams }: { searchParams: ConversationParams }) {
  return <Conversation searchParams={searchParams} />;
}
