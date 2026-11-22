/** Stores account-owned onboarding in SQLite and resumes its run through the configured agent gateway. */

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { maxSetupAnswerLength, type OnboardingView, type SetupQuestion } from "@/lib/onboarding";
import { AgentChatError, answerAgentPrompt, getAgentRun, startAgentRun } from "./agent-chat";
import { readProjectSetupEnvelope, type ProjectSetupEnvelope } from "./project-setup";

const exchange = z.object({ question: z.string(), answer: z.string() });
const promptIdentity = z.object({ id: z.string(), generation: z.number() });
const pendingAnswer = promptIdentity.extend({ answer: z.string(), exchange });
const history = z.array(exchange);
const schema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("running"), history, sessionId: z.uuid(), turnId: z.uuid(),
    handle: z.string().optional(), pending: pendingAnswer.optional(), lastAnswer: promptIdentity.optional(),
  }),
  z.object({ status: z.literal("failed"), history, message: z.string() }),
  z.object({ status: z.literal("ready"), history, message: z.string() }),
  z.object({ status: z.literal("done"), history }),
  z.object({ status: z.literal("skipped"), history }),
]);
type State = z.infer<typeof schema>;
type ActiveState = Extract<State, { status: "running" }> & { handle: string };
type Snapshot = { json: string; state: State | null; project?: ProjectSetupEnvelope } | undefined;

function read(userId: string): Snapshot {
  const row = getDb().prepare("SELECT onboarding_state FROM users WHERE id = ?").get(userId);
  if (row?.onboarding_state == null) return;
  const json = String(row.onboarding_state);
  const stored: unknown = JSON.parse(json);
  const project = readProjectSetupEnvelope(stored);
  const agent = project ? project.agent : stored;
  // Keep the full original value to guard writes from either onboarding flow.
  return { json, state: agent === null ? null : schema.parse(agent), project };
}

function encode(next: State | null, project?: ProjectSetupEnvelope) {
  return JSON.stringify(project ? { ...project, agent: next } : next);
}

function save(userId: string, previous: Snapshot, next: State | null) {
  // IS also matches a NULL snapshot on the first write, so every update guards against a concurrent change.
  const stored = next !== null || previous?.project ? encode(next, previous?.project) : null;
  return getDb().prepare("UPDATE users SET onboarding_state = ? WHERE id = ? AND onboarding_state IS ?")
    .run(stored, userId, previous?.json ?? null).changes === 1;
}

function view(state?: State | null, question?: SetupQuestion): OnboardingView {
  if (!state) return { history: [], step: { status: "intro" } };
  const { history } = state;
  if (state.status === "done" || state.status === "skipped") return { history, step: { status: "closed" } };
  if (state.status === "running") return { history, step: { status: "running", question } };
  return { history, step: { status: state.status, message: state.message } };
}

export function readOnboarding(userId: string): OnboardingView {
  return view(read(userId)?.state);
}

export function beginOnboarding(userId: string): OnboardingView {
  const previous = read(userId);
  const state = previous?.state;
  if (state && state.status !== "failed") return view(state);
  // Persist the idempotency key before making any gateway request.
  const next: State = {
    status: "running", history: state?.history ?? [], sessionId: randomUUID(), turnId: randomUUID(),
  };
  return save(userId, previous, next) ? view(next) : readOnboarding(userId);
}

function record(userId: string, previous: Snapshot, next: State) {
  return save(userId, previous, next) ? view(next) : readOnboarding(userId);
}

function sameQuestion(question: Pick<SetupQuestion, "id" | "generation">, answer: Pick<SetupQuestion, "id" | "generation">) {
  return question.id === answer.id && question.generation === answer.generation;
}

async function deliverAnswer(userId: string, previous: Snapshot, state: ActiveState, question?: SetupQuestion) {
  const { pending, ...settled } = state;
  if (!pending) return view(state, question);
  if (question && sameQuestion(question, pending)) {
    try {
      await answerAgentPrompt(userId, state.handle, {
        kind: "clarify", id: pending.id, generation: pending.generation, answer: pending.answer,
      });
    } catch (error) {
      // A lost response or a second tab can leave the prompt closed by the time we submit.
      if (error instanceof AgentChatError && error.status === 409) return readOnboarding(userId);
      throw error;
    }
  }
  return record(userId, previous, {
    ...settled,
    lastAnswer: { id: pending.id, generation: pending.generation },
    history: [...state.history, pending.exchange],
  });
}

function fail(userId: string, previous: Snapshot, state: Extract<State, { status: "running" }>, message: string) {
  return record(userId, previous, { status: "failed", history: state.history, message });
}

export async function refreshOnboarding(userId: string): Promise<OnboardingView> {
  let previous = read(userId);
  if (!previous?.state) {
    // Only the signed-in page's POST starts the run. Reading or prefetching the page stays read-only.
    beginOnboarding(userId);
    previous = read(userId);
  }
  const state = previous?.state;
  if (state?.status !== "running") return view(state);
  if (!state.handle) {
    const { handle } = await startAgentRun(userId, {
      sessionId: state.sessionId, turnId: state.turnId, message: "start onboarding",
    });
    return record(userId, previous, { ...state, handle });
  }

  let run;
  try {
    run = await getAgentRun(userId, state.handle);
  } catch (error) {
    if (error instanceof AgentChatError && error.status === 404) {
      return fail(userId, previous, state, "This setup session expired. Your previous answers are still visible here.");
    }
    throw error;
  }
  if (run.status === "failed") {
    return fail(userId, previous, state, "The agent couldn’t finish setup. Your previous answers are still visible here.");
  }
  const question = run.status === "running" ? run.prompt : undefined;
  if (question?.kind === "approval") {
    return fail(userId, previous, state, "The agent requested a command during setup. Resume to continue with questions.");
  }
  if (state.pending) return deliverAnswer(userId, previous, { ...state, handle: state.handle }, question);
  if (run.status === "completed") {
    return record(userId, previous, {
      status: "ready", history: state.history, message: run.answer.trim() || "Your workspace is ready.",
    });
  }
  // A gateway read can briefly still show a question it already accepted.
  return view(state, question && state.lastAnswer && sameQuestion(question, state.lastAnswer) ? undefined : question);
}

const response = z.object({
  id: z.string().min(1).max(256),
  generation: z.number().int().nonnegative(),
  answer: z.string().trim().max(maxSetupAnswerLength),
});
const selections = z.array(z.string().trim().min(1)).min(1);

function displayAnswer(question: SetupQuestion, answer: string) {
  if (!question.multiSelect || !answer) return answer;
  try {
    return selections.parse(JSON.parse(answer)).join(", ");
  } catch {
    throw new AgentChatError(422, "Choose at least one valid answer.");
  }
}

export async function submitOnboardingAnswer(userId: string, input: unknown): Promise<OnboardingView> {
  const parsed = response.safeParse(input);
  if (!parsed.success) throw new AgentChatError(422, "Enter a shorter answer and try again.");

  const previous = read(userId);
  const state = previous?.state;
  const closed = () => new AgentChatError(409, "This setup question has closed. Check the latest question.");
  if (state?.status !== "running" || !state.handle) throw closed();
  if (state.lastAnswer && sameQuestion(state.lastAnswer, parsed.data)) throw closed();
  if (state.pending) {
    if (sameQuestion(state.pending, parsed.data) && state.pending.answer === parsed.data.answer) {
      return refreshOnboarding(userId);
    }
    throw closed();
  }

  const run = await getAgentRun(userId, state.handle);
  const question = run.status === "running" ? run.prompt : undefined;
  if (question?.kind !== "clarify" || !sameQuestion(question, parsed.data)) throw closed();
  const pending = {
    ...parsed.data, exchange: { question: question.question, answer: displayAnswer(question, parsed.data.answer) },
  };
  const next = { ...state, handle: state.handle, pending };
  if (!save(userId, previous, next)) throw closed();
  const project = previous?.project;
  return deliverAnswer(userId, { json: encode(next, project), state: next, project }, next, question);
}

export function completeOnboarding(userId: string, persistCompletion = true) {
  const previous = read(userId);
  const state = previous?.state;
  if (!state) return !persistCompletion;
  if (state.status === "done" || state.status === "skipped") return true;
  if (state.status !== "ready") return false;
  const next: State | null = persistCompletion ? { status: "done", history: state.history } : null;
  return save(userId, previous, next);
}

export function resetOnboarding(userId: string): OnboardingView {
  const previous = read(userId);
  return save(userId, previous, null) ? view() : readOnboarding(userId);
}

export function skipOnboarding(userId: string) {
  // Skipping works even while another tab is writing progress or the gateway is down.
  const skipped = JSON.stringify({ status: "skipped", history: [] });
  getDb().prepare(`
    UPDATE users SET onboarding_state = CASE
      WHEN json_extract(onboarding_state, '$.kind') = 'project-setup'
        THEN json_set(onboarding_state, '$.agent', json(?))
      ELSE ?
    END
    WHERE id = ? AND (CASE
      WHEN json_extract(onboarding_state, '$.kind') = 'project-setup'
        THEN json_extract(onboarding_state, '$.agent.status')
      ELSE json_extract(onboarding_state, '$.status')
    END) IS NOT 'done'
  `).run(skipped, skipped, userId);
}
