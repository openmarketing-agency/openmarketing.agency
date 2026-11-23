/** Keeps the conversation rail usable when a console route has no matching chat segment. */

import Conversation from "./[...section]/page";

export default function DefaultConversation() {
  return <Conversation params={Promise.resolve({ section: [] })} searchParams={Promise.resolve({})} />;
}
