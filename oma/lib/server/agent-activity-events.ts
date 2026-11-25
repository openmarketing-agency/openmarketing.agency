/** Projects the gateway’s public assistant events into brief, redacted dashboard updates. */

import type { AgentActivityUpdate } from "@/lib/agent-activity";

const previewLength = 480;
const frameLimit = 1024 * 1024;
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

export function projectActivityEvents(source: ReadableStream<Uint8Array>, key: string, mode: "preview" | "chat" = "preview"): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let pending = "";
  let reply = "";
  let previous = "";
  const display = mode === "chat" ? (text: string) => text.slice(0, 64 * 1024).trimEnd() : excerpt;
  const replyLimit = (mode === "chat" ? 64 * 1024 : previewLength) + Math.max(key.length * 2, 1);

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
          const message = display(redact(event.text, key));
          if (!message) continue;
          reply = "";
          update = { phase: "update", message };
        } else if (event?.event === "message.delta" && typeof event.delta === "string") {
          reply = (reply + event.delta).slice(0, replyLimit);
          const safe = redact(reply, key);
          // Hold enough trailing text to catch the gateway key even when it spans multiple deltas.
          const stable = key.length > 1 ? safe.slice(0, -(key.length - 1)) : safe;
          const message = display(stable);
          update = { phase: "writing", ...(message ? { message } : {}) };
        } else if (event?.event === "run.completed" && typeof event.output === "string") {
          const message = display(redact(event.output, key));
          if (!message) continue;
          update = { phase: "update", message };
        } else if (mode === "chat" && (event?.event === "tool.started" || event?.event === "tool.completed")) {
          const name = event.tool;
          if (typeof name !== "string" || !/^[\w.-]{1,96}$/.test(name) || name.includes(key)) continue;
          const call = event.tool_call_id;
          const id = typeof call === "string" && /^[\w.-]{1,128}$/.test(call) && !call.includes(key) ? call : undefined;
          const status = event.event === "tool.started" ? "running" : event.error === true ? "failed" : "completed";
          update = { phase: "tool", tool: { ...(id ? { id } : {}), name, status } };
        } else if (mode === "chat" && event?.event === "reasoning.available") {
          // Hermes can send raw provider reasoning here. Signal activity without forwarding its contents.
          update = { phase: "reasoning" };
        } else if (mode === "chat" && (event?.event === "subagent.start" || event?.event === "subagent.complete")) {
          const id = typeof event.subagent_id === "string" ? event.subagent_id : event.child_session_id ?? event.task_index;
          if ((typeof id !== "string" && typeof id !== "number") || !/^[\w.-]{1,128}$/.test(String(id)) || String(id).includes(key)) continue;
          const status = event.event === "subagent.start" ? "started"
            : ["completed", "done", "success"].includes(String(event.status)) ? "completed"
              : ["cancelled", "interrupted", "stopped"].includes(String(event.status)) ? "stopped" : "failed";
          const goal = event.goal ?? event.preview;
          const label = status === "started" && typeof goal === "string" ? previewAgentMessage(goal, key) : undefined;
          update = { phase: "delegation", child: { id: String(id), status, ...(label ? { label } : {}) } };
        } else {
          continue;
        }
        const data = JSON.stringify(update);
        if (data !== previous) {
          previous = data;
          const seq = event?.seq;
          const frame = typeof seq === "number" && Number.isSafeInteger(seq) ? JSON.stringify({ ...update, seq }) : data;
          controller.enqueue(encoder.encode(`data: ${frame}\n\n`));
        }
      }
    },
  }));
}
