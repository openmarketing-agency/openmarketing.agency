/** Lets reviewers request, inspect, and apply local sample revisions without calling an agent. */

"use client";

import { ArrowUp, MessageSquare } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { proposeApprovalRevision } from "@/lib/approvals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ChatTurn = { request: string; reply: string };
type Proposal = { text: string; source: string };
type Props = { body: string; cta: string; disabled: boolean; onApply: (text: string) => void };

export function ApprovalChat({ body, cta, disabled, onApply }: Props) {
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [proposal, setProposal] = useState<Proposal>();
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (turns.length && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [turns]);

  function send(value: string) {
    const request = value.trim();
    if (!request || disabled) return;
    const { message, revision } = proposeApprovalRevision(body, request, cta);
    setTurns((current) => [...current, { request, reply: message }]);
    setProposal(revision ? { text: revision, source: body } : undefined);
    setInput("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send(input);
  }

  const stale = !!proposal && proposal.source !== body;

  return (
    <aside className="approval-chat" aria-labelledby="approval-chat-title" id="approval-chat">
      <header className="approval-chat-heading">
        <MessageSquare size={18} aria-hidden="true" />
        <h2 id="approval-chat-title">Edit with chat</h2>
        <span className="approval-preview-label">Mock chat</span>
      </header>

      <div className="approval-chat-log" ref={log} role="log" aria-label="Draft chat" tabIndex={0}>
        <p className="approval-chat-reply">
          Ask for a shorter draft, a call to action, or a specific change. You can review each suggestion before applying it.
        </p>
        {turns.map((turn, index) => (
          <div className="approval-chat-turn" key={index}>
            <p className="approval-chat-user"><span className="sr-only">You: </span>{turn.request}</p>
            <p className="approval-chat-reply"><span className="sr-only">Mock chat: </span>{turn.reply}</p>
          </div>
        ))}
        {proposal && (
          <div className="approval-proposal">
            <h3>Suggested draft</h3>
            <div className="approval-proposal-text" tabIndex={0} role="region" aria-label="Suggested draft text">{proposal.text}</div>
            {stale && <p className="approval-proposal-note">The draft changed. Request a new suggestion to apply it.</p>}
            <div className="approval-proposal-actions">
              <Button type="button" disabled={disabled || stale} onClick={() => {
                onApply(proposal.text);
                setProposal(undefined);
              }}>Apply to draft</Button>
              <Button type="button" variant="ghost" onClick={() => setProposal(undefined)}>Discard</Button>
            </div>
          </div>
        )}
      </div>

      <div className="approval-chat-footer">
        {disabled ? (
          <p>Reopen this review to make more edits.</p>
        ) : (
          <div className="approval-chat-prompts" aria-label="Suggested requests">
            <button type="button" onClick={() => send("Make it shorter")}>Make it shorter</button>
            <button type="button" onClick={() => send("Suggest a CTA")}>Suggest a CTA</button>
          </div>
        )}
        <form className="approval-chat-form" onSubmit={submit}>
          <label htmlFor="approval-chat-request" className="sr-only">Ask for an edit</label>
          <Input id="approval-chat-request" value={input} maxLength={500} onChange={(event) => setInput(event.target.value)}
            placeholder="Ask for an edit…" disabled={disabled} />
          <Button type="submit" aria-label="Send edit request" disabled={disabled || !input.trim()}>
            <ArrowUp size={18} aria-hidden="true" />
          </Button>
        </form>
      </div>
    </aside>
  );
}
