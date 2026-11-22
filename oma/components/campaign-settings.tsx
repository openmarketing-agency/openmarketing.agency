/** Edits the model override and hosted Composio connection for a saved campaign. */

"use client";

import { useActionState, useState } from "react";
import { saveCampaignSettingsAction } from "@/app/actions/workspace";
import type { CampaignConfiguration } from "@/lib/server/agent-workspace";

export function CampaignSettings({
  campaignId, configuration, generatedMcpUrl, openMcp,
}: {
  campaignId: string;
  configuration: CampaignConfiguration;
  generatedMcpUrl?: string;
  openMcp: () => void;
}) {
  const [provider, setProvider] = useState(configuration.provider);
  const [modelId, setModelId] = useState(configuration.modelId);
  const [baseUrl, setBaseUrl] = useState(configuration.baseUrl);
  const [composioUrl, setComposioUrl] = useState(configuration.composioUrl);
  const [result, action, pending] = useActionState(saveCampaignSettingsAction.bind(null, campaignId), {});
  const saved = result.configuration ?? configuration;

  return (
    <section className="campaign-settings" aria-labelledby="campaign-settings-title">
      <h2 id="campaign-settings-title">Campaign settings</h2>
      <form action={action} className="workspace-editor">
        <input type="hidden" name="revision" value={saved.revision} />
        <fieldset disabled={pending}>
          <legend>Model</legend>
          <p>Use <code>custom</code> for a LiteLLM proxy. Leave the model fields blank to use the agent’s default.</p>
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
              placeholder="https://proxy.example.com" maxLength={2048} />
          </label>
          <label>Model API key
            <input name="modelKey" type="password" autoComplete="new-password" maxLength={4096}
              aria-describedby="model-api-key-hint" />
          </label>
          <p id="model-api-key-hint">
            {saved.hasModelKey ? "Leave blank to keep the existing key reference. " : "Enter a key if your provider requires one. "}
            Keys entered here are sent to oma-agent. The campaign YAML stores the variable reference.
          </p>
        </fieldset>
        <fieldset disabled={pending}>
          <legend>Composio MCP</legend>
          <label>Hosted MCP URL
            <input name="composioUrl" type="url" value={composioUrl} onChange={(event) => setComposioUrl(event.target.value)}
              placeholder="https://backend.composio.dev/tool_router/…/mcp" maxLength={2048} />
          </label>
          <p>Uses <code>COMPOSIO_API_KEY</code> from the console environment.</p>
          <div className="workspace-editor-actions">
            {generatedMcpUrl ? (
              <button type="button" className="btn secondary" onClick={() => setComposioUrl(generatedMcpUrl)}>Use generated URL</button>
            ) : (
              <button type="button" className="btn secondary" onClick={openMcp}>Open MCP connection</button>
            )}
          </div>
        </fieldset>
        {result.error && <p className="form-error" role="alert">{result.error}</p>}
        {result.synced && <p className="workspace-save-status" role="status">Settings saved and synced to oma-agent.</p>}
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? "Saving and syncing…" : "Save and sync"}
        </button>
      </form>
    </section>
  );
}
