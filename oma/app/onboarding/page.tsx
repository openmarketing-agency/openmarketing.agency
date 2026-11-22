/** Introduces the static project setup flow and keeps it accessible only to signed-in users. */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { logoutAction } from "@/app/actions/auth";
import { Brand } from "@/components/brand";
import { requireUser } from "@/lib/dal";
import { isProjectSetupComplete, readProjectSetup } from "@/lib/server/project-setup";

import { ProjectForm } from "./project-form";
import "./onboarding.css";

export const metadata: Metadata = { title: "Set up your project" };

async function Setup() {
  const user = await requireUser();
  const project = readProjectSetup(user.id);
  if (isProjectSetupComplete(project)) redirect("/dashboard");
  const links = project?.setup.status === "done"
    ? { websiteUrl: project.setup.websiteUrl, githubUrl: project.setup.githubUrl } : undefined;

  return (
    <main id="main-content" tabIndex={-1} className="workspace-entry-panel">
      <header>
        <h1>Add your project</h1>
        <p>Give oma-agent a website, a GitHub repository, or both to start planning.</p>
      </header>
      <ProjectForm initialLinks={links} needsRetry={Boolean(project?.delivery)} />
    </main>
  );
}

export default function OnboardingPage() {
  return (
    <div className="workspace-entry">
      <header className="workspace-entry-bar">
        <Brand href="/dashboard" />
        <form action={logoutAction}>
          <button type="submit" className="btn ghost">Sign out</button>
        </form>
      </header>
      <Suspense fallback={<main id="main-content" className="workspace-entry-panel" role="status">Loading setup…</main>}>
        <Setup />
      </Suspense>
    </div>
  );
}
