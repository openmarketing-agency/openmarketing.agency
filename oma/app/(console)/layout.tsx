import { Suspense, type ReactNode } from "react";

import { ConsoleShell } from "@/components/console-shell";
import { Loading } from "@/components/ui";
import { requireUser } from "@/lib/dal";

async function AuthenticatedConsole({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return <ConsoleShell email={user.email}>{children}</ConsoleShell>;
}

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ConsoleShell><Loading label="Loading workspace…" /></ConsoleShell>}>
      <AuthenticatedConsole>{children}</AuthenticatedConsole>
    </Suspense>
  );
}
