"use client";
import { Suspense, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  Cable,
  LogOut,
  Menu,
  MessageSquare,
  X,
} from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { Brand } from "@/components/brand";
type ConsoleProps = {
  email?: string;
  demo?: boolean;
  children: ReactNode;
};

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

function ConsoleFrame({
  email,
  demo = false,
  children,
  pathname,
}: ConsoleProps & { pathname: string }) {
  const [open, setOpen] = useState(false);
  const home = demo ? "/demo" : "/dashboard";
  const nav = [
    { href: home, label: "Playbooks", icon: BookOpen },
    {
      href: demo ? "/demo/connections" : "/connections",
      label: "Connections",
      icon: Cable,
    },
    ...(!demo ? [{ href: "/chat", label: "Chat", icon: MessageSquare }] : []),
  ];
  return (
    <div className="console-frame">
      <header className="mobile-header">
        <Brand href={home} />
        <button
          className="icon-button"
          onClick={() => setOpen(!open)}
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
          aria-controls="console-navigation"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>
      <aside
        className={`sidebar ${open ? "is-open" : ""}`}
        id="console-navigation"
        aria-label="Main navigation"
      >
        <div className="sidebar-brand">
          <Brand href={home} />
        </div>
        <nav className="sidebar-navigation" aria-label="Workspace">
          <div className="nav-label">Workspace</div>
          {nav.map(({ href, label: name, icon: Icon }) => {
            const active = pathname === href || (href === home && pathname.startsWith("/playbooks/"));
            return (
              <Link key={href} href={href} onClick={() => setOpen(false)}
                className={`nav-link${active ? " active" : ""}`}
                aria-current={pathname === href ? "page" : undefined}>
                <Icon size={18} aria-hidden="true" /> {name}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <Image className="sidebar-mascot" src="/orca-mascot.webp" alt="" width={480} height={480} unoptimized />
          {email && <div className="account">
            <span className="avatar">{email.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong title={email}>{demo ? "Demo workspace" : email}</strong>
            </div>
            {demo ? (
              <Link
                href="/login"
                className="icon-button"
                aria-label="Go to sign in"
              >
                <LogOut size={16} />
              </Link>
            ) : (
              <form action={logoutAction}>
                <button className="icon-button" aria-label="Sign out">
                  <LogOut size={16} />
                </button>
              </form>
            )}
          </div>}
        </div>
      </aside>
      <div className="console-body">
        <header className="console-topbar">
          <div>
            Workspace <ChevronRight size={13} aria-hidden="true" />
            <span>
              {pathname.includes("playbooks/")
                ? "Playbook details"
                : nav.find(({ href }) => href === pathname)?.label ?? "Playbooks"}
            </span>
          </div>
        </header>
        <main id="main-content" className="console-sheet">
          {demo && (
            <div className="demo-banner">
              Demo mode · Connections are simulated.{" "}
              <Link href="/register">
                Create your workspace <ArrowUpRight size={12} />
              </Link>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
