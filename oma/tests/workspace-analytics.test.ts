/** Exercises live analytics aggregation, scoped SQLite persistence, and regeneration recovery. */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { getDb, sqliteSchemaVersion } from "../lib/db";
import { analyticsLibrary } from "../lib/analytics-library";
import spec from "../lib/server/analytics-library.spec.json";
import { analyticsProgramExample, validateAnalyticsProgram } from "../lib/server/analytics-program";
import { generateAnalytics, queryAnalytics, readAnalytics, requireAnalyticsCampaign } from "../lib/server/analytics";
import { analyticsQueryResult, summarizeAnalytics } from "../lib/server/analytics-data";
import type { CampaignProgressSnapshot } from "../lib/server/campaign-progress";

const revision = "a".repeat(64);
const now = Date.UTC(2026, 10, 24, 12);
const completedAt = (now - 3_600_000) / 1000;
const task = { id: "task", title: "Private brief", assignee: "", status: "done",
  createdAt: null, startedAt: null, completedAt, summary: "", failure: "" };
const schedule = { id: "job", agent: "", name: "Private job", schedule: "", state: "",
  nextRun: "", lastRun: "", lastStatus: "ok" };

test("analytics counts only observed sources and task completions in the UTC window", () => {
  const ready: CampaignProgressSnapshot = {
    board: { state: "ready", tasks: [
      task, { ...task, status: "review" }, { ...task, completedAt: now / 1000 + 1 },
      { ...task, completedAt: completedAt - 28 * 86_400 }, { ...task, completedAt: null },
    ] },
    schedule: { state: "partial", jobs: [schedule] },
    publications: { state: "ready", items: [{ id: "post", status: "published", platform: "example", account: "" }], skipped: 1 },
  };
  const data = summarizeAnalytics(ready, now);
  assert.deepEqual(data.tasks.rows.map(({ count }) => count), [0, 0, 1, 4]);
  assert.ok(data.tasks.available && data.schedules.available && data.publications.available);
  assert.equal(data.publications.rows[3].count, 1);
  assert.ok(data.schedules.partial && data.publications.partial);
  assert.deepEqual(data.timeline.at(-1), { label: "2026-11-24", count: 1 });
  assert.equal(data.timeline.slice(0, -1).reduce((sum, day) => sum + day.count, 0), 0);

  const recent = analyticsQueryResult(data, "7d");
  assert.equal(recent.timeline.labels.length, 7);
  assert.equal(recent.timeline.counts.at(-1), 1);
  assert.match(recent.schedules.note, /Some records unavailable/);
  assert.equal(analyticsQueryResult(data, "28d").timeline.labels.length, 28);
  const empty = analyticsQueryResult(summarizeAnalytics({
    board: { state: "unconfigured" }, schedule: { state: "ready", jobs: [] }, publications: { state: "unavailable" },
  }, now), "7d");
  assert.equal(empty.tasks.total, null);
  assert.equal(empty.schedules.total, 0);
  assert.equal(empty.timeline.counts.length, 0);
});

test("the OpenUI renderer and server share a spec and accept only live read-only programs", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(analyticsLibrary.toSpec())), spec);
  assert.equal(validateAnalyticsProgram(analyticsProgramExample), analyticsProgramExample);
  assert.throws(() => validateAnalyticsProgram(analyticsProgramExample.replace("workspace_activity", "unavailable_tool")));
  assert.throws(() => validateAnalyticsProgram(analyticsProgramExample.replace("{dateRange: $dateRange}", '{dateRange: $dateRange, campaignId: "other"}')));
  assert.throws(() => validateAnalyticsProgram(analyticsProgramExample.replace("activity.tasks.counts", "[10, 30]")), /bind displayed values/i);
  assert.throws(() => validateAnalyticsProgram(analyticsProgramExample + '\nchange = Mutation("write", {})'));
  assert.throws(() => validateAnalyticsProgram(analyticsProgramExample.replace('Column("Status", activity.schedules.labels, "primary")',
    'Column("Status", activity.schedules.labels, "link")')), /columns/i);
});

test("generation reads the selected campaign, saves its report, and keeps it when replacement fails", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "oma-analytics-"));
  const socket = join(dir, "ws");
  t.mock.method(Date, "now", () => now);
  const env = { OMA_DATA_DIR: dir, OMA_WORKSPACE_SOCKET: socket };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);

  // An existing installation upgrades without changing its account or setup state.
  const oldDb = new DatabaseSync(join(dir, "oma.sqlite"));
  oldDb.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, onboarding_state TEXT);
    INSERT INTO users VALUES ('owner', '{"completed":true}');
    PRAGMA user_version = 7;
  `);
  oldDb.close();
  const db = getDb();
  assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, sqliteSchemaVersion);
  assert.equal(db.prepare("SELECT onboarding_state FROM users").get()?.onboarding_state, '{"completed":true}');

  const campaign = {
    name: "Campaign", description: "", version: "", orchestrator: "", agentIds: [],
    goals: [], plans: [], board: "", playbookId: "strategy",
  };
  const source = analyticsProgramExample;
  let taskCount = 1;
  let sent: Record<string, unknown> = {};
  let invalid = 0;
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const paths: string[] = [];
  const server = createServer(async (request, response) => {
    paths.push(request.url ?? "");
    if (request.url === "/workspace") {
      response.end(JSON.stringify({
        brands: [], agents: [], skipped: 0,
        playbooks: [{ id: "strategy", name: "Strategy", description: "", strategy: "", brandId: "", revision }],
        campaigns: [{ ...campaign, id: "seo" }, { ...campaign, id: "other", playbookId: "other-strategy" }],
      }));
    } else if (request.url === "/workspace/campaigns/seo/progress") {
      response.end(JSON.stringify({
        board: { state: "ready", tasks: Array.from({ length: taskCount }, () => task) },
        schedule: { state: "ready", jobs: [schedule] },
      }));
    } else if (request.url === "/workspace/campaigns/seo/publications?limit=6") {
      response.end(JSON.stringify({ campaign_id: "seo", publications: [] }));
    } else if (request.url === "/workspace/analytics") {
      let body = "";
      for await (const chunk of request) body += chunk;
      sent = JSON.parse(body);
      started.resolve();
      await release.promise;
      response.end(JSON.stringify(invalid-- > 0 ? "incomplete program" : source));
    } else {
      response.writeHead(404).end(JSON.stringify({ message: "Not found" }));
    }
  });
  t.after(async () => {
    release.resolve();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(socket, resolve));

  const key = { userId: "owner", id: "seo" };
  await requireAnalyticsCampaign(key.id);
  await requireAnalyticsCampaign("other");
  await assert.rejects(requireAnalyticsCampaign("strategy"), { status: 404 });
  db.prepare("INSERT INTO workspace_analytics (user_id, scope, target_id, layout, generated_at) VALUES (?, ?, ?, ?, ?)")
    .run(key.userId, "playbooks", key.id, JSON.stringify(source), now);
  assert.deepEqual(readAnalytics(key), { report: null, generating: false });

  const first = generateAnalytics(key);
  try {
    await Promise.race([started.promise, first]);
    assert.equal(readAnalytics(key).generating, true);
    await assert.rejects(generateAnalytics(key), { status: 409 });
  } finally {
    release.resolve();
  }
  const saved = await first;
  assert.equal(saved.report?.source, source);
  assert.equal(sent.targetId, "seo");
  assert.deepEqual(sent.campaignIds, ["seo"]);
  assert.equal(sent.scope, "campaigns");
  assert.match(String(sent.prompt), /OpenUI Lang/);
  assert.deepEqual(sent.snapshot, await queryAnalytics(key.id, "28d"));
  assert.doesNotMatch(JSON.stringify(sent), /Private brief|Private job/);
  assert.equal(readAnalytics({ ...key, userId: "other-id" }).report, null);
  assert.equal(readAnalytics({ ...key, id: "other" }).report, null);

  taskCount++;
  assert.deepEqual(readAnalytics(key).report, saved.report);
  assert.equal((await queryAnalytics(key.id, "7d")).timeline.counts.at(-1), 2);
  assert.equal(paths.filter((path) => path === "/workspace/analytics").length, 1);
  assert.ok(!paths.some((path) => path.startsWith("/workspace/campaigns/other/")));

  invalid = 2;
  await assert.rejects(generateAnalytics(key), { status: 502, message: /invalid OpenUI dashboard/ });
  assert.deepEqual(readAnalytics(key).report, saved.report);
  assert.equal(readAnalytics(key).generating, false);

  invalid = 1;
  db.prepare("UPDATE workspace_analytics SET layout = ? WHERE user_id = ? AND scope = 'campaigns' AND target_id = ?")
    .run('{"title":"Old dashboard"}', key.userId, key.id);
  assert.equal(readAnalytics(key).report, null);
  const replacement = await generateAnalytics(key);
  assert.equal(replacement.report?.source, source);
  assert.match(String(sent.prompt), /Correct the following validation issue/);
});
