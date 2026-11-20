/** Verifies the SQLite upgrade and resumable onboarding against a simulated Runs API. */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";

import { getDb } from "../lib/db";
import { AgentChatError } from "../lib/server/agent-chat";
import {
  beginOnboarding, completeOnboarding, readOnboarding, refreshOnboarding, skipOnboarding, submitOnboardingAnswer,
} from "../lib/server/onboarding";

const directory = mkdtempSync(join(tmpdir(), "oma-onboarding-test-"));
process.env.OMA_DATA_DIR = directory;
process.env.OMA_AGENT_URL = "http://vm:8642";
process.env.OMA_AGENT_API_KEY = "fixture-agent-key";

const legacy = new DatabaseSync(join(directory, "oma.sqlite"));
legacy.exec(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY NOT NULL,
    slot INTEGER NOT NULL DEFAULT 1 UNIQUE CHECK (slot = 1),
    email TEXT NOT NULL,
    hashed_password TEXT NOT NULL,
    session_version INTEGER NOT NULL DEFAULT 0
  ) STRICT;
  INSERT INTO users (id, email, hashed_password) VALUES ('owner', 'owner@example.test', 'fixture-hash');
  PRAGMA user_version = 1;
`);
legacy.close();

after(() => {
  getDb().close();
  rmSync(directory, { recursive: true, force: true });
});

const firstQuestion = {
  kind: "clarify", prompt_id: "ask-project", execution_generation: 2,
  question: "What are you working on?", choices: ["A new site"], multi_select: false,
};

test("upgrades a version 1 database and resumes setup after a lost clarification response", async (t) => {
  assert.equal(getDb().prepare("SELECT email FROM users WHERE id = ?").get("owner")?.email, "owner@example.test");
  assert.equal(getDb().prepare("PRAGMA user_version").get()?.user_version, 2);
  assert.equal(readOnboarding("owner").step.status, "intro");
  assert.equal(completeOnboarding("owner"), false);

  const keys: string[] = [];
  let accepted = false;
  let replyCount = 0;
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    if (url.endsWith("/runs")) {
      const body = JSON.parse(String(options.body));
      assert.match(body.instructions, /using only the clarify tool/);
      assert.equal(body.input, "I’m ready to set up my marketing workspace.");
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

  beginOnboarding("owner");
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
  assert.equal(beginOnboarding("owner").step.status, "closed");
});

test("restarts an expired run with the saved answers and blocks tool approvals", async (t) => {
  getDb().exec("DELETE FROM workspace_onboarding");
  let starts = 0;
  let status = "question";
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    if (url.endsWith("/runs")) {
      starts++;
      const { input } = JSON.parse(String(options.body));
      if (starts === 2) assert.match(input, /"answer":"A new site"/);
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

test("skips setup without any gateway and cannot reopen it on a stale request", async () => {
  getDb().exec("DELETE FROM workspace_onboarding");
  beginOnboarding("owner");
  skipOnboarding("owner");
  assert.deepEqual(await refreshOnboarding("owner"), { history: [], step: { status: "closed" } });
  assert.equal(beginOnboarding("owner").step.status, "closed");
});
