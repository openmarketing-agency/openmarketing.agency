/** Edits the campaign model and submits the settings for agent sync. */

"use client";

import { useActionState, useRef, useState } from "react";
import { deployCampaignAction, saveCampaignSettingsAction } from "@/app/actions/workspace";
import type { CampaignConfiguration } from "@/lib/server/agent-workspace";

export function CampaignSettings({
  campaignId, configuration, deploy = false,
}: {
  campaignId: string;
  configuration: CampaignConfiguration;
  deploy?: boolean;
}) {
  const [provider, setProvider] = useState(configuration.provider);
  const [modelId, setModelId] = useState(configuration.modelId);
  const [baseUrl, setBaseUrl] = useState(configuration.baseUrl);
  const modelKey = useRef<HTMLInputElement>(null);
  const [result, action, pending] = useActionState((deploy ? deployCampaignAction : saveCampaignSettingsAction).bind(null, campaignId), {});
  const saved = result.configuration ?? configuration;
  const modelMatches = provider.trim() === saved.provider
    && modelId === saved.modelId && baseUrl === saved.baseUrl;
  function useDefaultModel() {
    setProvider("");
    setModelId("");
    setBaseUrl("");
    if (modelKey.current) modelKey.current.value = "";
  }

  return (
    <section className="campaign-settings" aria-label={deploy ? "Deployment settings" : "Campaign settings"}>
      <form action={action} className="workspace-editor">
        <input type="hidden" name="revision" value={saved.revision} />
        <fieldset disabled={pending}>
          <legend>Model override (optional)</legend>
          <div className="campaign-settings-intro">
            <p>Leave the model fields blank to use the default agent’s model.</p>
            {(provider || modelId || baseUrl) && (
              <button type="button" className="btn secondary" onClick={useDefaultModel}>Use default agent model</button>
            )}
          </div>
          <div className="campaign-model-fields">
            <label>Provider
              <input name="provider" value={provider} onChange={(event) => setProvider(event.target.value)}
                placeholder="custom" maxLength={80} spellCheck={false} />
            </label>
            <label>Model ID
              <input name="modelId" value={modelId} onChange={(event) => setModelId(event.target.value)}
                placeholder="model-id" maxLength={200} spellCheck={false} />
            </label>
          </div>
          <label>Base URL
            <input name="baseUrl" type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://provider.example.com/v1" maxLength={2048} />
          </label>
          <label>Model API key
            <input name="modelKey" type="password" ref={modelKey} autoComplete="new-password" maxLength={4096}
              aria-describedby="model-api-key-hint" />
          </label>
          <p id="model-api-key-hint">
            {saved.hasModelKey ? "Leave blank to keep the saved key for this override."
              : "Enter a key if your model override requires one."}
          </p>
        </fieldset>
        {result.error && <p className="form-error" role="alert">{result.error}</p>}
        {(result.state === "resumed" || (result.synced && modelMatches)) &&
          <p className="workspace-save-status" role="status">{deploy ? "Campaign deployed and started." : "Settings saved and synced to oma-agent."}</p>}
        <button className="btn primary" type="submit" disabled={pending}>
          {deploy ? (pending ? "Syncing, deploying, and starting…" : "Deploy and start") : (pending ? "Saving and syncing…" : "Save and sync")}
        </button>
      </form>
    </section>
  );
}
