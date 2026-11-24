/** Sends authenticated chat turns to a local Hermes gateway and scopes run access to the signed-in user. */

import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";

import type { AgentRunProgress } from "@/lib/agent-activity";
import { maxChatMessageLength, type AgentPrompt, type AgentRun, type AgentStatus } from "@/lib/agent-chat";
import { previewAgentMessage, projectActivityEvents } from "./agent-activity-events";
import { loadAgentWorkspace, workspaceId } from "./agent-workspace";
import { loadSettings } from "./settings";

const runId = z.string().regex(/^run_[A-Za-z0-9_-]{1,128}$/);
export const scopedAgentSessionId = /^oma_[a-f0-9]{32}_([a-f0-9-]{36})$/;
const turnInput = z.object({
  sessionId: z.union([z.uuid(), z.string().regex(scopedAgentSessionId)]),
  turnId: z.uuid(),
  message: z.string().trim().min(1).max(maxChatMessageLength),
  campaignId: workspaceId.optional(),
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
const activityFields = {
  tool: z.string().regex(/^[a-zA-Z0-9_.-]{1,96}$/).optional().catch(undefined),
  progress_at: z.number().positive().max(8.64e12).optional().catch(undefined),
};
const statusSchema = z.object({
  status: z.string(), output: z.string().nullish(), pending_controls: z.array(z.unknown()).optional(),
  ...activityFields,
});
const activitySchema = z.object({
  api_server: z.object({ active_runs: z.number().int().nonnegative() }),
  active_agents: z.number().int().nonnegative(),
});
const tokenCount = z.number().int().nonnegative().optional().catch(undefined);
const progressSchema = z.object({
  status: z.string(),
  ...activityFields,
  pending_controls: z.array(z.unknown()).optional(),
  output: z.string().optional().catch(undefined),
  error: z.union([z.string(), z.object({
    code: z.union([z.string(), z.number()]).optional().catch(undefined),
    message: z.string().optional().catch(undefined),
  })]).optional().catch(undefined),
  turn_exit_reason: z.string().optional().catch(undefined),
  usage: z.object({
    output_tokens: tokenCount, completion_tokens: tokenCount, reasoning_tokens: tokenCount,
  }).optional().catch(undefined),
});
const progressStatus = z.enum([
  "queued", "running", "waiting_for_approval", "stopping", "completed", "failed", "cancelled", "unknown",
]);
const pendingKindSchema = z.object({ kind: z.enum(["clarify", "approval"]) });
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

type ProfileScope = "configured" | "default";

async function gateway(scope: ProfileScope = "configured"): Promise<Gateway> {
  const address = process.env.OMA_AGENT_URL?.trim();
  if (!address) {
    throw new AgentChatError(503, "Set OMA_AGENT_URL and OMA_AGENT_API_KEY to connect the oma-agent gateway.");
  }
  const url = URL.parse(address);
  if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new AgentChatError(503, "Set OMA_AGENT_URL to a valid HTTP or HTTPS oma-agent gateway URL.");
  }

  const keyFile = process.env.OMA_AGENT_API_KEY_FILE?.trim();
  let key = process.env.OMA_AGENT_API_KEY?.trim();
  if (!key && keyFile) {
    try {
      key = (await readFile(keyFile, "utf8")).trim();
    } catch {
      throw new AgentChatError(503, "Waiting for the local oma-agent gateway key. Check that the agent has started.");
    }
  }
  if (!key || /[\r\n]/.test(key)) {
    throw new AgentChatError(503, "Set OMA_AGENT_API_KEY to the oma-agent gateway’s API key.");
  }

  const path = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
  // The unprefixed gateway serves the default profile. Explicit profile URLs use its named route.
  const scopedPath = scope === "default" ? path.replace(/\/p\/[^/]+$/, "/p/default") : path;
  return { baseUrl: url.origin + scopedPath + "/v1", key };
}

async function sendRequest(config: Gateway, path: string, options: {
  body?: object;
  turnId?: string;
  streamSignal?: AbortSignal;
} = {}) {
  const headers = new Headers({ Authorization: `Bearer ${config.key}` });
  if (options.body) headers.set("Content-Type", "application/json");
  if (options.turnId) headers.set("Idempotency-Key", options.turnId);
  if (options.streamSignal) headers.set("Accept", "text/event-stream");
  let response: Response;
  try {
    response = await fetch(config.baseUrl + path, {
      method: options.body ? "POST" : "GET",
      headers,
      body: options.body && JSON.stringify(options.body),
      signal: options.streamSignal ?? AbortSignal.timeout(options.body ? 15_000 : 5000),
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new AgentChatError(503, "Couldn’t reach oma-agent. Check that it’s running and reachable from OMA.");
  }
  if (response.ok) return response;
  await response.body?.cancel();
  if (response.status === 401 || response.status === 403) {
    throw new AgentChatError(response.status, "oma-agent rejected the gateway key.");
  }
  if (response.status === 404 && path.startsWith("/runs/")) {
    throw new AgentChatError(404, "This chat turn is no longer available.");
  }
  if ([404, 405, 501].includes(response.status) && path === "/runs") {
    throw new AgentChatError(501, "The oma-agent gateway needs support for the Runs API.");
  }
  if (response.status === 409) {
    throw new AgentChatError(409, "oma-agent couldn’t accept this request. The turn or question may have changed.");
  }
  throw new AgentChatError(response.status, `oma-agent couldn’t complete the request (HTTP ${response.status}).`);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new AgentChatError(502, "oma-agent returned an invalid response.");
  }
}

function signature(userId: string, config: Gateway, id: string) {
  return createHmac("sha256", loadSettings().secretKey)
    .update(JSON.stringify(["oma:agent-run", userId, config.baseUrl, id])).digest("base64url");
}

function readHandle(userId: string, config: Gateway, handle: unknown) {
  const parsed = handleSchema.safeParse(handle);
  const invalid = () => new AgentChatError(404, "This chat turn is no longer available.");
  if (!parsed.success) throw invalid();
  const [id, proof] = parsed.data.split(".");
  if (!timingSafeEqual(Buffer.from(proof), Buffer.from(signature(userId, config, id)))) throw invalid();
  return id;
}

function pendingRunPrompt(controls: unknown[] | undefined, key: string, kind?: AgentPrompt["kind"]): AgentPrompt | undefined {
  const redact = (value: string) => value.replaceAll(key, "[redacted]");
  for (const item of controls ?? []) {
    const pending = controlSchema.safeParse(item);
    if (!pending.success || (kind && pending.data.kind !== kind)) continue;
    const control = pending.data;
    const identity = { id: control.prompt_id, generation: control.execution_generation };
    return control.kind === "clarify"
      ? { ...identity, kind: "clarify", question: redact(control.question), choices: control.choices.map(redact), multiSelect: control.multi_select }
      : { ...identity, kind: "approval", description: redact(control.description), command: redact(control.command) };
  }
}

function runActivity({ tool, progress_at: at }: { tool?: string; progress_at?: number }, key: string, showTool: boolean) {
  return {
    ...(showTool && tool && !tool.includes(key) ? { tool } : {}),
    ...(at === undefined ? {} : { updatedAt: new Date(at * 1000).toISOString() }),
  };
}

function projectRun(payload: unknown, key: string): AgentRun {
  const parsed = statusSchema.safeParse(payload);
  if (!parsed.success) throw new AgentChatError(502, "oma-agent returned an invalid run status.");
  const run = parsed.data;
  if (run.status === "completed") return { status: "completed", answer: (run.output ?? "").replaceAll(key, "[redacted]") };
  if (!runningStatuses.has(run.status)) return { status: "failed" };
  const prompt = pendingRunPrompt(run.pending_controls, key);
  const phase = prompt?.kind === "approval" ? "waiting_for_approval"
    : prompt?.kind === "clarify" ? "waiting_for_answer"
    : run.status === "queued" || run.status === "stopping" || run.status === "waiting_for_approval" ? run.status : "running";
  return { status: "running", phase, ...(prompt ? { prompt } : {}), ...runActivity(run, key, phase === "running") };
}

/** Read the default profile's native Sessions API through the same private gateway as Runs. */
export async function readAgentSessionApi(path: string) {
  const config = await gateway("default");
  const response = await sendRequest({ ...config, baseUrl: config.baseUrl.slice(0, -"/v1".length) }, "/api/sessions" + path);
  return {
    payload: await readJson(response),
    redact: (text: string) => text.replaceAll(config.key, "[redacted]"),
  };
}

export async function agentStatus(scope?: ProfileScope): Promise<AgentStatus> {
  try {
    const response = await sendRequest(await gateway(scope), "/models");
    await response.body?.cancel();
    return { ready: true };
  } catch (error) {
    if (error instanceof AgentChatError) return { ready: false, message: error.message };
    throw error;
  }
}

export async function startAgentRun(userId: string, input: unknown, scope?: ProfileScope) {
  const parsed = turnInput.safeParse(input);
  if (!parsed.success) throw new AgentChatError(422, "Enter a valid chat message and try again.");
  const { sessionId, turnId, message, campaignId } = parsed.data;
  let agentMessage = message;
  if (campaignId) {
    const { records } = await loadAgentWorkspace();
    if (!records) throw new AgentChatError(503, "The campaign workspace is unavailable. Try again.");
    const campaign = records.campaigns.find(({ id }) => id === campaignId);
    if (!campaign) throw new AgentChatError(404, "This campaign was not found.");
    agentMessage += "\n\nCampaign ID: " + campaign.id;
  }
  const config = await gateway(campaignId ? "default" : scope);
  const response = await sendRequest(config, "/runs", {
    turnId, body: { session_id: sessionId, input: agentMessage },
  });
  const result = z.object({ run_id: runId }).safeParse(await readJson(response));
  if (!result.success) throw new AgentChatError(502, "oma-agent didn’t return a valid run identifier.");
  const id = result.data.run_id;
  return { handle: `${id}.${signature(userId, config, id)}` };
}

export async function getAgentRun(userId: string, handle: unknown, scope?: ProfileScope): Promise<AgentRun> {
  const config = await gateway(scope);
  const id = readHandle(userId, config, handle);
  return projectRun(await readJson(await sendRequest(config, `/runs/${id}`)), config.key);
}

export async function getAgentActivityCounts() {
  const config = await gateway();
  // Detailed health lives alongside /v1, under the same configured profile prefix.
  const health = { ...config, baseUrl: config.baseUrl.slice(0, -"/v1".length) };
  const parsed = activitySchema.safeParse(await readJson(await sendRequest(health, "/health/detailed")));
  if (!parsed.success) throw new AgentChatError(502, "oma-agent didn’t return activity counts.");
  return { activeRuns: parsed.data.api_server.active_runs, activeAgents: parsed.data.active_agents };
}

function describeRunFailure(progress: z.infer<typeof progressSchema>) {
  const { error, output, turn_exit_reason: exitReason } = progress;
  const fields = typeof error === "string" ? [error] : [error?.code, error?.message];
  // Provider errors can embed credentials and internal data. Match known failure signals and return fixed copy.
  const details = [...fields, exitReason, output].join("\n");
  const reasons: ReadonlyArray<readonly [RegExp, string]> = [
    [/\b401\b|authentication[_ -](?:error|failed|required)|unauthorized|invalid[_ -]api[_ -]key|incorrect api key|missing api key/i,
      "The model provider rejected authentication. Check the provider API key in Settings."],
    [/\b403\b|(?:provider|model).{0,30}(?:permission denied|forbidden)/i,
      "The model provider denied access. Check that the API key can use the selected model."],
    [/\b402\b|insufficient[_ -](?:quota|credits?|funds|balance)|payment required|budget exceeded/i,
      "The model provider reported a billing or quota issue. Check your balance and usage limits."],
    [/\b429\b|rate[_ -]limit|too many requests/i,
      "The model provider rate-limited the request. Wait a moment and retry setup."],
    [/model[_ -]not[_ -]found|no such model|invalid[_ -]model|no endpoints found/i,
      "The model provider could not serve the selected model. Check the model ID in Settings."],
    [/context[_ -](?:length|compression[_ -]exhausted)|maximum context|prompt is too long/i,
      "The run exceeded the model’s context limit."],
    [/max[_ -]iterations|iteration[_ -](?:budget|limit)|maximum iterations/i,
      "oma-agent reached its iteration limit before setup finished."],
    [/timed? ?out|timeout/i,
      "The agent or model provider timed out. Retry setup."],
    [/\b(?:502|503|504)\b|service unavailable|overloaded/i,
      "The model provider was temporarily unavailable. Retry setup."],
    [/connection[_ -](?:refused|reset|failed|error)/i,
      "oma-agent could not connect to the model provider. Check the provider base URL in Settings."],
  ];
  return reasons.find(([pattern]) => pattern.test(details))?.[1]
    ?? "oma-agent did not report a recognizable cause. Check the oma-agent logs for details.";
}

export async function getAgentRunProgress(userId: string, handle: unknown): Promise<AgentRunProgress> {
  const config = await gateway();
  const id = readHandle(userId, config, handle);
  const parsed = progressSchema.safeParse(await readJson(await sendRequest(config, "/runs/" + id)));
  if (!parsed.success) throw new AgentChatError(502, "oma-agent didn’t return run progress.");
  const { pending_controls: controls, output, usage, status: rawStatus } = parsed.data;
  const reported = progressStatus.safeParse(rawStatus);
  let status: AgentRunProgress["status"] = rawStatus === "started" ? "running" : reported.data ?? "unknown";
  if (status === "running") {
    const kinds = controls?.map((item) => pendingKindSchema.safeParse(item).data?.kind);
    if (kinds?.includes("approval")) status = "waiting_for_approval";
    else if (kinds?.includes("clarify")) status = "waiting_for_answer";
  }
  const prompt = status === "waiting_for_approval" ? pendingRunPrompt(controls, config.key, "approval")
    : status === "waiting_for_answer" ? pendingRunPrompt(controls, config.key, "clarify") : undefined;
  const message = status === "completed" && output ? previewAgentMessage(output, config.key) : "";
  const outputTokens = usage?.output_tokens ?? usage?.completion_tokens;
  const reasoningTokens = usage?.reasoning_tokens;
  return {
    status,
    ...(message ? { message } : {}),
    ...(prompt ? { prompt } : {}),
    ...(status === "failed" ? { failureReason: describeRunFailure(parsed.data) } : {}),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...runActivity(parsed.data, config.key, status === "running"),
  };
}

/** Stream only the user-visible progress of a Run handle owned by this account. */
export async function streamAgentRunActivity(userId: string, handle: unknown, signal: AbortSignal) {
  const config = await gateway();
  const id = readHandle(userId, config, handle);
  const streamSignal = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  const response = await sendRequest(config, "/runs/" + id + "/events", { streamSignal });
  if (!response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) {
    await response.body?.cancel();
    throw new AgentChatError(502, "oma-agent didn’t return a run event stream.");
  }
  return projectActivityEvents(response.body, config.key);
}

export async function answerAgentPrompt(userId: string, handle: unknown, prompt: unknown, scope?: ProfileScope) {
  const parsed = answerInput.safeParse(prompt);
  if (!parsed.success) throw new AgentChatError(422, "Enter a valid response to the current question.");
  const config = await gateway(scope);
  const id = readHandle(userId, config, handle);
  const { kind, id: requestId, generation, answer } = parsed.data;
  const response = await sendRequest(config, `/runs/${id}/${kind}`, {
    body: { request_id: requestId, execution_generation: generation, [kind === "approval" ? "choice" : "answer"]: answer },
  });
  await response.body?.cancel();
}
