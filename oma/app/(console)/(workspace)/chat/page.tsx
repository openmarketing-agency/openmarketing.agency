/** Opens the signed-in user’s conversation with oma-agent’s default profile. */

import { Suspense } from "react";

import { HermesChat } from "@/components/hermes-chat";
import { Loading } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { agentStatus } from "@/lib/server/agent-chat";
import { loadChatHistory } from "@/lib/server/chat-history";

export const metadata = { title: "Chat" };

type Props = { searchParams: Promise<{ chat?: string | string[] }> };

async function Chat({ searchParams }: Props) {
  const user = await requireUser();
  const { chat } = await searchParams;
  const [status, history] = await Promise.all([agentStatus("default"), loadChatHistory(user.id, undefined, chat)]);
  return (
    <div className="workspace-page chat-page">
      <header className="workspace-heading">
        <h1>Chat with oma-agent</h1>
        <p>Ask about your workspace or plan what to do next in a campaign.</p>
      </header>
      <HermesChat key={history.active?.id ?? "new"} status={status} history={history} />
    </div>
  );
}

export default function Page(props: Props) {
  return <Suspense fallback={<Loading label="Loading chat…" />}><Chat {...props} /></Suspense>;
}
