"use client";

import { useEffect, useState } from "react";
import type { AgentActivityUpdate } from "@/lib/agent-activity";
import type { ChatMessagePage } from "@/lib/agent-chat";

type Snapshot = ChatMessagePage & { handle: string | null; delegations: { id: string; status: string; task_count: number }[] };

export function useChatSessionActivity(thread: string | undefined, campaign: string | undefined, ready: boolean) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (!thread || !ready) return;
    const query = new URLSearchParams({ thread, ...(campaign ? { campaign } : {}) });
    let disposed = false;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      if (disposed || document.hidden || controller) return;
      clearTimeout(timer);
      controller = new AbortController();
      let delay = 4000;
      try {
        const result = await fetch("/api/chat/activity?" + query, { signal: controller.signal, cache: "no-store" });
        if (result.status === 401) { disposed = true; setUnavailable(true); return; }
        if (!result.ok) throw new Error("Session activity unavailable");
        const value = await result.json() as Snapshot;
        if (disposed) return;
        setUnavailable(false);
        setSnapshot((previous) => JSON.stringify(previous) === JSON.stringify(value) ? previous : value);
        if (value.handle || value.delegations.length) delay = 1500;
      } catch {
        if (!disposed) setUnavailable(true);
      } finally {
        controller = undefined;
        if (!disposed) timer = setTimeout(() => void check(), delay);
      }
    }
    const refresh = () => void check();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [thread, campaign, ready]);
  return { snapshot, unavailable };
}

type Child = Extract<AgentActivityUpdate, { phase: "delegation" }>["child"];
type Updates = { handle: string; updates: AgentActivityUpdate[]; children: Child[] };

export function useChatRunEvents(handle: string | null | undefined) {
  const [feed, setFeed] = useState<Updates>();
  useEffect(() => {
    if (!handle) return;
    const run = handle;
    let lastSequence = -1;
    const stream = new EventSource("/api/chat/activity?" + new URLSearchParams({ run }));
    stream.onmessage = ({ data }) => {
      const event = JSON.parse(data) as AgentActivityUpdate;
      // On reconnect the server rebuilds cumulative text from retained Hermes events.
      // Discard seen sequence numbers here, not upstream of the text reducer.
      if (event.seq !== undefined) {
        if (event.seq <= lastSequence) return;
        lastSequence = event.seq;
      }
      setFeed((previous) => {
        const current = previous?.handle === run ? previous : { handle: run, updates: [], children: [] };
        if (event.phase === "delegation") {
          const same = current.children.find(({ id }) => id === event.child.id);
          const child = { ...same, ...event.child };
          return { ...current, children: [...current.children.filter(({ id }) => id !== child.id), child].slice(-40) };
        }
        const last = current.updates.at(-1);
        if (last?.phase === event.phase && last.message === event.message) return current;
        const earlier = last?.phase === "writing" ? current.updates.slice(0, -1) : current.updates;
        return { ...current, updates: [...earlier.slice(-19), event] };
      });
    };
    return () => stream.close();
  }, [handle]);
  return feed;
}
