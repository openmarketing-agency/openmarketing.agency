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
  function useDefaultModel() {
    setProvider("");
    setModelId("");
    setBaseUrl("");
    if (modelKey.current) modelKey.current.value = "";
  }

  return (
    <details className="campaign-edit-disclosure campaign-model-editor">
      <summary>Model override <span>Optional</span></summary>
      <form action={action} className="workspace-editor">
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
      </form>
    </details>
  );
}
