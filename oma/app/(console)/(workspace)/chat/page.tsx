/** Opens the signed-in user’s conversation with oma-agent’s default profile. */

import { Suspense } from "react";

import { HermesChat } from "@/components/hermes-chat";
import { Loading } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { agentStatus } from "@/lib/server/agent-chat";

import "./chat.css";

export const metadata = { title: "Chat" };

async function Chat() {
  await requireUser();
  return (
    <div className="agent-library-page chat-page">
      <HermesChat status={await agentStatus("default")} />
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<Loading label="Loading chat…" />}><Chat /></Suspense>;
}
