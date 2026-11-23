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
    <div className="workspace-page chat-page">
      <header className="workspace-heading">
        <h1>Chat with oma-agent</h1>
        <p>Ask about your workspace or plan what to do next in a campaign.</p>
      </header>
      <HermesChat status={await agentStatus("default")} />
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<Loading label="Loading chat…" />}><Chat /></Suspense>;
}
