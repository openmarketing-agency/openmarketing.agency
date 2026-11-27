/** Collects the shared model, its credential, and the default agent’s required Composio MCP server, then reports whether both built-in agents synced. */

"use client";

import { useActionState, useState, type ReactNode } from "react";
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

// Shown as the base URL placeholder for providers with a well-known endpoint.
const baseUrlExamples: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  "openai-api": "https://api.openai.com/v1",
};

/** One labelled control. A hint renders as `${id}-hint`, which the control references. */
function Field({ id, label, hint, wide = false, children }: {
  id: string; label: string; hint?: string; wide?: boolean; children: ReactNode;
}) {
  return (
    <div className="standalone-model-field" data-wide={wide || undefined}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <p className="standalone-model-hint" id={id + "-hint"}>{hint}</p>}
    </div>
  );
}

export function StandaloneModelSettings({ models, setup = false }: { models: StandaloneModels; setup?: boolean }) {
  const [result, action, pending] = useActionState(saveStandaloneModelAction.bind(null, setup), {});
  const current = result.models ?? models;
  const [provider, setProvider] = useState(models.default.provider || models.maintenance.provider);
  const [modelId, setModelId] = useState(models.default.modelId || models.maintenance.modelId);
  const [baseUrl, setBaseUrl] = useState(models.default.baseUrl || models.maintenance.baseUrl);
  const [reasoningEffort, setReasoningEffort] = useState<string>(models.default.reasoningEffort);
  const [composioUrl, setComposioUrl] = useState(models.composioUrl);
  // A saved key stays in the profile; ask again only for a new or changed URL.
  const composioKeyRequired = !(current.hasComposioKey && composioUrl.trim() === current.composioUrl);
  return (
    <section aria-labelledby={setup ? undefined : "standalone-model-heading"} aria-label={setup ? "Agent settings" : undefined}>
      {/* In setup the page heading already names this form, and its sections are titled. */}
      {!setup && <h2 id="standalone-model-heading">Default and maintenance agents</h2>}
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
        <fieldset className="standalone-model-section" disabled={pending}>
          <legend>Model</legend>
          <p className="standalone-model-intro">Both agents use this provider, model, and key.</p>
          <div className="standalone-model-grid">
            <Field id="standalone-provider" label="Provider">
              <Input id="standalone-provider" name="provider" list="standalone-providers" value={provider}
                onChange={(event) => {
                  const next = event.target.value;
                  if (next !== models.default.provider) setBaseUrl("");
                  setProvider(next);
                }} maxLength={80} placeholder="openrouter" required spellCheck={false} />
              <datalist id="standalone-providers">
                {providers.filter(([id]) => !setup || id !== "openai-codex")
                  .map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </datalist>
            </Field>
            <Field id="standalone-model" label="Model ID">
              <Input id="standalone-model" name="modelId" value={modelId} onChange={(event) => setModelId(event.target.value)}
                maxLength={200} placeholder="openai/gpt-4.1-mini" required spellCheck={false} />
            </Field>
            <Field id="standalone-base-url" label="Provider base URL" wide>
              <Input id="standalone-base-url" name="baseUrl" type="url" value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)} placeholder={baseUrlExamples[provider] ?? "https://provider.example.com/v1"}
                maxLength={2048} required />
            </Field>
            <Field id="standalone-model-key" label="Provider API key"
              hint={setup ? undefined : "Leave blank to keep the saved key."}>
              <Input id="standalone-model-key" name="modelKey" type="password" autoComplete="new-password"
                maxLength={4096} required={setup} aria-describedby={setup ? undefined : "standalone-model-key-hint"} />
            </Field>
            <Field id="standalone-reasoning" label="Reasoning effort">
              <NativeSelect id="standalone-reasoning" name="reasoningEffort"
                value={reasoningEffort} onChange={(event) => setReasoningEffort(event.target.value)}>
                {reasoningOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </NativeSelect>
            </Field>
          </div>
        </fieldset>
        <fieldset className="standalone-model-section" disabled={pending}>
          <legend>Composio tools</legend>
          <p className="standalone-model-intro">
            Connect your apps in your Composio dashboard, then paste its MCP URL and API key. Only the default agent uses them.
          </p>
          <div className="standalone-model-grid">
            <Field id="composio-url" label="MCP URL" wide>
              <Input id="composio-url" name="composioUrl" type="url" value={composioUrl}
                onChange={(event) => setComposioUrl(event.target.value)} placeholder="https://connect.composio.dev/mcp"
                maxLength={2048} spellCheck={false} required />
            </Field>
            <Field id="composio-key" label="API key" wide
              hint={current.hasComposioKey ? "A key is saved. Leave blank to keep it." : "Add your Composio consumer API key."}>
              <Input id="composio-key" name="composioKey" type="password" autoComplete="new-password"
                maxLength={4096} required={composioKeyRequired} aria-describedby="composio-key-hint" />
            </Field>
          </div>
        </fieldset>
        <div className="standalone-model-footer">
          <Button type="submit" disabled={pending}>
            {pending ? "Syncing both agents…" : setup ? "Sync and continue" : "Save and sync"}
          </Button>
          {result.error && <p className="form-error" role="alert">{result.error}</p>}
          {result.models && !result.error && !pending && <p role="status">Settings synced to both agents.</p>}
        </div>
      </form>
    </section>
  );
}
