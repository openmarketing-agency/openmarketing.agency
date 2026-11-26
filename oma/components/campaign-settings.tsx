/** Edits the campaign model and submits the settings for agent sync. */

"use client";

import { useActionState, useRef, useState } from "react";
import { deployCampaignAction, saveCampaignSettingsAction } from "@/app/actions/workspace";
import type { CampaignConfiguration } from "@/lib/server/agent-workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CampaignSettings({
  campaignId, configuration, firstStart = false, canStart = true,
}: {
  campaignId: string;
  configuration: CampaignConfiguration;
  firstStart?: boolean;
  canStart?: boolean;
}) {
  const [provider, setProvider] = useState(configuration.provider);
  const [modelId, setModelId] = useState(configuration.modelId);
  const [baseUrl, setBaseUrl] = useState(configuration.baseUrl);
  const modelKey = useRef<HTMLInputElement>(null);
  const [result, action, pending] = useActionState((firstStart ? deployCampaignAction : saveCampaignSettingsAction).bind(null, campaignId), {});
  const saved = configuration;
  const modelMatches = provider.trim() === saved.provider
    && modelId === saved.modelId && baseUrl === saved.baseUrl;
  const override = Boolean(saved.provider || saved.modelId || saved.baseUrl);
  const [editing, setEditing] = useState(false);
  const host = (() => { try { return saved.baseUrl ? new URL(saved.baseUrl).host : ""; } catch { return saved.baseUrl; } })();
  function useDefaultModel() {
    setProvider("");
    setModelId("");
    setBaseUrl("");
    if (modelKey.current) modelKey.current.value = "";
  }

  return (
    <section className="campaign-settings campaign-model-settings" aria-labelledby="campaign-model-heading">
      <header className="campaign-settings-heading">
        <h2 id="campaign-model-heading">Model</h2>
        <p>The language model this campaign’s agents run on.</p>
      </header>
      <div className="campaign-model-summary">
        <div>
          <strong>{override ? saved.modelId || "Custom model" : "Default agent model"}</strong>
          <span>{override
            ? [saved.provider, host, saved.hasModelKey ? "API key saved" : "No API key"].filter(Boolean).join(" · ")
            : "Uses the same model as the default agent. Set an override to run this campaign on a different one."}</span>
        </div>
        <Button type="button" variant="outline" aria-expanded={editing} aria-controls="campaign-model-form"
          onClick={() => setEditing(!editing)}>
          {editing ? "Close" : override ? "Change override" : "Use a different model"}
        </Button>
      </div>
      {editing && <form action={action} className="workspace-editor campaign-model-form" id="campaign-model-form">
        <input type="hidden" name="revision" value={saved.revision} />
        <fieldset disabled={pending}>
          <div className="campaign-settings-intro">
            <p>Leave the model fields blank to use the default agent’s model.</p>
            {(provider || modelId || baseUrl) && (
              <Button type="button" variant="outline" onClick={useDefaultModel}>Use default agent model</Button>
            )}
          </div>
          <div className="campaign-model-fields">
            <label>Provider
              <Input name="provider" value={provider} onChange={(event) => setProvider(event.target.value)}
                placeholder="custom" maxLength={80} spellCheck={false} />
            </label>
            <label>Model ID
              <Input name="modelId" value={modelId} onChange={(event) => setModelId(event.target.value)}
                placeholder="model-id" maxLength={200} spellCheck={false} />
            </label>
          </div>
          <label>Base URL
            <Input name="baseUrl" type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://provider.example.com/v1" maxLength={2048} />
          </label>
          <label>Model API key
            <Input name="modelKey" type="password" ref={modelKey} autoComplete="new-password" maxLength={4096}
              aria-describedby="model-api-key-hint" />
          </label>
          <p id="model-api-key-hint">
            {saved.hasModelKey ? "Leave blank to keep the saved key for this override."
              : "Enter a key if your model override requires one."}
          </p>
        </fieldset>
        {result.error && <p className="form-error" role="alert">{result.error}</p>}
        {(result.state === "resumed" || (result.synced && modelMatches)) &&
          <p className="workspace-save-status" role="status">{firstStart ? "Campaign started." : "Model settings synced."}</p>}
        {firstStart && !canStart && <p>Set up the required tools before starting with an override.</p>}
        <Button type="submit" disabled={pending || (firstStart && !canStart)}>
          {pending ? "Syncing model settings…" : firstStart ? "Save model and start" : "Save model"}
        </Button>
      </form>}
      {!editing && result.error && <p className="form-error" role="alert">{result.error}</p>}
    </section>
  );
}
