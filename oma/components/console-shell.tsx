/** Provides persistent workspace navigation and orientation across the console. */

"use client";

import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, ChevronRight, ClipboardCheck, LogOut, Megaphone, MessageSquare, Plug } from "lucide-react";

import { logoutAction } from "@/app/actions/auth";
import { Brand } from "@/components/brand";

type ConsoleProps = { email?: string; demo?: boolean; children: ReactNode };

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

function AccountAction({ demo }: { demo: boolean }) {
  return demo ? (
    <Link href="/login" className="icon-button" aria-label="Go to sign in"><LogOut size={17} aria-hidden="true" /></Link>
  ) : (
    <form action={logoutAction}>
      <button className="icon-button" aria-label="Sign out"><LogOut size={17} aria-hidden="true" /></button>
    </form>
  );
}

function ConsoleFrame({ email, demo = false, children, pathname }: ConsoleProps & { pathname: string }) {
  const home = demo ? "/demo" : "/dashboard";
  const campaignDetail = pathname.startsWith(demo ? "/demo/campaigns/" : "/campaigns/");
  const approvalDetail = !demo && pathname.startsWith("/approvals/");
  const record = !demo && pathname.match(/^\/workspace\/(brands|playbooks|agents)\//)?.[1];
  const nav = [
    { href: home, label: "Campaigns", icon: Megaphone, active: pathname === home || campaignDetail || Boolean(record) },
    ...(!demo ? [{ href: "/approvals", label: "Approvals", icon: ClipboardCheck, active: pathname === "/approvals" || approvalDetail }] : []),
    { href: demo ? "/demo/connections" : "/connections", label: "Tools", icon: Plug, active: pathname === (demo ? "/demo/connections" : "/connections") },
    ...(!demo ? [{ href: "/chat", label: "Chat", icon: MessageSquare, active: pathname === "/chat" }] : []),
  ];
  const current = campaignDetail ? "Campaign details"
    : record === "brands" ? "Brand details"
      : record === "playbooks" ? "Playbook details"
        : record === "agents" ? "Agent profile"
          : approvalDetail ? "Review draft" : nav.find(({ active }) => active)?.label ?? "Campaigns";

  return (
    <div className="console-frame">
      <header className="mobile-header">
        <Brand href={home} />
        {email && <AccountAction demo={demo} />}
      </header>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar-brand"><Brand href={home} /></div>
        <nav className="sidebar-navigation" aria-label="Workspace">
          {nav.map(({ href, label, icon: Icon, active }) => (
            <Link key={href} href={href} className={`nav-link${active ? " active" : ""}`}
              aria-current={pathname === href ? "page" : undefined}>
              <Icon size={19} aria-hidden="true" /> <span>{label}</span>
            </Link>
          ))}
        </nav>
        {email && <div className="sidebar-bottom">
          <div className="account">
            <span className="avatar" aria-hidden="true">{email.slice(0, 1).toUpperCase()}</span>
            <div><strong title={email}>{demo ? "Demo workspace" : email}</strong></div>
            <AccountAction demo={demo} />
          </div>
        </div>}
      </aside>
      <div className="console-body">
        <header className="console-topbar">
          <nav aria-label="Breadcrumb">
            <Link href={home}>Workspace</Link><ChevronRight size={14} aria-hidden="true" />
            <span aria-current="page">{current}</span>
          </nav>
        </header>
        <main id="main-content" className="console-sheet">
          {demo && (
            <div className="demo-banner">
              Demo mode · Connections are simulated.
              <Link href="/register">Create your workspace <ArrowUpRight size={12} aria-hidden="true" /></Link>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
