import Link from "next/link";
import { Suspense } from "react";

import { SessionNav } from "@/components/session-nav";

/**
 * The header is part of the static shell, so the session read lives inside its own
 * boundary and streams in instead of blocking every page.
 */
export function SiteHeader() {
  return (
    <header className="border-b border-black/10 dark:border-white/15">
      <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-6 py-4">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          OMA
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/dashboard" className="opacity-70 transition hover:opacity-100">
            Dashboard
          </Link>
          <Link href="/users" className="opacity-70 transition hover:opacity-100">
            Users
          </Link>
          <Suspense fallback={<span className="opacity-40">…</span>}>
            <SessionNav />
          </Suspense>
        </nav>
      </div>
    </header>
  );
}
