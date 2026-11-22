/** Checks the local Hermes protocol, configuration, and authorization of run handles with simulated gateway responses. */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";

import { AgentChatError, agentStatus, answerAgentPrompt, getAgentActivityCounts, getAgentRun, getAgentRunProgress, startAgentRun } from "../lib/server/agent-chat";

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
    ready: false, message: "Couldn’t reach Hermes. Check that the gateway is running and reachable from OMA.",
  });
});

test("projects authorized run progress without returning prompts, outputs, or secrets", async (t) => {
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

  for (const status of ["waiting_for_approval", "stopping", "completed", "failed", "cancelled", "unknown"]) {
    payload = { status, output: "private output", progress_at: null };
    assert.deepEqual(await getAgentRunProgress(account, handle), { status });
  }
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
