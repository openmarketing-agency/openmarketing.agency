/** Sends authenticated chat turns to a local Hermes gateway and scopes run access to the signed-in user. */

import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";

import { maxChatMessageLength, type AgentPrompt, type AgentRun, type AgentStatus } from "@/lib/agent-chat";
import { loadSettings } from "./settings";

const runId = z.string().regex(/^run_[A-Za-z0-9_-]{1,128}$/);
const turnInput = z.object({
  sessionId: z.uuid(),
  turnId: z.uuid(),
  message: z.string().trim().min(1).max(maxChatMessageLength),
});
const promptId = z.string().regex(/^[a-zA-Z0-9_-]{1,256}$/);
const generation = z.number().int().nonnegative();
const coordinates = { id: promptId, generation };
const answerInput = z.discriminatedUnion("kind", [
  z.object({ ...coordinates, kind: z.literal("clarify"), answer: z.string().max(16_384) }),
  z.object({ ...coordinates, kind: z.literal("approval"), answer: z.enum(["once", "deny"]) }),
]);
const wireCoordinates = { prompt_id: promptId, execution_generation: generation };
const controlSchema = z.discriminatedUnion("kind", [
  z.object({ ...wireCoordinates, kind: z.literal("clarify"), question: z.string().min(1),
    choices: z.array(z.string().min(1)), multi_select: z.boolean() }),
  z.object({ ...wireCoordinates, kind: z.literal("approval"), command: z.string(), description: z.string() }),
]);
const statusSchema = z.object({
  status: z.string(), output: z.string().nullish(), pending_controls: z.array(z.unknown()).optional(),
});
const runningStatuses = new Set(["queued", "started", "running", "waiting_for_approval", "stopping"]);
const handleSchema = z.string().regex(/^run_[A-Za-z0-9_-]{1,128}\.[A-Za-z0-9_-]{43}$/);

export class AgentChatError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

interface Gateway {
  baseUrl: string;
  key: string;
}

async function gateway(): Promise<Gateway> {
  const address = process.env.OMA_AGENT_URL?.trim();
  if (!address) {
    throw new AgentChatError(503, "Set OMA_AGENT_URL and OMA_AGENT_API_KEY to connect your Hermes gateway.");
  }
  const url = URL.parse(address);
  if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new AgentChatError(503, "Set OMA_AGENT_URL to a valid HTTP or HTTPS Hermes gateway URL.");
  }

  const keyFile = process.env.OMA_AGENT_API_KEY_FILE?.trim();
  let key = process.env.OMA_AGENT_API_KEY?.trim();
  if (!key && keyFile) {
    try {
      key = (await readFile(keyFile, "utf8")).trim();
    } catch {
      throw new AgentChatError(503, "Waiting for the local Hermes gateway key. Check that the agent has started.");
    }
  }
  if (!key || /[\r\n]/.test(key)) {
    throw new AgentChatError(503, "Set OMA_AGENT_API_KEY to your Hermes gateway’s API key.");
  }

  const path = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
  return { baseUrl: url.origin + path + "/v1", key };
}

async function sendRequest(config: Gateway, path: string, options: { body?: object; turnId?: string } = {}) {
  const headers = new Headers({ Authorization: `Bearer ${config.key}` });
  if (options.body) headers.set("Content-Type", "application/json");
  if (options.turnId) headers.set("Idempotency-Key", options.turnId);
  let response: Response;
  try {
    response = await fetch(config.baseUrl + path, {
      method: options.body ? "POST" : "GET",
      headers,
      body: options.body && JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.body ? 15_000 : 5000),
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new AgentChatError(503, "Couldn’t reach Hermes. Check that the gateway is running and reachable from OMA.");
  }
  if (response.ok) return response;
  await response.body?.cancel();
  if (response.status === 401 || response.status === 403) {
    throw new AgentChatError(response.status, "Hermes rejected the gateway key.");
  }
  if (response.status === 404 && path.startsWith("/runs/")) {
    throw new AgentChatError(404, "This Hermes turn is no longer available.");
  }
  if ([404, 405, 501].includes(response.status) && path === "/runs") {
    throw new AgentChatError(501, "This Hermes gateway needs support for the Runs API.");
  }
  if (response.status === 409) {
    throw new AgentChatError(409, "Hermes couldn’t accept this request. The turn or question may have changed.");
  }
  throw new AgentChatError(response.status, `Hermes couldn’t complete the request (HTTP ${response.status}).`);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new AgentChatError(502, "Hermes returned an invalid response.");
  }
}

function signature(userId: string, config: Gateway, id: string) {
  return createHmac("sha256", loadSettings().secretKey)
    .update(JSON.stringify(["oma:agent-run", userId, config.baseUrl, id])).digest("base64url");
}

function readHandle(userId: string, config: Gateway, handle: unknown) {
  const parsed = handleSchema.safeParse(handle);
  const invalid = () => new AgentChatError(404, "This Hermes turn is no longer available.");
  if (!parsed.success) throw invalid();
  const [id, proof] = parsed.data.split(".");
  if (!timingSafeEqual(Buffer.from(proof), Buffer.from(signature(userId, config, id)))) throw invalid();
  return id;
}

function projectRun(payload: unknown, key: string): AgentRun {
  const parsed = statusSchema.safeParse(payload);
  if (!parsed.success) throw new AgentChatError(502, "Hermes returned an invalid run status.");
  const redact = (value: string) => value.replaceAll(key, "[redacted]");
  const run = parsed.data;
  if (run.status === "completed") return { status: "completed", answer: redact(run.output ?? "") };
  if (!runningStatuses.has(run.status)) return { status: "failed" };
  for (const item of run.pending_controls ?? []) {
    const pending = controlSchema.safeParse(item);
    if (!pending.success) continue;
    const control = pending.data;
    const identity = { id: control.prompt_id, generation: control.execution_generation };
    const prompt: AgentPrompt = control.kind === "clarify"
      ? { ...identity, kind: "clarify", question: redact(control.question), choices: control.choices.map(redact), multiSelect: control.multi_select }
      : { ...identity, kind: "approval", description: redact(control.description), command: redact(control.command) };
    return { status: "running", prompt };
  }
  return { status: "running" };
}

export async function agentStatus(): Promise<AgentStatus> {
  try {
    const response = await sendRequest(await gateway(), "/models");
    await response.body?.cancel();
    return { ready: true };
  } catch (error) {
    if (error instanceof AgentChatError) return { ready: false, message: error.message };
    throw error;
  }
}

export async function startAgentRun(userId: string, input: unknown) {
  const parsed = turnInput.safeParse(input);
  if (!parsed.success) throw new AgentChatError(422, "Enter a valid chat message and try again.");
  const config = await gateway();
  const { sessionId, turnId, message } = parsed.data;
  const response = await sendRequest(config, "/runs", {
    turnId, body: { session_id: sessionId, input: message },
  });
  const result = z.object({ run_id: runId }).safeParse(await readJson(response));
  if (!result.success) throw new AgentChatError(502, "Hermes didn’t return a valid run identifier.");
  const id = result.data.run_id;
  return { handle: `${id}.${signature(userId, config, id)}` };
}

export async function getAgentRun(userId: string, handle: unknown): Promise<AgentRun> {
  const config = await gateway();
  const id = readHandle(userId, config, handle);
  return projectRun(await readJson(await sendRequest(config, `/runs/${id}`)), config.key);
}

export async function answerAgentPrompt(userId: string, handle: unknown, prompt: unknown) {
  const parsed = answerInput.safeParse(prompt);
  if (!parsed.success) throw new AgentChatError(422, "Enter a valid response to the current question.");
  const config = await gateway();
  const id = readHandle(userId, config, handle);
  const { kind, id: requestId, generation, answer } = parsed.data;
  const response = await sendRequest(config, `/runs/${id}/${kind}`, {
    body: { request_id: requestId, execution_generation: generation, [kind === "approval" ? "choice" : "answer"]: answer },
  });
  await response.body?.cancel();
}
