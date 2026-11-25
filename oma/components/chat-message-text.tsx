"use client";

import { useId, useState } from "react";

const previewChars = 600;
const previewLines = 8;

export function ChatMessageText({ text }: { text: string }) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  // Bound the preview by both length and line count, including short multiline lists.
  const head = text.slice(0, previewChars + 1);
  const preview = head.split("\n", previewLines).join("\n").slice(0, previewChars);
  if (preview === text) return <p>{text}</p>;
  return <>
    <p id={id}>{expanded ? text : preview.replace(/[\uD800-\uDBFF]$/, "").trimEnd() + "…"}</p>
    <button type="button" className="runtime-message-toggle" aria-expanded={expanded} aria-controls={id}
      onClick={() => setExpanded(!expanded)}>{expanded ? "Show less" : "Show more"}</button>
  </>;
}
