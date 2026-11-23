/** Hosts the signed-in workspace’s shared settings for its two built-in agents. */

import type { Metadata } from "next";
import { Suspense } from "react";

import { StandaloneModelSettings } from "@/components/standalone-model-settings";
import { Loading } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { loadAgentWorkspace } from "@/lib/server/agent-workspace";

import "./settings.css";

export const metadata: Metadata = { title: "Settings" };

async function AgentSettings() {
  await requireUser();
  const { records, error } = await loadAgentWorkspace();
  if (!records?.standaloneModels) {
    return <p className="notice" role={error ? "alert" : "status"}>
      {error ?? "Start the full Open Marketing Agency stack to configure the default and maintenance agents."}
    </p>;
  }
  return <StandaloneModelSettings models={records.standaloneModels} />;
}

export default function SettingsPage() {
  return (
    <div className="workspace-settings">
      <header>
        <h1>Settings</h1>
        <p>Choose the provider and model shared by your default and maintenance agents.</p>
      </header>
      <div className="workspace-settings-panel">
        <Suspense fallback={<Loading label="Loading agent settings…" />}>
          <AgentSettings />
        </Suspense>
      </div>
    </div>
  );
}
