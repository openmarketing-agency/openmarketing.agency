"use client";

import { useActionState, useState } from "react";
import { saveStandaloneModelAction } from "@/app/actions/workspace";
import type { StandaloneModels } from "@/lib/server/agent-workspace";

export function StandaloneModelSettings({ models }: { models: StandaloneModels }) {
  const [result, action, pending] = useActionState(saveStandaloneModelAction, {});
  const current = result.models ?? models;
  const [selection, setSelection] = useState(models.default || models.maintenance);
  const split = current.default !== current.maintenance;
  return (
    <section aria-labelledby="standalone-model-heading">
      <h2 id="standalone-model-heading">Default and maintenance agents</h2>
      {split && <p>Current models: Default — {current.default || "not set"}; Maintenance — {current.maintenance || "not set"}.</p>}
      <form action={action} className="standalone-model-form">
        <input type="hidden" name="revision" value={current.revision} />
        <label htmlFor="standalone-model">Shared model ID</label>
        <input id="standalone-model" name="modelId" value={selection} onChange={(event) => setSelection(event.target.value)}
          maxLength={200} placeholder="openai/gpt-4.1-mini" required disabled={pending} spellCheck={false} />
        <button type="submit" className="btn secondary" disabled={pending || !selection.trim()}>
          {pending ? "Syncing…" : "Save and sync"}
        </button>
        {result.error && <p className="form-error" role="alert">{result.error}</p>}
        {result.models && !pending && <p role="status">Model synced to both agents.</p>}
      </form>
    </section>
  );
}
