/** Verifies account-owned onboarding state and resumable setup against a simulated Runs API. */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { getDb } from "../lib/db";
import { isOnboardingDocumentRequest } from "../lib/onboarding";
import { AgentChatError } from "../lib/server/agent-chat";
import {
  beginOnboarding, completeOnboarding, readOnboarding, refreshOnboarding, resetOnboarding, skipOnboarding, submitOnboardingAnswer,
} from "../lib/server/onboarding";

const directory = mkdtempSync(join(tmpdir(), "oma-onboarding-test-"));
process.env.OMA_DATA_DIR = directory;
process.env.OMA_AGENT_URL = "http://vm:8642";
process.env.OMA_AGENT_API_KEY = "fixture-agent-key";

getDb().prepare("INSERT INTO users (id, email, hashed_password) VALUES (?, ?, ?)")
  .run("owner", "owner@example.test", "fixture-hash");

after(() => {
  getDb().close();
  rmSync(directory, { recursive: true, force: true });
});

const firstQuestion = {
  kind: "clarify", prompt_id: "ask-project", execution_generation: 2,
  question: "What are you working on?", choices: ["A new site"], multi_select: false,
};

test("a document load can request a reset while in-app navigation and prefetches resume setup", () => {
  assert.equal(isOnboardingDocumentRequest(new Headers({
    "sec-fetch-dest": "document", "sec-fetch-mode": "navigate",
  })), true);
  assert.equal(isOnboardingDocumentRequest(new Headers({
    "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", rsc: "1",
  })), false);
  assert.equal(isOnboardingDocumentRequest(new Headers({
    "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-purpose": "prefetch",
  })), false);
});

test("starts onboarding on the first refresh and resumes after a lost clarification response", async (t) => {
  assert.equal(getDb().prepare("SELECT onboarding_state FROM users WHERE id = ?").get("owner")?.onboarding_state, null);
  assert.equal(getDb().prepare("SELECT 1 FROM sqlite_schema WHERE name = 'workspace_onboarding'").get(), undefined);
  assert.equal(readOnboarding("owner").step.status, "intro");
  assert.equal(completeOnboarding("owner"), false);

  const keys: string[] = [];
  let accepted = false;
  let replyCount = 0;
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    if (url.endsWith("/runs")) {
      const body = JSON.parse(String(options.body));
      assert.deepEqual(body, { session_id: body.session_id, input: "start onboarding" });
      const key = new Headers(options.headers).get("Idempotency-Key");
      assert.ok(key);
      keys.push(key);
      return Response.json({ run_id: "run_onboarding" }, { status: 202 });
    }
    if (url.endsWith("/clarify")) {
      assert.deepEqual(JSON.parse(String(options.body)), {
        request_id: "ask-project", execution_generation: 2, answer: "A new site",
      });
      replyCount++;
      accepted = true;
      throw new TypeError("response lost");
    }
    assert.ok(url.endsWith("/runs/run_onboarding"));
    return Response.json(accepted
      ? { status: "completed", output: "Start with the SEO campaign." }
      : { status: "running", pending_controls: [firstQuestion] });
  });

  await Promise.all([refreshOnboarding("owner"), refreshOnboarding("owner")]);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);

  const { step } = await refreshOnboarding("owner");
  assert.equal(step.status, "running");
  assert.equal(step.question?.question, firstQuestion.question);
  const input = { id: "ask-project", generation: 2, answer: "A new site" };
  await assert.rejects(submitOnboardingAnswer("owner", { ...input, generation: 1 }), { status: 409 });
  await assert.rejects(submitOnboardingAnswer("owner", input), AgentChatError);
  assert.equal(replyCount, 1);

  await refreshOnboarding("owner");
  assert.deepEqual(await refreshOnboarding("owner"), {
    history: [{ question: firstQuestion.question, answer: "A new site" }],
    step: { status: "ready", message: "Start with the SEO campaign." },
  });
  assert.equal(replyCount, 1);
  assert.equal(completeOnboarding("owner"), true);
  skipOnboarding("owner");
  assert.equal(beginOnboarding("owner").step.status, "closed");
  const row = getDb().prepare("SELECT onboarding_state FROM users WHERE id = ?").get("owner");
  assert.deepEqual(JSON.parse(String(row?.onboarding_state)), {
    status: "done", history: [{ question: firstQuestion.question, answer: "A new site" }],
  });
});

test("keeps saved answers in the transcript on restart and blocks tool approvals", async (t) => {
  getDb().prepare("UPDATE users SET onboarding_state = NULL WHERE id = ?").run("owner");
  let starts = 0;
  let status = "question";
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    if (url.endsWith("/runs")) {
      starts++;
      const body = JSON.parse(String(options.body));
      assert.deepEqual(body, { session_id: body.session_id, input: "start onboarding" });
      return Response.json({ run_id: `run_onboarding_${starts}` }, { status: 202 });
    }
    if (url.endsWith("/clarify")) return new Response(null, { status: 204 });
    if (status === "expired") return new Response(null, { status: 404 });
    assert.match(url, /\/v1\/runs\/run_onboarding_[12]$/);
    return Response.json({
      status: "running", pending_controls: [status === "question" ? firstQuestion : {
        kind: "approval", prompt_id: "tool-approval", execution_generation: 3, command: "echo test", description: "Run command",
      }],
    });
  });

  beginOnboarding("owner");
  await refreshOnboarding("owner");
  const answer = { id: "ask-project", generation: 2, answer: "A new site" };
  await submitOnboardingAnswer("owner", answer);
  assert.deepEqual((await refreshOnboarding("owner")).step, { status: "running", question: undefined });
  await assert.rejects(submitOnboardingAnswer("owner", answer), { status: 409 });
  status = "expired";
  assert.equal((await refreshOnboarding("owner")).step.status, "failed");

  beginOnboarding("owner");
  await refreshOnboarding("owner");
  status = "approval";
  assert.equal((await refreshOnboarding("owner")).step.status, "failed");
  assert.equal(readOnboarding("owner").history.length, 1);
  assert.equal(completeOnboarding("owner"), false);
});

test("a stored JSON null reads as fresh setup and is replaced on the first refresh", async (t) => {
  const db = getDb();
  db.prepare("UPDATE users SET onboarding_state = ? WHERE id = ?").run("null", "owner");
  const stored = () => db.prepare("SELECT onboarding_state FROM users WHERE id = ?").get("owner")?.onboarding_state;

  assert.deepEqual(readOnboarding("owner"), { history: [], step: { status: "intro" } });
  assert.equal(stored(), "null");
  assert.equal(completeOnboarding("owner"), false);

  const gateway = t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith("/runs")) return Response.json({ run_id: "run_fresh_setup" }, { status: 202 });
    assert.ok(url.endsWith("/runs/run_fresh_setup"));
    return Response.json({ status: "running", pending_controls: [firstQuestion] });
  });

  assert.equal((await refreshOnboarding("owner")).step.status, "running");
  assert.notEqual(stored(), "null");
  const { step } = await refreshOnboarding("owner");
  assert.equal(step.status, "running");
  assert.equal(step.question?.question, firstQuestion.question);
  assert.equal(gateway.mock.callCount(), 2);
});

test("finishing a development setup clears the account state for another run", () => {
  const ready = {
    status: "ready",
    history: [{ question: firstQuestion.question, answer: "A new site" }],
    message: "Start with the SEO campaign.",
  };
  getDb().prepare("UPDATE users SET onboarding_state = ? WHERE id = ?").run(JSON.stringify(ready), "owner");

  assert.equal(completeOnboarding("owner", false), true);
  assert.deepEqual(readOnboarding("owner"), { history: [], step: { status: "intro" } });
  assert.equal(getDb().prepare("SELECT onboarding_state FROM users WHERE id = ?").get("owner")?.onboarding_state, null);
  assert.equal(completeOnboarding("owner", false), true);
});

test("resetting a finished setup makes the account eligible to start again", () => {
  getDb().prepare("UPDATE users SET onboarding_state = ? WHERE id = ?")
    .run(JSON.stringify({ status: "done", history: [] }), "owner");
  assert.equal(readOnboarding("owner").step.status, "closed");

  assert.deepEqual(resetOnboarding("owner"), { history: [], step: { status: "intro" } });
  assert.equal(getDb().prepare("SELECT onboarding_state FROM users WHERE id = ?").get("owner")?.onboarding_state, null);
});

test("skipping setup during automatic startup keeps it closed", async (t) => {
  getDb().prepare("UPDATE users SET onboarding_state = NULL WHERE id = ?").run("owner");
  const requested = Promise.withResolvers<void>();
  const response = Promise.withResolvers<Response>();
  const gateway = t.mock.method(globalThis, "fetch", () => {
    requested.resolve();
    return response.promise;
  });

  const startup = refreshOnboarding("owner");
  await requested.promise;
  skipOnboarding("owner");
  response.resolve(Response.json({ run_id: "run_onboarding" }, { status: 202 }));

  const closed = { history: [], step: { status: "closed" } };
  assert.deepEqual(await startup, closed);
  assert.deepEqual(await refreshOnboarding("owner"), closed);
  assert.equal(beginOnboarding("owner").step.status, "closed");
  assert.equal(gateway.mock.callCount(), 1);
});
