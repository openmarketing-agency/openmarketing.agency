import { z } from "zod";
import { answerRun, getRun, HermesRunError, startRun, terminalRun } from "./hermes";
import { beginTurn, briefSchema, finishTurn, propertySchema, storeRunId, workspace, type OnboardingView } from "./state";

const PROFILE = "oma-onboarding";
const INSTRUCTIONS = `Onboard an owner for Open Marketing Agency's SEO campaign. Learn their brand, audience,
voice, existing brand assets or links, business knowledge, and the marketing goal.
Ask one concise question at a time using clarify when choices are useful. Do not
invent details. Explain that saving will authorize a recurring draft-only campaign once Search Console
is connected. Stay within planning and conversation.`;

const FINALIZE = `Generate the workspace document from our conversation. The OMA console saves it,
so return only a JSON object and do not try to write a file or call other tools. Use this exact shape:
{"brand":{"name":"","audience":"","voice":"","assets":[""]},"knowledge":[""],
"playbook":{"title":"","goal":"","approach":""}}.
Use nonempty strings, existing assets or links only (use [] if none), and at least one grounded
knowledge note. Tailor the SEO approach to the
user's goal, for read-only Search Console analysis and reviewable drafts. Never invent business facts.`;

export const turnInput = z.string().trim().min(1).max(4000);

export async function refreshOnboarding(userId: string): Promise<OnboardingView> {
  const current = workspace(userId);
  const pending = current.onboarding?.pending;
  if (!pending || !current.onboarding) return current;
  try {
    const run = pending.runId
      ? await getRun(PROFILE, pending.runId)
      : await startRun(PROFILE, pending.id, pending.text, current.onboarding.session,
          pending.kind === "chat" ? INSTRUCTIONS : `${INSTRUCTIONS}\n${FINALIZE}`);
    if (!pending.runId) storeRunId(userId, pending.id, run.run_id);
    if (!terminalRun(run.status)) {
      return {
        ...workspace(userId),
        question: run.pending_controls?.find((control) => control.kind === "clarify"),
      };
    }
    const output = run.output?.trim();
    if (run.status !== "completed" || !output) {
      finishTurn(userId, pending, { error: "Hermes could not finish the turn. Try again." });
    } else if (pending.kind === "chat") {
      finishTurn(userId, pending, { message: output.slice(0, 8000) });
    } else {
      const brief = parseWorkspaceDocument(output, pending.property);
      finishTurn(userId, pending, brief ? { brief } : {
        error: "Hermes could not save a complete setup. Confirm your brand and goal in the conversation, then try saving again.",
      });
    }
  } catch (error) {
    if (error instanceof HermesRunError && [400, 404, 409, 422].includes(error.status)) {
      finishTurn(userId, pending, { error: "The Hermes turn is no longer available. Try again." });
    } else {
      throw error;
    }
  }
  return workspace(userId);
}

export function parseWorkspaceDocument(output: string, property?: string) {
  const firstBrace = output.indexOf("{");
  const lastBrace = output.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return;
  try {
    const parsed = JSON.parse(output.slice(firstBrace, lastBrace + 1));
    const verified = briefSchema.safeParse({
      ...parsed, playbook: { ...parsed?.playbook, property },
    });
    if (verified.success) return verified.data;
  } catch {
    // Model output is untrusted. Leave the conversation open for correction.
  }
}

export async function submitOnboarding(userId: string, text: string, finalize = false) {
  if (finalize) {
    const property = propertySchema.safeParse(text);
    if (!property.success) return {
      ...workspace(userId),
      requestError: "Enter the exact Search Console property, such as sc-domain:example.com or https://example.com/.",
    };
    beginTurn(userId, FINALIZE, "finalize", property.data);
  } else beginTurn(userId, turnInput.parse(text), "chat");
  return refreshOnboarding(userId);
}

export async function clarifyOnboarding(userId: string, promptId: string, text: string) {
  const { onboarding } = workspace(userId);
  const pending = onboarding?.pending;
  if (!pending?.runId) return refreshOnboarding(userId);
  const run = await getRun(PROFILE, pending.runId);
  const prompt = run.pending_controls?.find((control) => control.kind === "clarify" && control.prompt_id === promptId);
  if (prompt) await answerRun(PROFILE, pending.runId, prompt, turnInput.parse(text));
  return refreshOnboarding(userId);
}
