"use client";

/** Shows an agent-designed OpenUI page for a saved document, with the standard Markdown view as the fallback. */

import { Renderer } from "@openuidev/react-lang";
import { useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { documentLibrary } from "@/lib/document-library";
import type { DocumentTarget } from "@/lib/document-target";
import { relativeTime } from "@/lib/relative-time";
import type { DocumentLayout } from "@/lib/server/document-layout";

type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "retry"; message: string }
  | { type: "saved"; layout: DocumentLayout }
  | { type: "error"; message: string };

/** Read the newline-delimited events the design route streams back. */
async function readEvents(response: Response, onEvent: (event: StreamEvent) => void) {
  if (!response.body) throw new Error("Couldn’t design this page. Try again.");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += value;
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as StreamEvent);
  }
  if (buffered.trim()) onEvent(JSON.parse(buffered) as StreamEvent);
}

export function DesignedDocument({ target, layout: savedLayout, generating, children }: {
  target: DocumentTarget;
  layout?: DocumentLayout;
  generating?: boolean;
  children: ReactNode;
}) {
  const [designedNow, setDesignedNow] = useState<DocumentLayout>();
  const [live, setLive] = useState<string>();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [view, setView] = useState<"designed" | "standard">("designed");
  const [failed, setFailed] = useState(false);
  const running = useRef(false);
  const layout = designedNow ?? savedLayout;
  const streaming = live !== undefined;
  const busy = streaming || generating;

  async function design() {
    if (running.current) return;
    running.current = true;
    setLive("");
    setNote("");
    setError("");
    setFailed(false);
    setView("designed");
    try {
      const response = await fetch("/api/workspace/layouts", {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(target),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error ?? "Couldn’t design this page. Try again.");
      }
      await readEvents(response, (event) => {
        if (event.type === "delta") setLive((text) => (text ?? "") + event.text);
        else if (event.type === "retry") {
          setLive("");
          setNote("The first draft didn’t pass checks, so the agent is fixing it.");
        } else if (event.type === "saved") {
          setDesignedNow(event.layout);
        } else setError(event.message);
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t design this page. Try again.");
    } finally {
      running.current = false;
      setLive(undefined);
      setNote("");
    }
  }

  const designed = layout && view === "designed" && !failed;

  return (
    <div className="designed-document">
      <div className="designed-document-bar">
        {layout && !streaming && <div className="designed-document-toggle" role="group" aria-label="Page view">
          <button type="button" aria-pressed={view === "designed"} onClick={() => setView("designed")}>Designed</button>
          <button type="button" aria-pressed={view === "standard"} onClick={() => setView("standard")}>Standard</button>
        </div>}
        <p role="status">
          {streaming ? note || (live ? "Designing… the page fills in as the agent writes it." : "Starting the design…")
            : generating ? "This page is being designed in another tab."
            : layout ? `Designed with OpenUI ${relativeTime(new Date(layout.generatedAt))}`
            : "Let the default agent lay out this page with OpenUI components."}
        </p>
        <Button type="button" variant="outline" disabled={busy} onClick={design}>{busy ? "Designing…" : layout ? "Redesign" : "Design page"}</Button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {failed && view === "designed" && !streaming && <p className="designed-document-note">The designed page couldn’t be displayed, so the standard view is shown.</p>}
      {streaming
        ? <div className="openui-document" aria-busy="true">
          {live ? <Renderer response={live} library={documentLibrary} isStreaming /> : <p className="designed-document-note">Waiting for the agent’s first lines…</p>}
        </div>
        : designed
          ? <div className="openui-document">
            <Renderer response={layout.source} library={documentLibrary} isStreaming={false}
              onError={(errors) => setFailed(errors.some(({ severity }) => severity !== "warning"))} />
          </div>
          : children}
      {layout && !streaming && <DocumentGenerationDetails layout={layout} />}
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
