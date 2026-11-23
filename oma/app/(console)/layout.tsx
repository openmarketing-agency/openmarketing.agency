import { Suspense, type ReactNode } from "react";

import { ConsoleShell } from "@/components/console-shell";
import { Loading } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { requireAgentSetup } from "@/lib/server/agent-setup";

type Props = { children: ReactNode; conversation: ReactNode };

async function AuthenticatedConsole({ children, conversation }: Props) {
  const user = await requireUser();
  requireAgentSetup(user.id);
  return (
    <ConsoleShell
      email={user.email}
      conversation={<Suspense fallback={<Loading label="Loading chat…" />}>{conversation}</Suspense>}
    >
      {children}
    </ConsoleShell>
  );
}

export default function ConsoleLayout({ children, conversation }: Props) {
  return (
    <Suspense fallback={
      <ConsoleShell conversation={<Loading label="Loading chat…" />}>
        <Loading label="Loading workspace…" />
      </ConsoleShell>
    }>
      <AuthenticatedConsole conversation={conversation}>{children}</AuthenticatedConsole>
    </Suspense>
  );
}
