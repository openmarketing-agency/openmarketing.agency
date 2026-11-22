/** Shows the signed-in user’s chat and the local gateway connection state. */

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
    <div className="workspace-page chat-page">
      <header className="workspace-heading">
        <h1>Chat</h1>
        <p>Talk with your Hermes agent.</p>
      </header>
      <HermesChat status={await agentStatus("default")} />
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<Loading label="Loading chat…" />}><Chat /></Suspense>;
}
