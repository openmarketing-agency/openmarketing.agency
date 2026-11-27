/** Collects the shared model, its credential, and the default agent’s Composio MCP server, then reports whether both built-in agents synced. */

"use client";

import { useActionState, useState } from "react";
import { saveStandaloneModelAction } from "@/app/actions/workspace";
import type { StandaloneModels } from "@/lib/server/agent-workspace";

import "./standalone-model-settings.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

const providers = [
  ["openrouter", "OpenRouter"],
  ["openai-api", "OpenAI API"],
  ["openai-codex", "OpenAI Codex"],
  ["anthropic", "Anthropic"],
  ["gemini", "Google Gemini"],
  ["custom", "Custom OpenAI-compatible provider"],
];

const reasoningOptions = [
  ["", "Provider default"],
  ["none", "None"],
  ["minimal", "Minimal"],
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["xhigh", "Extra high"],
  ["max", "Max"],
  ["ultra", "Ultra"],
] as const;

export function StandaloneModelSettings({ models, setup = false }: { models: StandaloneModels; setup?: boolean }) {
  const [result, action, pending] = useActionState(saveStandaloneModelAction.bind(null, setup), {});
  const current = result.models ?? models;
  const [provider, setProvider] = useState(models.default.provider || models.maintenance.provider);
  const [modelId, setModelId] = useState(models.default.modelId || models.maintenance.modelId);
  const [baseUrl, setBaseUrl] = useState(models.default.baseUrl || models.maintenance.baseUrl);
  const [reasoningEffort, setReasoningEffort] = useState<string>(models.default.reasoningEffort);
  const [composioUrl, setComposioUrl] = useState(models.composioUrl);
  // A saved key stays in the profile; ask again only for a new or changed URL.
  const composioKeyRequired = Boolean(composioUrl.trim())
    && !(current.hasComposioKey && composioUrl.trim() === current.composioUrl);
  return (
    <section aria-labelledby="standalone-model-heading">
      <h2 id="standalone-model-heading">{setup ? "Provider, model, and API key" : "Default and maintenance agents"}</h2>
      {!setup && (
        <dl className="standalone-model-summary" aria-label="Current agent models">
          {(["default", "maintenance"] as const).map((agent) => (
            <div key={agent}>
              <dt>{agent === "default" ? "Default" : "Maintenance"}</dt>
              <dd>{current[agent].provider && <>{current[agent].provider} · </>}
                {current[agent].modelId || "No model selected"}</dd>
            </div>
          ))}
          <div>
            <dt>Composio</dt>
            <dd>{current.composioUrl || "Not set up"}</dd>
          </div>
        </dl>
      )}
      <form action={action} className="standalone-model-form">
        <input type="hidden" name="revision" value={current.revision} />
        <label htmlFor="standalone-provider">Provider</label>
        <Input id="standalone-provider" name="provider" list="standalone-providers" value={provider}
          onChange={(event) => {
            const next = event.target.value;
            if (next !== models.default.provider) setBaseUrl("");
            setProvider(next);
          }} maxLength={80} placeholder="e.g. openrouter" required disabled={pending} spellCheck={false} />
        <datalist id="standalone-providers">
          {providers.filter(([id]) => !setup || id !== "openai-codex")
            .map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </datalist>
        <label htmlFor="standalone-model">Model ID</label>
        <Input id="standalone-model" name="modelId" value={modelId} onChange={(event) => setModelId(event.target.value)}
          maxLength={200} placeholder="e.g. openai/gpt-4.1-mini" required disabled={pending} spellCheck={false} />
        <label htmlFor="standalone-base-url">Provider base URL</label>
        <Input id="standalone-base-url" name="baseUrl" type="url" value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://provider.example.com/v1"
          maxLength={2048} required disabled={pending} />
        <label htmlFor="standalone-model-key">Provider API key</label>
        <Input id="standalone-model-key" name="modelKey" type="password" autoComplete="new-password"
          aria-describedby="standalone-key-hint" maxLength={4096} required={setup} disabled={pending} />
        <p className="standalone-model-hint" id="standalone-key-hint">
          {setup ? "Both agents use this key." : "Enter a key to update both agents’ credentials. Leave blank when keeping the same provider."}
        </p>
        <label htmlFor="standalone-reasoning">Reasoning effort for both agents</label>
        <NativeSelect id="standalone-reasoning" name="reasoningEffort"
          value={reasoningEffort} onChange={(event) => setReasoningEffort(event.target.value)} disabled={pending}>
          {reasoningOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </NativeSelect>
        <fieldset className="standalone-model-composio" disabled={pending}>
          <legend>Composio tools (optional)</legend>
          <p className="standalone-model-hint" id="composio-hint">
            Paste the MCP URL and API key from your Composio dashboard, and connect your apps there.
            Only the default agent uses this server.
          </p>
          <label htmlFor="composio-url">Composio MCP URL</label>
          <Input id="composio-url" name="composioUrl" type="url" value={composioUrl}
            onChange={(event) => setComposioUrl(event.target.value)} placeholder="https://connect.composio.dev/mcp"
            maxLength={2048} aria-describedby="composio-hint" spellCheck={false} />
          <label htmlFor="composio-key">Composio API key</label>
          <Input id="composio-key" name="composioKey" type="password" autoComplete="new-password"
            aria-describedby="composio-key-hint" maxLength={4096} required={composioKeyRequired} />
          <p className="standalone-model-hint" id="composio-key-hint">
            {current.hasComposioKey
              ? "A key is saved. Leave blank to keep it, or clear the URL to remove Composio."
              : "Required with the MCP URL. Use a project key (ak_) or a consumer key (ck_)."}
          </p>
        </fieldset>
        {result.error && <p className="form-error" role="alert">{result.error}</p>}
        {result.models && !result.error && !pending && <p role="status">Settings synced to both agents.</p>}
        <Button type="submit" disabled={pending}>
          {pending ? "Syncing both agents…" : setup ? "Sync and continue" : "Save and sync"}
        </Button>
      </form>
    </section>
  );
}
