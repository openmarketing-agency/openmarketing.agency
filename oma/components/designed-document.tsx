"use client";

/** Shows an agent-designed OpenUI page for a saved document, with the standard Markdown view as the fallback. */

import { Renderer } from "@openuidev/react-lang";
import { useActionState, useState, type ReactNode } from "react";

import { designDocumentAction, type DocumentTarget } from "@/app/actions/document-layout";
import { Button } from "@/components/ui/button";
import { documentLibrary } from "@/lib/document-library";
import { relativeTime } from "@/lib/relative-time";
import type { DocumentLayout } from "@/lib/server/document-layout";

export function DesignedDocument({ target, layout, generating, children }: {
  target: DocumentTarget;
  layout?: DocumentLayout;
  generating?: boolean;
  children: ReactNode;
}) {
  const [result, design, pending] = useActionState(designDocumentAction.bind(null, target), {});
  const [view, setView] = useState<"designed" | "standard">("designed");
  const [failed, setFailed] = useState(false);
  const busy = pending || generating;
  const designed = layout && view === "designed" && !failed;

  return (
    <div className="designed-document">
      <div className="designed-document-bar">
        {layout && <div className="designed-document-toggle" role="group" aria-label="Page view">
          <button type="button" aria-pressed={view === "designed"} onClick={() => setView("designed")}>Designed</button>
          <button type="button" aria-pressed={view === "standard"} onClick={() => setView("standard")}>Standard</button>
        </div>}
        <p role="status">
          {busy ? "Designing this page. This can take up to a minute."
            : layout ? `Designed with OpenUI ${relativeTime(new Date(layout.generatedAt))}`
            : "Let the default agent lay out this page with OpenUI components."}
        </p>
        <form action={design}>
          <Button type="submit" variant="outline" disabled={busy}>{busy ? "Designing…" : layout ? "Redesign" : "Design page"}</Button>
        </form>
      </div>
      {result.error && <p className="form-error" role="alert">{result.error}</p>}
      {failed && view === "designed" && <p className="designed-document-note">The designed page couldn’t be displayed, so the standard view is shown.</p>}
      {designed
        ? <div className="openui-document">
          <Renderer response={layout.source} library={documentLibrary} isStreaming={false}
            onError={(errors) => setFailed(errors.some(({ severity }) => severity !== "warning"))} />
        </div>
        : children}
      {layout && <DocumentGenerationDetails layout={layout} />}
    </div>
  );
}

/** Shows the saved prompts and OpenUI source behind a designed page, as the analytics dashboard does. */
function DocumentGenerationDetails({ layout }: { layout: DocumentLayout }) {
  return (
    <details className="document-generation">
      <summary>Generation details</summary>
      <div className="document-generation-body">
        <p>oma-agent’s default profile designs the page once from the saved Markdown. The console saves the OpenUI source and shows it until the document changes or you redesign.</p>
        {layout.generation ? <>
          <GenerationText label="System prompt" text={layout.generation.systemPrompt} />
          <GenerationText label="User message" text={layout.generation.userMessage}>The user message is unavailable for this oma-agent version.</GenerationText>
        </> : <p>Prompts were unavailable when this page was designed. Redesign to capture them.</p>}
        <GenerationText label="Agent-generated OpenUI source" text={layout.source} />
      </div>
    </details>
  );
}

function GenerationText({ label, text, children }: { label: string; text?: string; children?: string }) {
  return (
    <details>
      <summary>{label}</summary>
      {text ? <pre tabIndex={0} role="region" aria-label={label}><code>{text}</code></pre> : <p>{children}</p>}
    </details>
  );
}
