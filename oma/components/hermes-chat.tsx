/** Shows the default oma-agent conversation, clarifications, and run progress. */

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Bot, LoaderCircle, RefreshCw, Send } from "lucide-react";

import { answerChatPrompt, readChatTurn, sendChatMessage } from "@/app/actions/chat";
import { maxChatMessageLength, type AgentPrompt, type AgentStatus } from "@/lib/agent-chat";
import { HermesPrompt } from "./hermes-prompt";

export function HermesChat({ status }: { status: AgentStatus }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Array<{ author: string; text: string }>>([]);
  const [sending, setSending] = useState(false);
  const [handle, setHandle] = useState<string>();
  const [prompt, setPrompt] = useState<AgentPrompt>();
  const [error, setError] = useState("");
  const transcript = useRef<HTMLDivElement>(null);
  const session = useRef<string | undefined>(undefined);
  const unsentTurn = useRef<{ message: string; id: string } | undefined>(undefined);

  useEffect(() => {
    const log = transcript.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, sending, prompt]);

  useEffect(() => {
    if (!handle) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout>;
    async function poll(turn: string) {
      try {
        const result = await readChatTurn(turn);
        if (cancelled) return;
        if (result.ok) {
          setError("");
          if (result.data.status === "running") {
            const next = result.data.prompt;
            setPrompt((current) => current?.id === next?.id && current?.generation === next?.generation ? current : next);
            retry = setTimeout(() => void poll(turn), 1500);
            return;
          }
          if (result.data.status === "completed") {
            const { answer } = result.data;
            if (answer) setMessages((previous) => [...previous, { author: "oma-agent", text: answer }]);
          } else {
            setError("oma-agent couldn’t finish this turn. Send a message to continue.");
          }
        } else {
          setError(result.message);
          if (![401, 403, 404].includes(result.status)) {
            retry = setTimeout(() => void poll(turn), 3000);
            return;
          }
        }
        setPrompt(undefined);
        setHandle(undefined);
      } catch {
        if (cancelled) return;
        setError("Reconnecting to oma-agent…");
        retry = setTimeout(() => void poll(turn), 3000);
      }
    }
    void poll(handle);
    return () => { cancelled = true; clearTimeout(retry); };
  }, [handle]);

  async function send(text: string) {
    if (!text || !status.ready || sending || handle) return;
    setMessage(text);
    setSending(true);
    setError("");
    try {
      session.current ??= crypto.randomUUID();
      if (unsentTurn.current?.message !== text) unsentTurn.current = { message: text, id: crypto.randomUUID() };
      const result = await sendChatMessage(session.current, unsentTurn.current.id, text);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessages((previous) => [...previous, { author: "You", text }]);
      setHandle(result.data.handle);
      unsentTurn.current = undefined;
      setMessage("");
    } catch {
      setError("The connection was interrupted. Your message is ready to retry.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="runtime-chat" aria-labelledby="chat-heading">
      <header className="chat-page-heading">
        <div className="surface-heading">
          <span className="playbook-mark"><Bot size={24} aria-hidden="true" /></span>
          <div><h2 id="chat-heading">Default profile</h2></div>
        </div>
        <span role="status" className={status.ready ? "chat-status is-ready" : "chat-status"}>{status.ready ? "Connected" : "Offline"}</span>
      </header>
      {status.ready ? <>
        <div className="runtime-messages" ref={transcript} role="log" aria-label="Conversation">
          {!messages.length && !sending && (
            <div className="runtime-conversation-empty">
              <h3>What would you like to work on?</h3>
              <p>Send a message to start a conversation.</p>
            </div>
          )}
          {messages.map(({ author, text }, index) => (
            <div key={index} className={author === "You" ? "runtime-message from-user" : "runtime-message"}>
              <strong>{author}</strong><p>{text}</p>
            </div>
          ))}
          {sending && <div className="runtime-message from-user"><strong>You</strong><p>{message.trim()}</p></div>}
          {(sending || (handle && !prompt)) && <p className="runtime-working" role="status">
            <LoaderCircle size={16} aria-hidden="true" /> oma-agent is working…
          </p>}
        </div>
        {error && <p className="form-error chat-error" role="alert">{error}</p>}
        {prompt && handle ? <HermesPrompt key={`${prompt.id}:${prompt.generation}`} prompt={prompt} onAnswer={async (answer) => {
          const { id, generation, kind } = prompt;
          const result = await answerChatPrompt(handle, { id, generation, kind, answer });
          return result.ok ? undefined : result.message;
        }} /> : <form className="runtime-form runtime-composer" onSubmit={(event) => { event.preventDefault(); void send(message.trim()); }}>
          <label htmlFor="hermes-message" className="sr-only">Message oma-agent</label>
          <textarea id="hermes-message" value={message} onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send(message.trim());
              }
            }}
            placeholder="Message oma-agent…" maxLength={maxChatMessageLength} rows={3} required disabled={sending || !!handle} />
          <button className="btn primary" disabled={sending || !!handle || !message.trim()}>
            <Send size={16} aria-hidden="true" /> Send message
          </button>
        </form>}
      </> : (
        <div className="runtime-empty">
          <h3>Connect to your agent</h3>
          <p>{status.message}</p>
          <button className="btn secondary" disabled={refreshing} onClick={() => startTransition(() => router.refresh())}>
            <RefreshCw size={16} aria-hidden="true" /> {refreshing ? "Checking…" : "Check connection"}
          </button>
        </div>
      )}
    </section>
  );
}
