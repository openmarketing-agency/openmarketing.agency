/** Stores account-owned onboarding in SQLite and resumes its run through the configured agent gateway. */

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { campaigns } from "@/lib/campaigns";
import { getDb } from "@/lib/db";
import { maxSetupAnswerLength, type OnboardingView, type SetupQuestion } from "@/lib/onboarding";
import { AgentChatError, answerAgentPrompt, getAgentRun, startAgentRun } from "./agent-chat";

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
type Snapshot = { json: string; state: State } | undefined;

const setupInstructions = [
  "Guide the owner through Open Marketing Agency setup. Learn what they are marketing and their most important goal.",
  "Ask at most three short questions, one at a time, using only the clarify tool. Ask for a public website if useful.",
  "Offer two to four relevant single-select choices where helpful. Treat an empty answer as a skip.",
  "Continue from any saved answers supplied with the request. Do not repeat their questions.",
  "Never request secrets, credentials, or private information. Do not browse, run commands, use other tools, or change any files or settings.",
  "Close with a brief summary and a practical next step using one of the available campaigns. Do not claim anything was configured.",
  "Available campaigns: " + campaigns.map(({ title, description }) => `${title} — ${description}`).join(" "),
].join("\n");

function read(userId: string): Snapshot {
  const row = getDb().prepare("SELECT state FROM workspace_onboarding WHERE user_id = ?").get(userId);
  if (!row) return;
  const json = String(row.state);
  return { json, state: schema.parse(JSON.parse(json)) };
}

function save(userId: string, previous: Snapshot, next: State) {
  const db = getDb();
  const json = JSON.stringify(next);
  // Compare the entire snapshot so a response from another tab cannot overwrite fresh progress.
  return (previous
    ? db.prepare("UPDATE workspace_onboarding SET state = ? WHERE user_id = ? AND state = ?")
        .run(json, userId, previous.json)
    : db.prepare("INSERT INTO workspace_onboarding (user_id, state) VALUES (?, ?) ON CONFLICT (user_id) DO NOTHING")
        .run(userId, json)).changes === 1;
}

function view(state?: State, question?: SetupQuestion): OnboardingView {
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
  if (previous && previous.state.status !== "failed") return view(previous.state);
  // Persist the idempotency key before making any gateway request.
  const next: State = {
    status: "running", history: previous?.state.history ?? [], sessionId: randomUUID(), turnId: randomUUID(),
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
  const previous = read(userId);
  const state = previous?.state;
  if (state?.status !== "running") return view(state);
  if (!state.handle) {
    const input = state.history.length
      ? "Continue my workspace setup. My saved answers: " + JSON.stringify(state.history.slice(-3).map(({ question, answer }) => ({
          question: question.slice(0, 500), answer,
        })))
      : "I’m ready to set up my marketing workspace.";
    const { handle } = await startAgentRun(userId, {
      sessionId: state.sessionId, turnId: state.turnId, message: input,
    }, setupInstructions);
    return record(userId, previous, { ...state, handle });
  }

  let run;
  try {
    run = await getAgentRun(userId, state.handle);
  } catch (error) {
    if (error instanceof AgentChatError && error.status === 404) {
      return fail(userId, previous, state, "This setup session expired. Resume with your saved answers.");
    }
    throw error;
  }
  if (run.status === "failed") {
    return fail(userId, previous, state, "The agent couldn’t finish setup. Resume with your saved answers.");
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
  return deliverAnswer(userId, { json: JSON.stringify(next), state: next }, next, question);
}

export function completeOnboarding(userId: string) {
  const previous = read(userId);
  if (previous?.state.status === "done" || previous?.state.status === "skipped") return true;
  if (previous?.state.status !== "ready") return false;
  return save(userId, previous, { status: "done", history: previous.state.history });
}

export function skipOnboarding(userId: string) {
  // Skipping works even while another tab is writing progress or the gateway is down.
  getDb().prepare(`
    INSERT INTO workspace_onboarding (user_id, state) VALUES (?, ?)
    ON CONFLICT (user_id) DO UPDATE SET state = excluded.state
    WHERE json_extract(workspace_onboarding.state, '$.status') != 'done'
  `).run(userId, JSON.stringify({ status: "skipped", history: [] }));
}
