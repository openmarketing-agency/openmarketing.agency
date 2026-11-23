/** Projects the gateway’s public assistant events into brief, redacted dashboard updates. */

import type { AgentActivityUpdate } from "@/lib/agent-activity";

const previewLength = 480;
const frameLimit = 64 * 1024;
const redaction = "[redacted]";

function redact(value: string, key: string) {
  return value.replaceAll(key, redaction);
}

function excerpt(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > previewLength ? text.slice(0, previewLength).trimEnd() + "…" : text;
}

export function previewAgentMessage(value: string, key: string) {
  return excerpt(redact(value, key));
}

function eventData(line: string): Record<string, unknown> | undefined {
  if (!line.startsWith("data:") || line.length > frameLimit) return;
  try {
    const parsed: unknown = JSON.parse(line.slice(5));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // A malformed SSE frame should not hide subsequent public messages.
  }
}

export function projectActivityEvents(source: ReadableStream<Uint8Array>, key: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let pending = "";
  let reply = "";
  let previous = "";
  const replyLimit = previewLength + Math.max(key.length * 2, 1);

  return source.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      if (pending.length > frameLimit) throw new Error("Run event exceeded its size limit.");
      for (const line of lines) {
        const event = eventData(line);
        let update: AgentActivityUpdate;
        if (event?.event === "message.interim" && typeof event.text === "string") {
          const message = previewAgentMessage(event.text, key);
          if (!message) continue;
          reply = "";
          update = { phase: "update", message };
        } else if (event?.event === "message.delta" && typeof event.delta === "string") {
          reply = (reply + event.delta).slice(0, replyLimit);
          const safe = redact(reply, key);
          // Hold enough trailing text to catch the gateway key even when it spans multiple deltas.
          const stable = key.length > 1 ? safe.slice(0, -(key.length - 1)) : safe;
          const message = excerpt(stable);
          update = { phase: "writing", ...(message ? { message } : {}) };
        } else if (event?.event === "run.completed" && typeof event.output === "string") {
          const message = previewAgentMessage(event.output, key);
          if (!message) continue;
          update = { phase: "update", message };
        } else {
          continue;
        }
        const data = JSON.stringify(update);
        if (data !== previous) {
          previous = data;
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        }
      }
    },
  }));
}
