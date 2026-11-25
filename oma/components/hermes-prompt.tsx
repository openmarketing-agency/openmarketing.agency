/** Renders clarification choices and forwards tool approval decisions made by the user. */

"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import type { AgentPrompt as Prompt } from "@/lib/agent-chat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function HermesPrompt({ prompt, onAnswer, autoFocus = true }: {
  prompt: Prompt;
  onAnswer: (answer: string) => Promise<string | undefined>;
  autoFocus?: boolean;
}) {
  const [otherSelected, setOtherSelected] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const question = useRef<HTMLLegendElement>(null);

  useEffect(() => { if (autoFocus) question.current?.focus(); }, [autoFocus]);

  async function answer(value: string) {
    if (submitting || submitted) return;
    if (value.length > 16_384) {
      setError("This answer is too long. Shorten it and try again.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const failure = await onAnswer(value);
      if (failure) setError(failure);
      else setSubmitted(true);
    } catch {
      setError("Could not send your answer. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (prompt.kind !== "clarify") return;
    const form = new FormData(event.currentTarget);
    const selected = form.getAll("choice").filter((value) => value !== "other").map((value) => prompt.choices[Number(value)]);
    const other = String(form.get("other") ?? "").trim();
    if (other) selected.push(other);
    if (!selected.length) {
      setError("Choose an option or enter an answer.");
      return;
    }
    void answer(prompt.multiSelect ? JSON.stringify(selected) : selected[0]);
  }

  return (
    <form className="runtime-form runtime-composer runtime-prompt" onSubmit={submit}>
      <fieldset disabled={submitting || submitted}>
        <legend ref={question} tabIndex={-1}>{prompt.kind === "clarify" ? prompt.question : "Hermes is asking to run a command"}</legend>
        {prompt.kind === "approval" ? <>
          {prompt.description && <p>{prompt.description}</p>}
          <pre className="runtime-output">{prompt.command}</pre>
          <div className="runtime-actions">
            <Button type="button" variant="outline" onClick={() => void answer("deny")}>Deny</Button>
            <Button type="button" onClick={() => void answer("once")}>Approve once</Button>
          </div>
        </> : <>
          {prompt.choices.map((choice, index) => (
            <label className="runtime-choice" key={index}>
              <Input name="choice" type={prompt.multiSelect ? "checkbox" : "radio"} value={index} onChange={() => setOtherSelected(false)} />
              <span>{choice}</span>
            </label>
          ))}
          {prompt.choices.length > 0 && !prompt.multiSelect && (
            <label className="runtime-choice"><input name="choice" type="radio" value="other" onChange={() => setOtherSelected(true)} /> Other</label>
          )}
          {(prompt.choices.length === 0 || otherSelected || prompt.multiSelect) && (
            <label>{prompt.multiSelect ? "Other answer (optional)" : "Your answer"}<Textarea name="other" rows={2} maxLength={16_000} /></label>
          )}
          <div className="runtime-actions">
            <Button type="button" variant="outline" onClick={() => void answer("")}>Skip</Button>
            <Button type="submit">Send answer</Button>
          </div>
        </>}
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      {submitted && <p role="status">Response sent.</p>}
    </form>
  );
}
