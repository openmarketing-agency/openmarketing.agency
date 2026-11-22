/** Preserves the original agent-led setup page for signed-in users. */

import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { logoutAction } from "@/app/actions/auth";
import { skipSetup } from "./actions";
import { Brand } from "@/components/brand";
import { requireUser } from "@/lib/dal";
import { isOnboardingDocumentRequest } from "@/lib/onboarding";
import { readOnboarding } from "@/lib/server/onboarding";

import { OnboardingChat } from "./onboarding-chat";
import "./onboarding.css";

export const metadata: Metadata = { title: "Agent onboarding backup" };

async function Setup() {
  const user = await requireUser();
  const initial = readOnboarding(user.id);
  const development = process.env.NODE_ENV === "development";
  if (initial.step.status === "closed" && !development) redirect("/dashboard");
  const resetOnOpen = development && isOnboardingDocumentRequest(await headers());
  // Next can preserve the previous chat's client state when reopening the route.
  const chatKey = development ? randomUUID() : undefined;

  return (
    <div className="onboarding-page">
      <header className="onboarding-header">
        <div className="onboarding-header-inner">
          <Brand href="/dashboard" />
          <div className="onboarding-header-actions">
            <form action={skipSetup}><button className="onboarding-sign-out">Skip setup</button></form>
            <form action={logoutAction}><button className="onboarding-sign-out">Sign out</button></form>
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="onboarding-main">
        <div className="onboarding-shell">
          <OnboardingChat key={chatKey} initial={initial} resetOnOpen={resetOnOpen} />
        </div>
      </main>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={
      <main id="main-content" className="onboarding-page">
        <p className="onboarding-loading-page" role="status">Loading your setup…</p>
      </main>
    }>
      <Setup />
    </Suspense>
  );
}
