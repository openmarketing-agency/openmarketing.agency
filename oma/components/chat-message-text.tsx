"use client";

import { useId, useState } from "react";

import { MarkdownContent } from "./workspace-document";

const previewChars = 600;
const previewLines = 8;

/** Shows a chat message with a bounded preview. Agent replies are Markdown; people's messages stay plain text. */
export function ChatMessageText({ text, markdown = false }: { text: string; markdown?: boolean }) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  // Bound the preview by both length and line count, including short multiline lists.
  const head = text.slice(0, previewChars + 1);
  const preview = head.split("\n", previewLines).join("\n").slice(0, previewChars);
  const truncated = preview !== text;
  const shown = !truncated || expanded ? text : preview.replace(/[\uD800-\uDBFF]$/, "").trimEnd() + "…";
  const body = markdown
    ? <MarkdownContent id={truncated ? id : undefined} className="doc-chat" text={shown} />
    : <p id={truncated ? id : undefined}>{shown}</p>;
  if (!truncated) return body;
  return <>
    {body}
    <button type="button" className="runtime-message-toggle" aria-expanded={expanded} aria-controls={id}
      onClick={() => setExpanded(!expanded)}>{expanded ? "Show less" : "Show more"}</button>
  </>;
}
