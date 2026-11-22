/** Introduces the static project setup flow and keeps it accessible only to signed-in users. */

import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { logoutAction } from "@/app/actions/auth";
import { skipProjectSetup } from "@/app/actions/project-setup";
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
    <main id="main-content" tabIndex={-1} className="project-setup-main">
      <div className="project-setup-content">
        <h1>Set up your project</h1>
        <p className="project-setup-intro">Give oma-agent a website or GitHub repository to start with. You can add both.</p>
        <ProjectForm initialLinks={links} needsRetry={Boolean(project?.delivery)} />
        <form action={skipProjectSetup} className="project-setup-skip">
          <button type="submit">Skip for now</button>
        </form>
      </div>
      <aside className="project-setup-story" aria-labelledby="project-setup-story-title">
        <div className="project-setup-art" aria-hidden="true">
          <Image src="/orca-mascot.webp" alt="" width={480} height={480} unoptimized />
        </div>
        <div className="project-setup-story-copy">
          <h2 id="project-setup-story-title">Open-source<br className="project-setup-story-break" /> marketing.</h2>
          <p>Your project details are stored in your own OMA installation.</p>
          <a href="https://github.com/openmarketing-agency/openmarketing.agency" target="_blank" rel="noreferrer">
            View source on GitHub <ArrowUpRight size={16} aria-hidden="true" />
          </a>
        </div>
      </aside>
    </main>
  );
}

export default function OnboardingPage() {
  return (
    <div className="project-setup-page">
      <header className="project-setup-header">
        <Brand />
        <form action={logoutAction}>
          <button type="submit" className="project-setup-signout">Sign out</button>
        </form>
      </header>
      <Suspense fallback={<main id="main-content" className="project-setup-loading" role="status">Loading setup…</main>}>
        <Setup />
      </Suspense>
    </div>
  );
}
