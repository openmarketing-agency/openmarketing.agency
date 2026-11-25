/** Exercises live analytics aggregation, immutable SQLite layouts, and live observation binding. */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AnalyticsGenerationDetails } from "../components/analytics-generation-details";
import { getDb, sqliteSchemaVersion } from "../lib/db";
import { analyticsLibrary } from "../lib/analytics-library";
import spec from "../lib/server/analytics-library.spec.json";
import { validateAnalyticsProgram } from "../lib/server/analytics-program";
import { generateAnalytics, queryLegacyAnalytics, readAnalytics, requireAnalyticsCampaign } from "../lib/server/analytics";
import { analyticsQueryResult, summarizeAnalytics } from "../lib/server/analytics-data";
import { queryCampaignObservations } from "../lib/server/campaign-observations";
import { observationDashboard } from "../lib/observation-dashboard";
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
  assert.equal(validateAnalyticsProgram(observationDashboard), observationDashboard);
  assert.throws(() => validateAnalyticsProgram(observationDashboard.replace("campaign_observations", "unavailable_tool")));
  assert.throws(() => validateAnalyticsProgram(observationDashboard.replace("{dateRange: $dateRange}", '{dateRange: $dateRange, campaignId: "other"}')));
  assert.throws(() => validateAnalyticsProgram(observationDashboard.replace("activity.sources.counts", "[10, 30]")), /bind displayed values/i);
  assert.throws(() => validateAnalyticsProgram(observationDashboard + '\nchange = Mutation("write", {})'));
  assert.throws(() => validateAnalyticsProgram(observationDashboard.replace('Column("Source", activity.observations.source, "primary")',
    'Column("Source", activity.observations.source, "link")')), /columns/i);
  assert.throws(() => validateAnalyticsProgram(observationDashboard.replace('activity.observations.value, "text"',
    'activity.observations.value, "number"')), /columns/i);
});

test("generation details show the saved inputs and escape agent-generated source", () => {
  const markup = renderToStaticMarkup(createElement(AnalyticsGenerationDetails, {
    report: {
      source: 'root = Dashboard("<b>Example</b>")',
      generatedAt: now,
      generation: { systemPrompt: "Build the dashboard.", userMessage: '{}\n\nCampaign ID: seo' },
    },
  }));
  assert.match(markup, /Generation details/);
  assert.match(markup, /Campaign observations/);
  assert.match(markup, /Workspace activity/);
  assert.match(markup, /System prompt.*Build the dashboard\./s);
  assert.match(markup, /User message.*Campaign ID: seo/s);
  assert.match(markup, /Agent-generated OpenUI source.*&lt;b&gt;Example&lt;\/b&gt;/s);
  assert.doesNotMatch(markup, /<b>Example<\/b>/);
  assert.match(renderToStaticMarkup(createElement(AnalyticsGenerationDetails, {
    report: { source: "root = Dashboard", generatedAt: now },
  })), /Prompts were unavailable.*Agent-generated OpenUI source/s);
});

test("generation saves the layout once and reads revised observations from the selected campaign", async (t) => {
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
  const source = observationDashboard;
  let taskCount = 1;
  let sent: Record<string, unknown> = {};
  let userMessage = "";
  let recordedValue = 12;
  let invalid = 1;
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
    } else if (request.url?.startsWith("/workspace/campaigns/seo/analytics?")) {
      const filters = new URL(request.url, "http://localhost").searchParams;
      assert.equal(filters.get("start"), "2026-11-18T00:00:00.000Z");
      assert.equal(filters.get("end"), "2026-11-25T00:00:00.000Z");
      assert.equal(filters.get("limit"), "100");
      response.end(JSON.stringify({
        campaign_id: "seo",
        observations: recordedValue ? [{
          id: 1, source: "google-search-console", metric: "clicks", account: "sc-domain:example.test",
          value: recordedValue, unit: "count", dimensions: { country: "NP" },
          period_start: "2026-11-23T00:00:00.000000+00:00", period_end: "2026-11-24T00:00:00.000000+00:00",
          collected_at: "2026-11-24T10:00:00.000000+00:00",
        }] : [],
        last_collected_at: "2026-11-24T10:00:00.000000+00:00", next_cursor: null,
      }));
    } else if (request.url === "/workspace/analytics") {
      let body = "";
      for await (const chunk of request) body += chunk;
      assert.equal(request.headers["x-oma-analytics-details"], "1");
      sent = JSON.parse(body);
      userMessage = "Generate the campaign analytics dashboard using the documented live query.\n\nCampaign ID: " + sent.targetId;
      started.resolve();
      await release.promise;
      const output = invalid-- > 0 ? "incomplete program" : source;
      response.end(JSON.stringify({ source: output, userMessage }));
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
  assert.equal(saved.report?.dataSource, "observations");
  assert.deepEqual(saved.report?.generation, { systemPrompt: sent.prompt, userMessage });
  assert.equal(sent.targetId, "seo");
  assert.deepEqual(sent.campaignIds, ["seo"]);
  assert.equal(sent.scope, "campaigns");
  assert.match(String(sent.prompt), /OpenUI Lang/);
  assert.equal(sent.snapshot, undefined);
  assert.match(String(sent.prompt), /Correct the following validation issue/);
  assert.equal(paths.filter((path) => path === "/workspace/analytics").length, 2);
  assert.ok(!paths.some((path) => path.startsWith("/workspace/campaigns/seo/")));
  assert.doesNotMatch(JSON.stringify(sent), /Private brief|Private job/);
  assert.equal(readAnalytics({ ...key, userId: "other-id" }).report, null);
  assert.equal(readAnalytics({ ...key, id: "other" }).report, null);

  const firstData = await queryCampaignObservations(key.id, "7d");
  assert.deepEqual(firstData.observations.value, ["12 count"]);
  assert.deepEqual(firstData.observations.dimensions, ['{"country":"NP"}']);
  assert.deepEqual(firstData.sources.labels, ["Google Search Console"]);

  recordedValue = 26;
  const updated = await queryCampaignObservations(key.id, "7d");
  assert.deepEqual(updated.observations.value, ["26 count"]);
  assert.deepEqual(updated.sources, firstData.sources);
  assert.deepEqual(readAnalytics(key), saved);
  assert.deepEqual(await generateAnalytics(key), saved);
  assert.equal(paths.filter((path) => path === "/workspace/analytics").length, 2);

  recordedValue = 0;
  const empty = await queryCampaignObservations(key.id, "7d");
  assert.deepEqual(empty.observations.value, []);
  assert.equal(empty.observations.note, "No saved observations in this period.");

  const otherKey = { ...key, id: "other" };
  invalid = 2;
  await assert.rejects(generateAnalytics(otherKey), { status: 502, message: /invalid OpenUI dashboard/ });
  assert.deepEqual(readAnalytics(otherKey), { report: null, generating: false });
  assert.deepEqual(readAnalytics(key), saved);

  taskCount++;
  assert.equal((await queryLegacyAnalytics(key.id, "7d")).timeline.counts.at(-1), 2);
  db.prepare("UPDATE workspace_analytics SET layout = ? WHERE user_id = ? AND scope = 'campaigns' AND target_id = ?")
    .run(JSON.stringify(source), otherKey.userId, otherKey.id);
  const legacy = { report: { source, generatedAt: 0 }, generating: false };
  assert.deepEqual(readAnalytics(otherKey), legacy);
  assert.deepEqual(await generateAnalytics(otherKey), legacy);
  assert.equal(paths.filter((path) => path === "/workspace/analytics").length, 4);
});
