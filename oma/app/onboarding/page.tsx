/** Shows the signed-in owner's setup conversation in the cloud onboarding layout. */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { logoutAction } from "@/app/actions/auth";
import { skipSetup } from "@/app/actions/onboarding";
import { Brand } from "@/components/brand";
import { requireUser } from "@/lib/dal";
import { readOnboarding } from "@/lib/server/onboarding";

import { OnboardingChat } from "./onboarding-chat";
import "./onboarding.css";

export const metadata: Metadata = { title: "Set up your workspace" };

async function Setup() {
  const user = await requireUser();
  const initial = readOnboarding(user.id);
  if (initial.step.status === "closed") redirect("/dashboard");

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
        <OnboardingChat initial={initial} />
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
