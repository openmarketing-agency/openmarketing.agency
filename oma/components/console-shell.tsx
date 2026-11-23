/** Provides workspace navigation and account access across console routes. */

"use client";

import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardCheck, LogOut, Megaphone, MessageSquare, Plug } from "lucide-react";

import { logoutAction } from "@/app/actions/auth";
import { Brand } from "@/components/brand";

import "./console-shell.css";

const destinations = [
  { href: "/dashboard", label: "Campaigns", icon: Megaphone },
  { href: "/approvals", label: "Approvals", icon: ClipboardCheck },
  { href: "/connections", label: "Tools", icon: Plug },
  { href: "/chat", label: "Chat", icon: MessageSquare },
];

type ConsoleProps = { email?: string; children: ReactNode };

export function ConsoleShell(props: ConsoleProps) {
  return (
    <Suspense fallback={<ConsoleFrame {...props} pathname="" />}>
      <PathAwareConsole {...props} />
    </Suspense>
  );
}

function PathAwareConsole(props: ConsoleProps) {
  return <ConsoleFrame {...props} pathname={usePathname()} />;
}

function SignOut() {
  return (
    <form action={logoutAction}>
      <button type="submit" className="icon-button" aria-label="Sign out" title="Sign out">
        <LogOut size={17} aria-hidden="true" />
      </button>
    </form>
  );
}

function ConsoleFrame({ email, children, pathname }: ConsoleProps & { pathname: string }) {
  const inCampaignWorkspace = pathname.startsWith("/campaigns/") || pathname.startsWith("/workspace/");
  const active = inCampaignWorkspace ? destinations[0] : destinations.find(({ href }) =>
    pathname === href || pathname.startsWith(`${href}/`),
  );

  return (
    <div className="workbench">
      <header className="workbench-mobile">
        <Brand />
        {active && <span>{active.label}</span>}
        {email && <SignOut />}
      </header>
      <aside className="workbench-nav">
        <div className="workbench-brand"><Brand /></div>
        <nav className="workbench-links" aria-label="Workspace">
          {destinations.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}
              aria-current={href === active?.href ? (pathname === href ? "page" : "location") : undefined}>
              <Icon size={19} strokeWidth={1.7} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        {email && <div className="workbench-account">
          <span className="avatar" aria-hidden="true">{email[0].toUpperCase()}</span>
          <strong title={email}>{email}</strong>
          <SignOut />
        </div>}
      </aside>
      <main id="main-content" tabIndex={-1} className="workbench-main">{children}</main>
    </div>
  );
}
