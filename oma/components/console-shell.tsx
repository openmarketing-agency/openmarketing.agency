/** Provides persistent workspace navigation and a responsive conversation panel. */

"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronRight, ClipboardCheck, ListTodo, LogOut, Menu, MessageSquare, Megaphone, PanelLeft, Plug, Settings } from "lucide-react";

import { logoutAction } from "@/app/actions/auth";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import "./console-shell.css";

const destinations = [
  { href: "/dashboard", label: "Campaigns", icon: Megaphone },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
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
  return <ConsoleFrame {...props} pathname={pathname} selectedChat={pathname.startsWith("/campaigns/") ? null : chat} chatLinked={Boolean(chat)} />;
}

function SignOut() {
  return (
    <form action={logoutAction}>
      <Button type="submit" variant="ghost" size="icon" aria-label="Sign out" title="Sign out">
        <LogOut aria-hidden="true" />
      </Button>
    </form>
  );
}

function ConsoleFrame({ email, children, conversation, pathname, selectedChat, chatLinked }: ConsoleProps & {
  pathname: string;
  selectedChat?: string | null;
  chatLinked?: boolean;
}) {
  const [navigationPath, setNavigationPath] = useState<string>();
  const [mobilePane, setMobilePane] = useState<{ pathname: string; chat: boolean }>();
  const hasConversation = Boolean(conversation) && pathname !== "/tasks";
  const chatOpen = hasConversation && (mobilePane?.pathname === pathname ? mobilePane.chat : Boolean(chatLinked));
  const inCampaignWorkspace = pathname.startsWith("/campaigns/") || pathname.startsWith("/workspace/");
  const active = inCampaignWorkspace ? destinations[0] : destinations.find(({ href }) =>
    pathname === href || pathname.startsWith(`${href}/`),
  );

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1001px)");
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setNavigationPath(undefined);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  function navigation(close?: (destination: string) => void) {
    return (
      <>
        <div className="workbench-brand"><Brand onNavigate={close && (() => close("/dashboard"))} /></div>
        <nav className="workbench-links" aria-label="Workspace">
          <span>Workspace</span>
          {destinations.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={selectedChat ? { pathname: href, query: { chat: selectedChat } } : href}
              onNavigate={close && (() => close(href))}
              aria-current={href === active?.href ? (pathname === href ? "page" : "location") : undefined}>
              <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        {email && <div className="workbench-account">
          <span className="avatar" aria-hidden="true">{email[0].toUpperCase()}</span>
          <strong title={email}>{email}</strong>
          <SignOut />
        </div>}
      </>
    );
  }

  return (
    <div className="workbench" data-chat-open={chatOpen}>
      <aside className="workbench-nav" aria-label="Console navigation">{navigation()}</aside>
      <div className="workbench-stage">
        <header className="workbench-bar">
          <div className="workbench-location">
            <Sheet open={navigationPath === pathname} onOpenChange={(open) => setNavigationPath(open ? pathname : undefined)}>
              <SheetTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="workbench-menu" aria-label="Open navigation">
                  <Menu aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="workbench-drawer">
                <SheetTitle className="sr-only">Console navigation</SheetTitle>
                <SheetDescription className="sr-only">Choose a workspace page.</SheetDescription>
                {navigation((destination) => {
                  setMobilePane({ pathname: destination, chat: false });
                  setNavigationPath(undefined);
                })}
              </SheetContent>
            </Sheet>
            <span className="workbench-location-group">Workspace</span>
            {active && <>
              <ChevronRight size={15} className="workbench-divider" aria-hidden="true" />
              <span className="workbench-location-page">{active.label}</span>
            </>}
          </div>
          {hasConversation && (
            <Button type="button" variant={chatOpen ? "default" : "outline"} className="workbench-chat-toggle"
              aria-controls="workspace-conversation" aria-expanded={chatOpen} onClick={() => setMobilePane({ pathname, chat: !chatOpen })}>
              {chatOpen ? <PanelLeft aria-hidden="true" /> : <MessageSquare aria-hidden="true" />}
              {chatOpen ? "Back to workspace" : "Open chat"}
            </Button>
          )}
        </header>
        <main id="main-content" tabIndex={-1} className={hasConversation ? "workbench-content" : "workbench-single"}>
          <div className="workbench-main">{children}</div>
          {hasConversation && <aside id="workspace-conversation" className="workbench-chat" aria-label="Workspace conversation">{conversation}</aside>}
        </main>
      </div>
    </div>
  );
}
