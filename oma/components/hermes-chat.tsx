/** Displays Hermes-native history, live replies, and session-scoped notifications. */

"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { Bot, Plus, RefreshCw, Send } from "lucide-react";

import { answerChatPrompt, readChatTurn, readOlderChatMessages, sendChatMessage, steerChatMessage, syncCompletedCampaignChat } from "@/app/actions/chat";
import { maxChatMessageLength, type ActiveAgentRun, type AgentStatus, type ChatHistory, type ChatMessage } from "@/lib/agent-chat";
import type { CampaignChanges } from "@/lib/server/agent-workspace";
import { AgentActivity } from "./agent-activity";
import { ChatMessageText } from "./chat-message-text";
import { ChatProgress } from "./chat-progress";
import { useChatRunEvents, useChatSessionActivity } from "./chat-session-activity";
import { HermesPrompt } from "./hermes-prompt";
import "./hermes-chat.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

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

function draftInTab(key: string | undefined) {
  try {
    return key ? window.sessionStorage.getItem(key + ":draft") ?? "" : "";
  } catch {
    return "";
  }
}

function handOffDraft(key: string, draft: string) {
  try {
    if (draft) window.sessionStorage.setItem(key + ":draft", draft);
    else window.sessionStorage.removeItem(key + ":draft");
  } catch {
    // Only unsent text is handed off when the first turn attaches to saved history.
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
  const [draft, setDraft] = useState<string>();
  const latestDraft = useRef<string | undefined>(undefined);
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null | undefined>(undefined);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [steering, setSteering] = useState(false);
  const [guidanceError, setGuidanceError] = useState("");
  const [guidance, setGuidance] = useState<Array<{ id: string; handle: string; text: string }>>([]);
  const steeringRequest = useRef(false);
  const recoveredSteer = useRef<string | undefined>(undefined);
  const [pending, setPending] = useState<{ id: string; text: string }>();
  const [currentHandle, setCurrentHandle] = useState<string | null>();
  const [run, setRun] = useState<ActiveAgentRun>();
  const [error, setError] = useState("");
  const [syncStatus, setSyncStatus] = useState("");
  const campaignSnapshot = useRef<CampaignChanges | undefined>(undefined);
  const transcript = useRef<HTMLDivElement>(null);
  const scrollDistanceFromEnd = useRef<number | undefined>(undefined);
  const thread = useRef(history.active?.id);
  const [threadId, setThreadId] = useState(history.active?.id);
  const [finishedHandle, setFinishedHandle] = useState<string>();
  const { snapshot, unavailable } = useChatSessionActivity(threadId, campaignId, status.ready);
  const storageKey = history.active ? runKey(history.active.id, campaignId) : undefined;
  const storedHandle = useSyncExternalStore(subscribeToTab, () => runInTab(storageKey), () => null);
  const handedOffDraft = useSyncExternalStore(subscribeToTab, () => draftInTab(storageKey), () => "");
  const message = draft ?? handedOffDraft;
  const setMessage = useCallback((update: string | ((current: string) => string)) => {
    const key = thread.current ? runKey(thread.current, campaignId) : undefined;
    const current = latestDraft.current ?? draftInTab(key);
    const next = typeof update === "string" ? update : update(current);
    latestDraft.current = next;
    setDraft(next);
    if (key && next !== current) handOffDraft(key, "");
  }, [campaignId]);
  const candidate = currentHandle ?? (snapshot ? snapshot.handle : history.active?.handle)
    ?? (currentHandle === undefined ? storedHandle : null);
  const handle = candidate !== finishedHandle ? candidate : null;
  const feed = useChatRunEvents(handle);
  const live = handle && feed?.handle === handle ? feed : undefined;
  const backgroundCount = snapshot?.delegations.reduce((count, item) => count + item.task_count, 0) ?? 0;
  const prompt = run?.prompt;
  const canSend = status.ready && !navigating && !sending && !steering && (Boolean(handle) || !pending);
  const offset = nextOffset === undefined ? (snapshot ? snapshot.nextOffset : history.active?.nextOffset) : nextOffset;
  const recent = snapshot?.messages ?? history.active?.messages;
  const recordedTools = snapshot ? snapshot.recordedTools : history.active?.recordedTools;
  const showRunProgress = status.ready && Boolean(sending || handle);
  const recentIds = new Set(recent?.map(({ id }) => id));
  const messages = [...older.filter(({ id }) => !recentIds.has(id)), ...(recent ?? [])];

  useEffect(() => {
    const log = transcript.current;
    if (log) {
      log.scrollTop = log.scrollHeight - (scrollDistanceFromEnd.current ?? 0);
      scrollDistanceFromEnd.current = undefined;
    }
  }, [older, recent, pending, prompt, guidance, live]);

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
        setFinishedHandle(run);
        setCurrentHandle(null);
        setPending(undefined);
        const pendingSteer = result.ok && result.data.status !== "running" ? result.data.pendingSteer : undefined;
        if (pendingSteer) {
          const suffix = campaignId ? "\n\nCampaign ID: " + campaignId : "";
          const text = suffix && pendingSteer.endsWith(suffix) ? pendingSteer.slice(0, -suffix.length) : pendingSteer;
          if (text.trim()) {
            recoveredSteer.current = run;
            setMessage((draft) => !draft.trim() || draft.trim() === text ? text : text + "\n\n" + draft);
            setGuidanceError("The turn finished before using your guidance. You can send it as a follow-up.");
          }
        }
        setError(syncError ?? (result.ok ? (result.data.status === "failed" ? "oma-agent couldn’t finish this turn." : "") : result.message));
        // Attaching the first turn to saved history remounts the composer under the native thread ID.
        if (key && key !== storageKey) handOffDraft(key, latestDraft.current ?? "");
        router.refresh();
      } catch {
        if (cancelled) return;
        setError("Reconnecting to oma-agent…");
        retry = setTimeout(() => void poll(run), 3000);
      }
    }
    void poll(handle);
    return () => { cancelled = true; clearTimeout(retry); };
  }, [campaignId, handle, router, setMessage, status.ready, storageKey]);

  function openChat(id: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("chat", id);
    startTransition(() => router.push(url.pathname + url.search + url.hash, { scroll: false }));
  }

  async function sendGuidance(activeHandle: string, text: string) {
    if (steeringRequest.current) return;
    steeringRequest.current = true;
    setSteering(true);
    setGuidanceError("");
    try {
      const result = await steerChatMessage(activeHandle, text, campaignId);
      if (!result.ok) {
        setGuidanceError(result.message);
        return;
      }
      const id = crypto.randomUUID();
      setGuidance((messages) => [...messages, { id, handle: activeHandle, text }]);
      if (recoveredSteer.current !== activeHandle) {
        // Keep any new draft the user typed while this request was in flight.
        setMessage((draft) => draft.trim() === text ? "" : draft);
      }
    } catch {
      setGuidanceError("Couldn’t confirm that oma-agent received your guidance.");
    } finally {
      steeringRequest.current = false;
      setSteering(false);
    }
  }

  async function send(text: string, retry = false) {
    if (!text || !status.ready || sending || steeringRequest.current || navigating || (retry ? !pending || !!handle : !canSend)) return;
    if (handle) {
      await sendGuidance(handle, text);
      return;
    }
    thread.current ??= crypto.randomUUID();
    const threadId = thread.current;
    setThreadId(threadId);
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
    setGuidanceError("");
    setGuidance([]);
    setSyncStatus("");
    try {
      const result = await sendChatMessage(threadId, turn.id, turn.text, campaignId);
      if (!result.ok) {
        setError(result.message);
        if ([401, 403, 404, 409, 422].includes(result.status)) {
          setPending(undefined);
          setMessage((draft) => draft ? turn.text + "\n\n" + draft : turn.text);
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
        <Badge role="status" variant={status.ready ? "success" : "secondary"}>
          <span className="chat-status-dot" aria-hidden="true" />{status.ready ? "Connected" : "Offline"}
        </Badge>
      </header>
      <div className="runtime-chat-history">
        <NativeSelect aria-label="Chat history" value={selectionListed ? history.active?.id : ""}
          disabled={navigating || sending || !history.chats.length} onChange={(event) => openChat(event.target.value)}>
          {!selectionListed && <option value="" disabled>{history.chats.length ? "New conversation" : "No saved chats"}</option>}
          {history.chats.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </NativeSelect>
        <Button type="button" variant="outline" disabled={navigating || sending || !(history.active || pending)}
          onClick={() => openChat("new")}><Plus size={15} aria-hidden="true" /> New chat</Button>
      </div>
      <AgentActivity showSetup={Boolean(history.active?.isProjectSetup)}>{({ summary, notices }) => <>
        {summary}
        <div className="runtime-messages" ref={transcript} role="log" aria-label="Conversation">
          {notices}
          {offset != null && <Button type="button" variant="outline" className="runtime-load-older" disabled={loadingOlder}
            onClick={() => void loadOlder()}>{loadingOlder ? "Loading…" : "Load older messages"}</Button>}
          {!messages.length && !pending && !handle && !history.error && !history.active?.isProjectSetup && (
            <div className="runtime-conversation-empty">
              <h3>{campaignId ? "What would you like to do with this campaign?" : "What would you like to work on?"}</h3>
            </div>
          )}
          {messages.map(({ id, role, text }) => (
            <div key={id} className={"runtime-message" + (role === "user" ? " from-user" : role === "notification" ? " from-notification" : "")}>
              <strong>{role === "user" ? "You" : role === "notification" ? "Hermes notification" : "oma-agent"}</strong><ChatMessageText text={text} />
            </div>
          ))}
          {pending && messages.findLast(({ role }) => role === "user")?.text !== pending.text &&
            <div className="runtime-message from-user"><strong>You</strong><ChatMessageText text={pending.text} /></div>}
          {guidance.filter((item) => item.handle === handle).map(({ id, text }) => (
            <div key={id} className="runtime-message from-user"><strong>You</strong><ChatMessageText text={text} /></div>
          ))}
          {live?.updates.map(({ message, phase, seq }, index) => message && !messages.some(({ text }) => text === message) &&
            <div key={phase === "writing" ? "writing" : seq ?? index} className="runtime-message"><strong>oma-agent</strong><ChatMessageText text={message} /></div>)}
          {live?.children.map(({ id, status, label }) => <div key={id} className="runtime-message from-notification">
            <strong>Subagent {status}</strong>{label && <p>{label}</p>}
          </div>)}
        </div>
      </>}</AgentActivity>
      {syncStatus ? <div className="runtime-progress">
        <p className="runtime-progress-state" role="status">{syncStatus}</p>
      </div> : (showRunProgress || (history.active?.isProjectSetup && Boolean(recordedTools?.length))) &&
        <ChatProgress active={showRunProgress} run={run} sending={sending} reconnecting={!!handle && !!error}
          tools={live?.tools} reasoning={live?.reasoning} recordedTools={recordedTools} />}
      {backgroundCount > 0 && <p className="runtime-progress" role="status">
        {backgroundCount} background {backgroundCount === 1 ? "task" : "tasks"} running.
        {!handle && " This chat will resume when the results arrive."}
      </p>}
      {unavailable && !error && <p className="runtime-progress" role="status">Couldn’t refresh session activity.</p>}
      {(error || history.error) && <p className="form-error chat-error" role="alert">{error || history.error}</p>}
      {guidanceError && <p className="form-error chat-error" role="status">{guidanceError}</p>}
      {!status.ready ? (
        <div className="runtime-composer runtime-chat-offline">
          <p>{status.message}</p>
          <Button variant="outline" disabled={navigating} onClick={() => startTransition(() => router.refresh())}>
            <RefreshCw size={16} aria-hidden="true" /> {navigating ? "Checking…" : "Check connection"}
          </Button>
        </div>
      ) : <>
        {pending && !handle && !sending && <div className="runtime-composer runtime-chat-offline">
          <Button type="button" disabled={navigating}
            onClick={() => void send(pending.text, true)}>Retry message</Button>
        </div>}
        {prompt && handle && <HermesPrompt key={prompt.id + ":" + prompt.generation} prompt={prompt} onAnswer={async (answer) => {
          const { id, generation, kind } = prompt;
          const result = await answerChatPrompt(handle, { id, generation, kind, answer });
          return result.ok ? undefined : result.message;
        }} />}
        <form className="runtime-form runtime-composer" onSubmit={(event) => { event.preventDefault(); void send(message.trim()); }}>
          <label className="sr-only" htmlFor={headingId + "-message"}>Message oma-agent</label>
          <Textarea id={headingId + "-message"} value={message} onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send(message.trim());
              }
            }}
            placeholder={handle ? "Steer this turn…" : "Message oma-agent…"}
            maxLength={maxChatMessageLength} rows={3} required disabled={navigating} />
          <Button disabled={!canSend || !message.trim()}>
            <Send size={16} aria-hidden="true" /> {steering ? "Steering…" : handle ? "Steer" : campaignId ? "Send" : "Send message"}
          </Button>
        </form>
      </>}
    </section>
  );
}
