/** Checks the local Hermes protocol, configuration, and authorization of run handles with simulated gateway responses. */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";

import { AgentChatError, agentStatus, answerAgentPrompt, getAgentActivityCounts, getAgentRun, getAgentRunProgress, startAgentRun, streamAgentRunActivity } from "../lib/server/agent-chat";

const key = "fixture-agent-key";
const account = "fixture-owner";
const message = {
  sessionId: "a6995b9b-29a0-4cad-9aaa-a94329510a35",
  turnId: "49f82a24-1c1d-48af-b078-160652afbb87",
  message: "Review the workspace",
};

function useGateway(t: TestContext, overrides: Record<string, string | undefined> = {}) {
  const environment = {
    OMA_AGENT_URL: "http://vm:8642/p/seo__orchestrator/v1/",
    OMA_AGENT_API_KEY: key,
    OMA_AGENT_API_KEY_FILE: undefined,
    ...overrides,
  };
  const previous: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(environment)) {
    previous[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

test("starts and polls a scoped run, submits its clarification, and redacts the gateway key", async (t) => {
  useGateway(t);
  const runId = "run_test";
  const requests = t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.ok(url.startsWith("http://vm:8642/p/seo__orchestrator/v1/"));
    const headers = new Headers(options.headers);
    assert.equal(headers.get("authorization"), `Bearer ${key}`);
    assert.equal(options.redirect, "error");
    if (url.endsWith("/models")) return Response.json({ data: [] });
    if (url.endsWith("/runs")) {
      assert.equal(headers.get("idempotency-key"), message.turnId);
      assert.deepEqual(JSON.parse(String(options.body)), { session_id: message.sessionId, input: message.message });
      return Response.json({ run_id: runId }, { status: 202 });
    }
    if (url.endsWith("/clarify")) {
      assert.deepEqual(JSON.parse(String(options.body)), {
        request_id: "ask-1", execution_generation: 2, answer: "SEO",
      });
      return new Response(null, { status: 204 });
    }
    return Response.json(requests.mock.callCount() === 2 ? {
      status: "running", output: null, pending_controls: [{
        kind: "clarify", prompt_id: "ask-1", execution_generation: 2, question: "What are we working on?",
        choices: ["SEO"], multi_select: false,
      }],
    } : { status: "completed", output: `Done. ${key}` });
  });
  assert.deepEqual(await agentStatus(), { ready: true });
  const { handle } = await startAgentRun(account, message);
  const unavailable = (error: unknown) => error instanceof AgentChatError && error.status === 404;
  await assert.rejects(getAgentRun("another-user", handle), unavailable);
  await assert.rejects(getAgentRun(account, handle.replace(runId, "run_other")), unavailable);
  assert.equal(requests.mock.callCount(), 2);

  const run = await getAgentRun(account, handle);
  assert.equal(run.status, "running");
  assert.ok(run.prompt?.kind === "clarify");
  assert.deepEqual(run.prompt.choices, ["SEO"]);
  await answerAgentPrompt(account, handle, { ...run.prompt, answer: "SEO" });
  assert.deepEqual(await getAgentRun(account, handle), { status: "completed", answer: "Done. [redacted]" });
});

test("appends the saved campaign ID to every turn sent to the default profile", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "oma-campaign-chat-"));
  const socket = join(directory, "workspace.sock");
  useGateway(t, { OMA_WORKSPACE_SOCKET: socket });
  const campaignId = "social-community";
  const server = createServer((request, response) => {
    assert.equal(request.url, "/workspace");
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
      skipped: 0, brands: [], playbooks: [], agents: [],
      campaigns: [{
        id: campaignId, name: "Social & Community", description: "", playbookId: "",
        version: "", orchestrator: "", agentIds: [], goals: [], plans: [], board: "",
      }],
    }));
  });
  t.after(async () => {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    rmSync(directory, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(socket, resolve));

  const requests = t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "http://vm:8642/p/default/v1/runs");
    assert.equal(new Headers(options.headers).get("authorization"), "Bearer " + key);
    return Response.json({ run_id: "run_campaign" }, { status: 202 });
  });
  const followUp = {
    ...message, turnId: "c7198822-7690-4c2e-9b20-22027d530bfa", message: "What’s next?",
  };
  for (const turn of [message, followUp]) {
    const { handle } = await startAgentRun(account, { ...turn, campaignId });
    assert.match(handle, /^run_campaign\./);
  }
  assert.equal(requests.mock.callCount(), 2);
  requests.mock.calls.forEach(({ arguments: [, options] }, index) => {
    assert.ok(options);
    const turn = [message, followUp][index];
    assert.equal(new Headers(options.headers).get("idempotency-key"), turn.turnId);
    assert.deepEqual(JSON.parse(String(options.body)), {
      session_id: turn.sessionId, input: turn.message + "\n\nCampaign ID: " + campaignId,
    });
  });
  await assert.rejects(startAgentRun(account, { ...message, campaignId: "missing" }),
    (error: unknown) => error instanceof AgentChatError && error.status === 404);
  await assert.rejects(startAgentRun(account, { ...message, campaignId: "../invalid" }),
    (error: unknown) => error instanceof AgentChatError && error.status === 422);
  assert.equal(requests.mock.callCount(), 2);
});

test("uses the private key file for the bundled gateway and reports unreachable gateways", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "oma-agent-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "gateway.key");
  writeFileSync(file, key, { mode: 0o600 });
  useGateway(t, { OMA_AGENT_URL: "http://vm:8642", OMA_AGENT_API_KEY: undefined, OMA_AGENT_API_KEY_FILE: file });
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "http://vm:8642/v1/models");
    assert.equal(new Headers(options.headers).get("authorization"), `Bearer ${key}`);
    throw new TypeError("unreachable");
  });
  assert.deepEqual(await agentStatus(), {
    ready: false, message: "Couldn’t reach oma-agent. Check that it’s running and reachable from OMA.",
  });
});

test("projects authorized run progress with sanitized public replies and reported usage", async (t) => {
  useGateway(t);
  const runEndpoint = "http://vm:8642/p/seo__orchestrator/v1/runs";
  let payload: object = { status: "queued" };
  const requests = t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(new Headers(options.headers).get("authorization"), "Bearer " + key);
    if (url === runEndpoint) return Response.json({ run_id: "run_progress" }, { status: 202 });
    assert.equal(url, runEndpoint + "/run_progress");
    return Response.json(payload);
  });
  const { handle } = await startAgentRun(account, message);
  await assert.rejects(getAgentRunProgress("different-user", handle), (error: unknown) =>
    error instanceof AgentChatError && error.status === 404);
  assert.equal(requests.mock.callCount(), 1);
  assert.deepEqual(await getAgentRunProgress(account, handle), { status: "queued" });

  payload = { status: "running", tool: "web_search", progress_at: 1700000000, output: key };
  assert.deepEqual(await getAgentRunProgress(account, handle), {
    status: "running", tool: "web_search", updatedAt: "2023-11-14T22:13:20.000Z",
  });
  payload = { status: "running", tool: key };
  assert.deepEqual(await getAgentRunProgress(account, handle), { status: "running" });
  payload = { status: "running", pending_controls: [{ kind: "clarify", question: "private prompt" }] };
  assert.deepEqual(await getAgentRunProgress(account, handle), { status: "waiting_for_answer" });
  payload = { status: "running", pending_controls: [{ kind: "clarify" }, { kind: "approval", command: "private command" }] };
  assert.deepEqual(await getAgentRunProgress(account, handle), { status: "waiting_for_approval" });

  for (const status of ["waiting_for_approval", "stopping", "cancelled", "unknown"]) {
    payload = { status, output: "OpenRouter HTTP 401", progress_at: null };
    assert.deepEqual(await getAgentRunProgress(account, handle), { status });
  }

  // The installed gateway may provide the reason only in output, or as a structured error on other versions.
  payload = { status: "failed", output: "OpenRouter HTTP 401. Credential: " + key, usage: { output_tokens: 0 } };
  assert.deepEqual(await getAgentRunProgress(account, handle), {
    status: "failed", failureReason: "The model provider rejected authentication. Check the provider API key in Settings.",
    outputTokens: 0,
  });
  payload = { status: "failed", error: { code: 429, message: "Private provider details " + key } };
  assert.deepEqual(await getAgentRunProgress(account, handle), {
    status: "failed", failureReason: "The model provider rate-limited the request. Wait a moment and retry setup.",
  });
  payload = { status: "failed", turn_exit_reason: "max_iterations_reached(8/8)" };
  assert.deepEqual(await getAgentRunProgress(account, handle), {
    status: "failed", failureReason: "oma-agent reached its iteration limit before setup finished.",
  });
  payload = { status: "failed", error: { message: "Private details " + key }, output: "private output" };
  assert.deepEqual(await getAgentRunProgress(account, handle), {
    status: "failed", failureReason: "oma-agent did not report a recognizable cause. Check the oma-agent logs for details.",
  });
  payload = {
    status: "completed", output: "Setup ready. " + key, reasoning: "private analysis",
    usage: { input_tokens: 200, output_tokens: 42, reasoning_tokens: 12, cost_usd: 0.01 },
  };
  assert.deepEqual(await getAgentRunProgress(account, handle), {
    status: "completed", message: "Setup ready. [redacted]", outputTokens: 42, reasoningTokens: 12,
  });

  payload = { status: "completed", usage: { completion_tokens: 20, reasoning_tokens: -1 } };
  assert.deepEqual(await getAgentRunProgress(account, handle), { status: "completed", outputTokens: 20 });

});

test("streams only public assistant text for the owner and redacts a credential split across deltas", async (t) => {
  useGateway(t);
  const runEndpoint = "http://vm:8642/p/seo__orchestrator/v1/runs";
  const request = new AbortController();
  const events = [
    { event: "reasoning.available", text: "internal thinking" },
    { event: "tool.started", tool: "terminal", preview: "sensitive command" },
    { event: "approval.request", description: "private approval" },
    { event: "message.interim", text: "Checking the website. " + key },
    { event: "message.delta", delta: "The setup is almost complete. " + key.slice(0, 7) },
    { event: "message.delta", delta: key.slice(7) + ". I have created the initial campaign records." },
    { event: "run.completed", output: "The workspace is ready." },
  ];
  const text = events.map((event) => "data: " + JSON.stringify(event) + "\r\n\r\n").join("");
  const requests = t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    const headers = new Headers(options.headers);
    assert.equal(headers.get("authorization"), "Bearer " + key);
    if (url === runEndpoint) return Response.json({ run_id: "run_progress" }, { status: 202 });
    assert.equal(url, runEndpoint + "/run_progress/events");
    assert.equal(headers.get("accept"), "text/event-stream");
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < text.length; index += 17) {
          controller.enqueue(encoder.encode(text.slice(index, index + 17)));
        }
        controller.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
  });

  const { handle } = await startAgentRun(account, message);
  await assert.rejects(streamAgentRunActivity("different-user", handle, request.signal),
    (error: unknown) => error instanceof AgentChatError && error.status === 404);
  assert.equal(requests.mock.callCount(), 1);
  const stream = await streamAgentRunActivity(account, handle, request.signal);
  const rendered = await new Response(stream).text();
  assert.match(rendered, /Checking the website\. \[redacted\]/);
  assert.match(rendered, /The setup is almost complete\. \[redacted\]/);
  assert.match(rendered, /The workspace is ready/);
  assert.doesNotMatch(rendered, /fixture|internal thinking|sensitive command|private approval|run_progress/);
});

test("reads aggregate activity from protected detailed health with the configured profile prefix", async (t) => {
  useGateway(t);
  let valid = true;
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "http://vm:8642/p/seo__orchestrator/health/detailed");
    assert.equal(new Headers(options.headers).get("authorization"), "Bearer " + key);
    assert.equal(options.method, "GET");
    assert.equal(options.cache, "no-store");
    return Response.json(valid ? {
      active_agents: 1, api_server: { active_runs: 2 }, platforms: { private: key },
    } : { status: "ok" });
  });
  assert.deepEqual(await getAgentActivityCounts(), { activeAgents: 1, activeRuns: 2 });
  valid = false;
  await assert.rejects(getAgentActivityCounts(), (error: unknown) =>
    error instanceof AgentChatError && error.status === 502);
});

test("uses the default profile for chat even when the configured gateway URL names a specialist", async (t) => {
  useGateway(t);
  const expected = "http://vm:8642/p/default/v1";
  const requests = t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.ok(url.startsWith(expected));
    assert.equal(new Headers(options.headers).get("authorization"), "Bearer " + key);
    if (url === expected + "/models") return Response.json({ data: [] });
    if (url === expected + "/runs") return Response.json({ run_id: "run_default" }, { status: 202 });
    if (url.endsWith("/clarify")) return new Response(null, { status: 204 });
    return Response.json({ status: "completed", output: "From the default profile." });
  });
  assert.deepEqual(await agentStatus("default"), { ready: true });
  const { handle } = await startAgentRun(account, message, "default");
  await assert.rejects(getAgentRun(account, handle), (error: unknown) => error instanceof AgentChatError && error.status === 404);
  await answerAgentPrompt(account, handle, { id: "question", generation: 0, kind: "clarify", answer: "Yes" }, "default");
  assert.deepEqual(await getAgentRun(account, handle, "default"), { status: "completed", answer: "From the default profile." });
  assert.equal(requests.mock.callCount(), 4);
});
