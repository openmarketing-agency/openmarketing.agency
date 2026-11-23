/** Provides workspace navigation, account access, and the right-side conversation across console routes. */

"use client";

import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ClipboardCheck, LogOut, Megaphone, Plug, Settings } from "lucide-react";

import { logoutAction } from "@/app/actions/auth";
import { Brand } from "@/components/brand";

import "./console-shell.css";

const destinations = [
  { href: "/dashboard", label: "Campaigns", icon: Megaphone },
  { href: "/approvals", label: "Approvals", icon: ClipboardCheck },
  { href: "/connections", label: "Tools", icon: Plug },
  { href: "/settings", label: "Settings", icon: Settings },
];

type ConsoleProps = { email?: string; children: ReactNode; conversation?: ReactNode };

export function ConsoleShell(props: ConsoleProps) {
  return (
    <Suspense fallback={<ConsoleFrame {...props} pathname="" />}>
      <PathAwareConsole {...props} />
    </Suspense>
  );
}

function PathAwareConsole(props: ConsoleProps) {
  const pathname = usePathname();
  const chat = useSearchParams().get("chat");
  return <ConsoleFrame {...props} pathname={pathname} selectedChat={pathname.startsWith("/campaigns/") ? null : chat} />;
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

function ConsoleFrame({ email, children, conversation, pathname, selectedChat }: ConsoleProps & {
  pathname: string;
  selectedChat?: string | null;
}) {
  const inCampaignWorkspace = pathname.startsWith("/campaigns/") || pathname.startsWith("/workspace/");
  const active = inCampaignWorkspace ? destinations[0] : destinations.find(({ href }) =>
    pathname === href || pathname.startsWith(`${href}/`),
  );

  const main = <main id="main-content" tabIndex={-1} className="workbench-main">{children}</main>;
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
            <Link key={href} href={selectedChat ? { pathname: href, query: { chat: selectedChat } } : href}
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
      {conversation ? (
        <div className="workbench-content">
          {main}
          <aside className="workbench-chat" aria-label="Workspace conversation">{conversation}</aside>
        </div>
      ) : main}
    </div>
  );
}
