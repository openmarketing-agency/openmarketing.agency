/** Collects the shared provider, model, API key, and optional Composio MCP server before the account opens its agent workspace. */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { logoutAction } from "@/app/actions/auth";
import { Brand } from "@/components/brand";
import { StandaloneModelSettings } from "@/components/standalone-model-settings";
import { requireUser } from "@/lib/dal";
import { needsAgentSetup } from "@/lib/server/agent-setup";
import { loadAgentWorkspace } from "@/lib/server/agent-workspace";
import { isProjectSetupComplete, readProjectSetup } from "@/lib/server/project-setup";
import "@/app/onboarding/onboarding.css";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Set up your agents" };

async function AgentSetup() {
  const user = await requireUser();
  if (!needsAgentSetup(user.id)) {
    redirect(isProjectSetupComplete(readProjectSetup(user.id)) ? "/dashboard" : "/onboarding");
  }
  const { records, error } = await loadAgentWorkspace();
  if (!records?.standaloneModels) {
    return <p className="form-error" role="alert">{error ?? "Both agents must be available. Check that oma-agent is running and reload this page."}</p>;
  }
  return <StandaloneModelSettings setup models={records.standaloneModels} />;
}

export default function AgentSetupPage() {
  return (
    <div className="workspace-entry">
      <header className="workspace-entry-bar">
        <Brand href="/dashboard" />
        <form action={logoutAction}><Button type="submit" variant="ghost">Sign out</Button></form>
      </header>
      <main id="main-content" tabIndex={-1} className="project-setup-layout">
        <header className="project-setup-heading">
          <h1>Set up your agents</h1>
          <p>Configure the provider, model, and shared reasoning effort for your agents, and optionally connect Composio tools, before starting project setup.</p>
        </header>
        <div className="project-setup-panel">
          <Suspense fallback={<p className="project-setup-loading" role="status">Loading agent settings…</p>}>
            <AgentSetup />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
