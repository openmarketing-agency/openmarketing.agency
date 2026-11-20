/** Shows the optional workspace setup to the signed-in account. */

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
    <>
      <header className="onboarding-header">
        <div className="onboarding-header-inner">
          <Brand href="/dashboard" />
          <form action={logoutAction}><button className="onboarding-text-button">Sign out</button></form>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="onboarding-main">
        <header className="onboarding-heading">
          <div>
            <h1>Set up your workspace</h1>
            <p>Tell oma-agent what you’re working on and get a campaign to start with.</p>
          </div>
          <form action={skipSetup}>
            <button className="onboarding-text-button">Skip setup</button>
          </form>
        </header>
        <OnboardingChat initial={initial} />
      </main>
    </>
  );
}

export default function OnboardingPage() {
  return <Suspense fallback={<main id="main-content" className="onboarding-main" role="status">Loading setup…</main>}><Setup /></Suspense>;
}
