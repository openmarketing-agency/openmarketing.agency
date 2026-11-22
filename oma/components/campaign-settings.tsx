/** Edits the campaign model and submits the settings for agent sync. */

"use client";

import { useActionState, useRef, useState } from "react";
import { saveCampaignSettingsAction } from "@/app/actions/workspace";
import type { CampaignConfiguration, CampaignModelDefaults } from "@/lib/server/agent-workspace";

export function CampaignSettings({
  campaignId, configuration, modelDefaults,
}: {
  campaignId: string;
  configuration: CampaignConfiguration;
  modelDefaults: CampaignModelDefaults;
}) {
  const hasModel = Boolean(configuration.provider || configuration.modelId || configuration.baseUrl || configuration.hasModelKey);
  const initialModel = hasModel ? configuration : modelDefaults;
  const [provider, setProvider] = useState(initialModel.provider);
  const [modelId, setModelId] = useState(initialModel.modelId);
  const [baseUrl, setBaseUrl] = useState(initialModel.baseUrl);
  const [environmentKey, setEnvironmentKey] = useState(!hasModel || Boolean(configuration.usesEnvironmentKey));
  const modelKey = useRef<HTMLInputElement>(null);
  const [result, action, pending] = useActionState(saveCampaignSettingsAction.bind(null, campaignId), {});
  const saved = result.configuration ?? configuration;
  const modelMatches = provider.trim() === saved.provider
    && modelId === saved.modelId && baseUrl === saved.baseUrl;
  const hasDefaults = Boolean(modelDefaults.modelId || modelDefaults.baseUrl || modelDefaults.provider);
  const canUseEnvironmentKey = modelDefaults.hasApiKey && baseUrl === modelDefaults.baseUrl
    && provider.trim() === modelDefaults.provider;

  function useModelDefaults() {
    setProvider(modelDefaults.provider);
    setModelId(modelDefaults.modelId);
    setBaseUrl(modelDefaults.baseUrl);
    setEnvironmentKey(true);
    if (modelKey.current) modelKey.current.value = "";
  }

  return (
    <section className="campaign-settings" aria-label="Campaign settings">
      <form action={action} className="workspace-editor">
        <input type="hidden" name="revision" value={saved.revision} />
        <fieldset disabled={pending}>
          <legend>Model</legend>
          <div className="campaign-settings-intro">
            <p>{hasDefaults ? <>Settings start from <code>.env</code>. Edit the fields to override the model for this campaign.</>
              : "Leave the model fields blank to use the agent’s default model."}</p>
            {hasDefaults && <button type="button" className="btn secondary" onClick={useModelDefaults}>Use .env defaults</button>}
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
          {canUseEnvironmentKey && (
            <label className="campaign-env-key">
              <input type="checkbox" name="useEnvironmentKey" value="true" checked={environmentKey}
                onChange={(event) => {
                  setEnvironmentKey(event.target.checked);
                  if (event.target.checked && modelKey.current) modelKey.current.value = "";
                }} />
              Sync the provider API key from .env
            </label>
          )}
          <label>Model API key
            <input name="modelKey" type="password" ref={modelKey} autoComplete="new-password" maxLength={4096}
              aria-describedby="model-api-key-hint"
              onChange={(event) => { if (event.target.value) setEnvironmentKey(false); }} />
          </label>
          <p id="model-api-key-hint">
            {canUseEnvironmentKey && environmentKey ? "Enter a key to override the .env key for this campaign."
              : saved.hasModelKey ? "Leave blank to keep the existing key reference."
              : "Enter a key if your provider requires one."}
          </p>
        </fieldset>
        {result.error && <p className="form-error" role="alert">{result.error}</p>}
        {result.synced && modelMatches && <p className="workspace-save-status" role="status">Settings saved and synced to oma-agent.</p>}
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? "Saving and syncing…" : "Save and sync"}
        </button>
      </form>
    </section>
  );
}
