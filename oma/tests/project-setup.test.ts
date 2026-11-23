/** Verifies project link validation, retry-safe agent delivery, and isolation from the backed-up conversation. */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";

import { getDb } from "../lib/db";
import { readDashboardAgentActivity } from "../lib/server/agent-activity";
import { beginOnboarding, readOnboarding, resetOnboarding, skipOnboarding } from "../lib/server/onboarding";
import { isProjectSetupComplete, readProjectSetup, retrySavedProjectSetup, sendProjectSetup, skipSavedProjectSetup, validateProjectLinks } from "../lib/server/project-setup";

const folder = mkdtempSync(join(tmpdir(), "oma-project-setup-"));
process.env.OMA_DATA_DIR = folder;
process.env.OMA_AGENT_URL = "http://vm:8642";
process.env.OMA_AGENT_API_KEY = "fixture-agent-key";
const db = getDb();

beforeEach(() => db.exec("DELETE FROM users"));

after(() => {
  db.close();
  rmSync(folder, { recursive: true, force: true });
});

test("accepts a website, a GitHub repository, or both", () => {
  assert.deepEqual(validateProjectLinks({ websiteUrl: " example.com/docs ", githubUrl: "github.com/oma/test-repo/" }), {
    ok: true,
    setup: { status: "done", websiteUrl: "https://example.com/docs", githubUrl: "https://github.com/oma/test-repo" },
  });
  assert.deepEqual(validateProjectLinks({ websiteUrl: "http://localhost:3000", githubUrl: "" }), {
    ok: true,
    setup: { status: "done", websiteUrl: "http://localhost:3000/", githubUrl: null },
  });
  assert.equal(validateProjectLinks({ websiteUrl: "example.com", githubUrl: "https://github.com/openmarketing-agency" }).ok, true);
  assert.deepEqual(validateProjectLinks({ websiteUrl: "", githubUrl: "github.com/oma/test-repo/" }), {
    ok: true,
    setup: { status: "done", websiteUrl: null, githubUrl: "https://github.com/oma/test-repo" },
  });
});

test("requires a valid source and validates both links when supplied", () => {
  assert.deepEqual(validateProjectLinks({ websiteUrl: "", githubUrl: "" }), {
    ok: false,
    errors: { websiteUrl: "Enter a website URL or a GitHub repository URL." },
  });
  assert.deepEqual(validateProjectLinks({ websiteUrl: "", githubUrl: "github.com/oma" }), {
    ok: false,
    errors: { githubUrl: "Enter a GitHub repository URL or add a website." },
  });
  assert.deepEqual(validateProjectLinks({ websiteUrl: "https://user:pw@example.com", githubUrl: "github.com.evil.test/owner/repo" }), {
    ok: false,
    errors: {
      websiteUrl: "Enter a website URL, such as example.com.",
      githubUrl: "Enter a GitHub repository or organization URL.",
    },
  });
  assert.deepEqual(validateProjectLinks({ websiteUrl: "javascript:alert(1)", githubUrl: "github.com/oma/test-repo" }), {
    ok: false,
    errors: { websiteUrl: "Enter a website URL, such as example.com." },
  });
});

test("saves before delivery, retries the same questions and answers, and leaves the agent backup independent", async (t) => {
  const id = "fixture-project-owner";
  const oldAgent = { status: "ready", message: "Previous run", history: [] };
  db.prepare("INSERT INTO users (id, email, hashed_password, onboarding_state) VALUES (?, ?, ?, ?)")
    .run(id, "project@example.test", "fixture-hash", JSON.stringify(oldAgent));

  const setup = { status: "done" as const, websiteUrl: "https://example.com/", githubUrl: null };
  const changedSetup = { ...setup, websiteUrl: "https://different.example.test/" };
  const requests: { key: string | null; sessionId: string; input: string }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "http://vm:8642/v1/runs");
    const body = JSON.parse(String(options.body));
    const { setup: queued, delivery } = readProjectSetup(id)!;
    assert.deepEqual(queued, setup);
    const key = new Headers(options.headers).get("Idempotency-Key");
    assert.equal(key, delivery?.turnId);
    assert.equal(body.session_id, delivery?.sessionId);
    const [intro, answers] = body.input.split("\n\n");
    assert.equal(intro, "The user submitted these project setup questions and answers. Use the links as project context. A null answer means the user did not provide a GitHub link.");
    assert.deepEqual(JSON.parse(answers), [
      { question: "What is your website URL?", answer: "https://example.com/" },
      { question: "What is your GitHub URL?", answer: null },
    ]);
    requests.push({ key, sessionId: body.session_id, input: body.input });
    if (requests.length === 1) throw new TypeError("agent response lost");
    return Response.json({ run_id: "run_project" }, { status: 202 });
  });

  assert.equal(isProjectSetupComplete(readProjectSetup(id)), false);
  assert.deepEqual(await sendProjectSetup(id, setup), { ok: false });
  assert.deepEqual(readProjectSetup(id)?.setup, setup);
  assert.equal(isProjectSetupComplete(readProjectSetup(id)), false);
  assert.deepEqual(await sendProjectSetup(id, changedSetup), { ok: true });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(isProjectSetupComplete(readProjectSetup(id)), true);
  assert.equal(skipSavedProjectSetup(id), false);
  assert.deepEqual(await sendProjectSetup(id, setup), { ok: true });
  assert.equal(requests.length, 2);
  assert.deepEqual(readOnboarding(id).step, { status: "ready", message: "Previous run" });

  resetOnboarding(id);
  beginOnboarding(id);
  assert.equal(readOnboarding(id).step.status, "running");
  skipOnboarding(id);
  const current = readProjectSetup(id)!;
  assert.deepEqual(current.setup, setup);
  assert.deepEqual(current.agent, { status: "skipped", history: [] });
  assert.match(current.delivery?.runHandle ?? "", /^run_project[.]/);
});

test("existing local answers wait for an explicit send", async (t) => {
  const setup = { status: "done" as const, websiteUrl: "https://example.com/", githubUrl: "https://github.com/oma/repo" };
  db.prepare("INSERT INTO users (id, email, hashed_password, onboarding_state) VALUES (?, ?, ?, ?)")
    .run("saved", "saved@example.test", "fixture-hash", JSON.stringify({ kind: "project-setup", setup, agent: null }));
  const fetch = t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    assert.ok(JSON.parse(String(options.body)).input.includes("https://github.com/oma/repo"));
    return Response.json({ run_id: "run_existing" }, { status: 202 });
  });

  assert.deepEqual(readProjectSetup("saved")?.setup, setup);
  assert.equal(isProjectSetupComplete(readProjectSetup("saved")), false);
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(await sendProjectSetup("saved", setup), { ok: true });
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(isProjectSetupComplete(readProjectSetup("saved")), true);
});

test("forwards GitHub-only setup with a blank website answer", async (t) => {
  const result = validateProjectLinks({ websiteUrl: "", githubUrl: "github.com/oma/repo" });
  if (!result.ok) assert.fail("A repository URL can be the only project source");
  db.prepare("INSERT INTO users (id, email, hashed_password) VALUES (?, ?, ?)")
    .run("repo", "repo@example.test", "fixture-hash");
  const fetch = t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "http://vm:8642/v1/runs");
    const [intro, answers] = JSON.parse(String(options.body)).input.split("\n\n");
    assert.ok(intro.includes("A null answer means the user did not provide a website link."));
    assert.deepEqual(JSON.parse(answers), [
      { question: "What is your website URL?", answer: null },
      { question: "What is your GitHub URL?", answer: "https://github.com/oma/repo" },
    ]);
    return Response.json({ run_id: "run_repo" }, { status: 202 });
  });

  assert.deepEqual(await sendProjectSetup("repo", result.setup), { ok: true });
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(isProjectSetupComplete(readProjectSetup("repo")), true);
});

test("skipping setup starts no agent run", async (t) => {
  db.prepare("INSERT INTO users (id, email, hashed_password) VALUES (?, ?, ?)")
    .run("skipped", "skipped@example.test", "fixture-hash");
  const fetch = t.mock.method(globalThis, "fetch");

  assert.equal(skipSavedProjectSetup("skipped"), true);
  assert.equal(isProjectSetupComplete(readProjectSetup("skipped")), true);
  assert.deepEqual(await sendProjectSetup("skipped", {
    status: "done", websiteUrl: "https://example.com/", githubUrl: null,
  }), { ok: true });
  assert.equal(fetch.mock.callCount(), 0);
});

test("reads the saved setup run independently of aggregate gateway metrics", async (t) => {
  const id = "progress-owner";
  const setup = { status: "done" as const, websiteUrl: "https://example.com/", githubUrl: null };
  db.prepare("INSERT INTO users (id, email, hashed_password, onboarding_state) VALUES (?, ?, ?, ?)")
    .run(id, "progress@example.test", "fixture-hash", JSON.stringify({ kind: "project-setup", setup, agent: null }));
  let runStatus = 200;
  let healthStatus = 200;
  const checks = t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith("/v1/runs")) return Response.json({ run_id: "run_setup" }, { status: 202 });
    if (url.endsWith("/health/detailed")) {
      return Response.json({ active_agents: 0, api_server: { active_runs: 1 } }, { status: healthStatus });
    }
    assert.equal(url, "http://vm:8642/v1/runs/run_setup");
    return Response.json({ status: "running", tool: "web_search" }, { status: runStatus });
  });

  assert.deepEqual(await readDashboardAgentActivity(id), {
    gateway: { activeRuns: 1, activeAgents: 0 }, setup: { status: "not_sent" },
  });
  assert.equal(checks.mock.callCount(), 1);
  assert.deepEqual(await sendProjectSetup(id, setup), { ok: true });
  healthStatus = 503;
  assert.deepEqual(await readDashboardAgentActivity(id), { gateway: null, setup: { status: "running", tool: "web_search" } });
  runStatus = 404;
  assert.deepEqual(await readDashboardAgentActivity(id), { gateway: null, setup: { status: "unavailable" } });
  runStatus = 503;
  assert.deepEqual(await readDashboardAgentActivity(id), { gateway: null, setup: { status: "connection_lost" } });
  assert.deepEqual(await readDashboardAgentActivity("other-account"), { gateway: null, setup: null });
});

test("restarts a failed setup once, preserving its links and retrying a lost delivery with the same turn", async (t) => {
  const id = "retry-owner";
  const setup = { status: "done" as const, websiteUrl: "https://example.com/", githubUrl: null };
  const backup = { status: "skipped", history: [] };
  db.prepare("INSERT INTO users (id, email, hashed_password, onboarding_state) VALUES (?, ?, ?, ?)")
    .run(id, "retry@example.test", "fixture-hash", JSON.stringify({ kind: "project-setup", setup, agent: backup }));

  let oldStatus = "running";
  let statusCode = 200;
  const submissions: { key: string | null; input: string; session: string }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    if (url.endsWith("/runs/run_original")) return Response.json({ status: oldStatus }, { status: statusCode });
    assert.equal(url, "http://vm:8642/v1/runs");
    const body = JSON.parse(String(options.body));
    submissions.push({ key: new Headers(options.headers).get("idempotency-key"), input: body.input, session: body.session_id });
    if (submissions.length === 2) throw new TypeError("Lost setup response");
    return Response.json({ run_id: submissions.length === 1 ? "run_original" : "run_retry" }, { status: 202 });
  });

  assert.deepEqual(await sendProjectSetup(id, setup), { ok: true });
  assert.match((await retrySavedProjectSetup(id)).error ?? "", /after a failed or cancelled run/);
  oldStatus = "completed";
  assert.match((await retrySavedProjectSetup(id)).error ?? "", /after a failed or cancelled run/);
  statusCode = 503;
  assert.match((await retrySavedProjectSetup(id)).error ?? "", /verify the last setup run/);
  assert.equal(submissions.length, 1);

  statusCode = 200;
  oldStatus = "failed";
  const results = await Promise.all([retrySavedProjectSetup(id), retrySavedProjectSetup(id)]);
  assert.equal(results.filter(({ error }) => error?.includes("Your links are saved")).length, 1);
  assert.equal(submissions.length, 2);
  assert.notEqual(submissions[0].key, submissions[1].key);
  assert.notEqual(submissions[0].session, submissions[1].session);
  assert.equal(submissions[0].input, submissions[1].input);
  assert.equal(readProjectSetup(id)?.delivery?.runHandle, undefined);

  assert.deepEqual(await retrySavedProjectSetup(id), {});
  assert.deepEqual(submissions[2], submissions[1]);
  const saved = readProjectSetup(id);
  assert.deepEqual(saved?.setup, setup);
  assert.deepEqual(saved?.agent, backup);
  assert.match(saved?.delivery?.runHandle ?? "", /^run_retry[.]/);
});
