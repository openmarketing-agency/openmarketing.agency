import { z } from "zod";
import { campaignProfiles, campaignSources, draftSchema } from "@/lib/marketing-playbook";
import { answerRun, getRun, HermesRunError, startRun, terminalRun } from "./hermes";
import { beginTurn, finishTurn, storeRunId, workspace, type OnboardingView } from "./state";

const PROFILE = "oma-onboarding";
const INSTRUCTIONS = `Onboard an owner for Open Marketing Agency. Learn their brand, audience,
voice, existing assets or links, business knowledge, and the marketing goal they want to pursue.
Ask one concise question at a time using clarify when choices are useful. Do not invent details
or default to a particular marketing channel. Stay within planning and conversation.
The owner will review the proposed playbook, approve any data sources, and activate recurring drafts.`;

const FINALIZE = `Generate the workspace document from our conversation. The OMA console saves it,
so return only a JSON object and do not try to write a file or call other tools. Use this exact shape:
{"brand":{"name":"","audience":"","voice":"","assets":[""]},"knowledge":[""],
"playbook":{"title":"","goal":"","approach":"","steps":[{"profile":"","role":"","task":""}],"sources":[]}}.
Use nonempty strings, existing assets or links only (use [] if none), and at least one grounded
knowledge note. Tailor the goal, approach, and 1–4 sequential steps to the actual campaign.
Each role should name the job for this campaign, such as Email Copywriter or Launch Planner.
Choose the best Hermes profile for each step from: ${Object.entries(campaignProfiles).map(([id, role]) => `${id} (${role})`).join(", ")}.
Each step receives outputs from earlier steps. Only plan for analysis and reviewable drafts, never sending or publishing.
List only the sources the owner wants and the campaign actually needs, using these exact IDs:
${Object.entries(campaignSources).map(([id, source]) => `${id} (${source.evidence})`).join(", ")}.
Use [] when saved business context is sufficient. Do not guess resource identifiers or invent business facts.`;

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
      const brief = parseWorkspaceDocument(output);
      finishTurn(userId, pending, brief ? { brief } : {
        error: "Hermes could not generate a complete playbook. Confirm your brand and goal in the conversation, then try again.",
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

export function parseWorkspaceDocument(output: string) {
  const firstBrace = output.indexOf("{");
  const lastBrace = output.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return;
  try {
    const parsed = JSON.parse(output.slice(firstBrace, lastBrace + 1));
    const verified = draftSchema.safeParse(parsed);
    if (verified.success) return verified.data;
  } catch {
    // Model output is untrusted. Leave the conversation open for correction.
  }
}

export async function submitOnboarding(userId: string, text?: string) {
  if (text === undefined) beginTurn(userId, "Prepare the playbook for my review.", "finalize");
  else beginTurn(userId, turnInput.parse(text), "chat");
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
