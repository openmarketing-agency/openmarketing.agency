/** Displays Hermes-native history and keeps in-progress run handles in the current browser tab. */

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { Bot, Plus, RefreshCw, Send } from "lucide-react";

import { answerChatPrompt, readChatTurn, readOlderChatMessages, sendChatMessage, syncCompletedCampaignChat } from "@/app/actions/chat";
import { maxChatMessageLength, type ActiveAgentRun, type AgentStatus, type ChatHistory, type ChatMessage } from "@/lib/agent-chat";
import type { CampaignChanges } from "@/lib/server/agent-workspace";
import { AgentActivity } from "./agent-activity";
import { ChatProgress } from "./chat-progress";
import { HermesPrompt } from "./hermes-prompt";
import "./hermes-chat.css";

function runKey(threadId: string, campaignId?: string) {
  return "oma:run:" + (campaignId ?? "workspace") + ":" + threadId;
}

function runInTab(key: string | undefined) {
  try {
    return key ? window.sessionStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function readCampaignSnapshot(key: string): unknown {
  try {
    return JSON.parse(window.sessionStorage.getItem(key + ":changes") ?? "null");
  } catch {
    return undefined;
  }
}

function rememberRun(key: string, handle: string | null, changes?: CampaignChanges) {
  try {
    if (handle) window.sessionStorage.setItem(key, handle);
    else window.sessionStorage.removeItem(key);
    if (changes) window.sessionStorage.setItem(key + ":changes", JSON.stringify(changes));
    else window.sessionStorage.removeItem(key + ":changes");
  } catch {
    // The conversation remains in Hermes even when browser storage is unavailable.
  }
}

const subscribeToTab = (notify: () => void) => {
  window.addEventListener("storage", notify);
  return () => window.removeEventListener("storage", notify);
};

export function HermesChat({
  status, history, campaignId,
}: {
  status: AgentStatus;
  history: ChatHistory;
  campaignId?: string;
}) {
  const router = useRouter();
  const headingId = useId();
  const [navigating, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null | undefined>(undefined);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<{ id: string; text: string }>();
  const [currentHandle, setCurrentHandle] = useState<string | null>();
  const [run, setRun] = useState<ActiveAgentRun>();
  const [error, setError] = useState("");
  const [syncStatus, setSyncStatus] = useState("");
  const campaignSnapshot = useRef<CampaignChanges | undefined>(undefined);
  const transcript = useRef<HTMLDivElement>(null);
  const scrollDistanceFromEnd = useRef<number | undefined>(undefined);
  const thread = useRef(history.active?.id);
  const storageKey = history.active ? runKey(history.active.id, campaignId) : undefined;
  const storedHandle = useSyncExternalStore(subscribeToTab, () => runInTab(storageKey), () => null);
  const handle = currentHandle === undefined ? storedHandle : currentHandle;
  const prompt = run?.prompt;
  const canSend = status.ready && !handle && !pending && !sending && !navigating;
  const offset = nextOffset === undefined ? history.active?.nextOffset : nextOffset;
  const recent = history.active?.messages;
  const recentIds = new Set(recent?.map(({ id }) => id));
  const messages = [...older.filter(({ id }) => !recentIds.has(id)), ...(recent ?? [])];

  useEffect(() => {
    const log = transcript.current;
    if (log) {
      log.scrollTop = log.scrollHeight - (scrollDistanceFromEnd.current ?? 0);
      scrollDistanceFromEnd.current = undefined;
    }
  }, [older, recent, pending, prompt]);

  useEffect(() => {
    if (!handle || !status.ready) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout>;
    async function poll(run: string) {
      try {
        const result = await readChatTurn(run);
        if (cancelled) return;
        if (!result.ok && ![401, 403, 404].includes(result.status)) {
          setError(result.message);
          retry = setTimeout(() => void poll(run), 3000);
          return;
        }
        if (result.ok && result.data.status === "running") {
          setError("");
          const next = result.data;
          setRun((current) => {
            const previous = current?.prompt;
            const samePrompt = previous?.id === next.prompt?.id && previous?.generation === next.prompt?.generation;
            if (current?.phase === next.phase && current.tool === next.tool && current.updatedAt === next.updatedAt && samePrompt) return current;
            return samePrompt && previous ? { ...next, prompt: previous } : next;
          });
          retry = setTimeout(() => void poll(run), 1500);
          return;
        }
        const key = thread.current ? runKey(thread.current, campaignId) : undefined;
        const before = campaignSnapshot.current ?? (key ? readCampaignSnapshot(key) : undefined);
        let syncError: string | undefined;
        setRun(undefined);
        if (campaignId && before && result.ok && result.data.status === "completed") {
          setSyncStatus("Checking for campaign changes…");
          try {
            const change = await syncCompletedCampaignChat(campaignId, run, before);
            syncError = change?.error;
            if (!cancelled) setSyncStatus(change?.synced ? "Campaign changes synced." : change?.staged ? "Campaign changes saved for first start." : "");
          } catch {
            syncError = "Couldn’t confirm the campaign sync. Open Agents to retry.";
            if (!cancelled) setSyncStatus("");
          }
        }
        if (key) rememberRun(key, null);
        if (cancelled) return;
        campaignSnapshot.current = undefined;
        setCurrentHandle(null);
        setPending(undefined);
        setError(syncError ?? (result.ok ? (result.data.status === "failed" ? "oma-agent couldn’t finish this turn." : "") : result.message));
        router.refresh();
      } catch {
        if (cancelled) return;
        setError("Reconnecting to oma-agent…");
        retry = setTimeout(() => void poll(run), 3000);
      }
    }
    void poll(handle);
    return () => { cancelled = true; clearTimeout(retry); };
  }, [campaignId, handle, router, status.ready]);

  function openChat(id: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("chat", id);
    startTransition(() => router.push(url.pathname + url.search + url.hash, { scroll: false }));
  }

  async function send(text: string, retry = false) {
    if (!text || !status.ready || sending || navigating || (retry ? !pending || !!handle : !canSend)) return;
    thread.current ??= crypto.randomUUID();
    const threadId = thread.current;
    if (!history.active) {
      const url = new URL(window.location.href);
      url.searchParams.set("chat", threadId);
      window.history.replaceState(null, "", url);
    }
    const turn = retry && pending ? pending : { id: crypto.randomUUID(), text };
    setPending(turn);
    setMessage("");
    setSending(true);
    setError("");
    setSyncStatus("");
    try {
      const result = await sendChatMessage(threadId, turn.id, turn.text, campaignId);
      if (!result.ok) {
        setError(result.message);
        if ([401, 403, 404, 409, 422].includes(result.status)) {
          setPending(undefined);
          setMessage(turn.text);
        }
        return;
      }
      campaignSnapshot.current = result.data.changes;
      rememberRun(runKey(threadId, campaignId), result.data.handle, result.data.changes);
      setCurrentHandle(result.data.handle);
    } catch {
      setError("The connection was interrupted. Your message is ready to retry.");
    } finally {
      setSending(false);
    }
  }

  async function loadOlder() {
    if (!history.active || offset == null || loadingOlder) return;
    setLoadingOlder(true);
    setError("");
    try {
      const result = await readOlderChatMessages(history.active.id, offset, campaignId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const log = transcript.current;
      if (log) scrollDistanceFromEnd.current = log.scrollHeight - log.scrollTop;
      setOlder((previous) => {
        const seen = new Set(previous.map(({ id }) => id));
        return [...result.data.messages.filter(({ id }) => !seen.has(id)), ...previous];
      });
      setNextOffset(result.data.nextOffset);
    } catch {
      setError("Couldn’t load older messages. Try again.");
    } finally {
      setLoadingOlder(false);
    }
  }

  const selectionListed = history.chats.some(({ id }) => id === history.active?.id);
  return (
    <section className="runtime-chat" aria-labelledby={headingId} aria-busy={navigating || undefined}>
      <header className="chat-page-heading">
        <div className="surface-heading">
          <span className="playbook-mark"><Bot size={24} aria-hidden="true" /></span>
          <div>
            <h2 id={headingId}>{campaignId ? "Campaign chat" : "Workspace chat"}</h2>
            <p>Default profile</p>
          </div>
        </div>
        <span role="status" className={status.ready ? "chat-status is-ready" : "chat-status"}>{status.ready ? "Connected" : "Offline"}</span>
      </header>
      <div className="runtime-chat-history">
        <select aria-label="Chat history" value={selectionListed ? history.active?.id : ""}
          disabled={navigating || sending || !history.chats.length} onChange={(event) => openChat(event.target.value)}>
          {!selectionListed && <option value="" disabled>{history.chats.length ? "New conversation" : "No saved chats"}</option>}
          {history.chats.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        <button type="button" className="btn secondary" disabled={navigating || sending || !(history.active || pending)}
          onClick={() => openChat("new")}><Plus size={15} aria-hidden="true" /> New chat</button>
      </div>
      <div className="runtime-messages" ref={transcript} role="log" aria-label="Conversation">
        <AgentActivity />
        {offset != null && <button type="button" className="btn secondary runtime-load-older" disabled={loadingOlder}
          onClick={() => void loadOlder()}>{loadingOlder ? "Loading…" : "Load older messages"}</button>}
        {!messages.length && !pending && !handle && !history.error && (
          <div className="runtime-conversation-empty">
            <h3>{campaignId ? "What would you like to do with this campaign?" : "What would you like to work on?"}</h3>
          </div>
        )}
        {messages.map(({ id, role, text }) => (
          <div key={id} className={role === "user" ? "runtime-message from-user" : "runtime-message"}>
            <strong>{role === "user" ? "You" : "oma-agent"}</strong><p>{text}</p>
          </div>
        ))}
        {pending && <div className="runtime-message from-user"><strong>You</strong><p>{pending.text}</p></div>}
      </div>
      {syncStatus ? <div className="runtime-progress">
        <p className="runtime-progress-state" role="status">{syncStatus}</p>
      </div> : status.ready && (sending || handle) &&
        <ChatProgress run={run} sending={sending} reconnecting={!!handle && !!error} />}
      {(error || history.error) && <p className="form-error chat-error" role="alert">{error || history.error}</p>}
      {!status.ready ? (
        <div className="runtime-composer runtime-chat-offline">
          <p>{status.message}</p>
          <button className="btn secondary" disabled={navigating} onClick={() => startTransition(() => router.refresh())}>
            <RefreshCw size={16} aria-hidden="true" /> {navigating ? "Checking…" : "Check connection"}
          </button>
        </div>
      ) : pending && !handle ? (
        <div className="runtime-composer runtime-chat-offline">
          <button type="button" className="btn primary" disabled={sending || navigating}
            onClick={() => void send(pending.text, true)}>{sending ? "Sending…" : "Retry message"}</button>
        </div>
      ) : prompt && handle ? <HermesPrompt key={prompt.id + ":" + prompt.generation} prompt={prompt} onAnswer={async (answer) => {
        const { id, generation, kind } = prompt;
        const result = await answerChatPrompt(handle, { id, generation, kind, answer });
        return result.ok ? undefined : result.message;
      }} /> : <form className="runtime-form runtime-composer" onSubmit={(event) => { event.preventDefault(); void send(message.trim()); }}>
        <label className="sr-only" htmlFor={headingId + "-message"}>Message oma-agent</label>
        <textarea id={headingId + "-message"} value={message} onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send(message.trim());
            }
          }}
          placeholder="Message oma-agent…" maxLength={maxChatMessageLength} rows={3} required disabled={!canSend} />
        <button className="btn primary" disabled={!canSend || !message.trim()}>
          <Send size={16} aria-hidden="true" /> {campaignId ? "Send" : "Send message"}
        </button>
      </form>}
    </section>
  );
}
