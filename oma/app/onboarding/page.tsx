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

  return <ProjectForm initialLinks={links} needsRetry={Boolean(project?.delivery)} />;
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
      <main id="main-content" tabIndex={-1} className="project-setup-layout">
        <header className="project-setup-heading">
          <h1>Add your project</h1>
          <p>Enter a website, a GitHub repository, or both to give oma-agent context for your campaigns.</p>
        </header>
        <section className="project-setup-panel" aria-labelledby="project-links-title">
          <h2 id="project-links-title">Project links</h2>
          <Suspense fallback={<p className="project-setup-loading" role="status">Loading setup…</p>}>
            <Setup />
          </Suspense>
        </section>
        <aside className="project-setup-help" aria-labelledby="project-setup-help-title">
          <h2 id="project-setup-help-title">What happens next</h2>
          <p>OMA saves your links locally before sending them to oma-agent. If delivery fails, retry with the saved links.</p>
          <p>To go straight to Campaigns, choose Skip setup.</p>
        </aside>
      </main>
    </div>
  );
}
