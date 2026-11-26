/** Exercises live analytics aggregation, saved SQLite layouts, and live observation binding. */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createParser, evaluateRoot, type LibrarySpec } from "@openuidev/lang-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AnalyticsGenerationDetails } from "../components/analytics-generation-details";
import { getDb, sqliteSchemaVersion } from "../lib/db";
import { analyticsLibrary } from "../lib/analytics-library";
import spec from "../lib/server/analytics-library.spec.json";
import { validateAnalyticsProgram } from "../lib/server/analytics-program";
import { generateAnalytics, queryAnalytics, queryLegacyAnalytics, readAnalytics, requireAnalyticsCampaign } from "../lib/server/analytics";
import { analyticsQueryResult, summarizeAnalytics } from "../lib/server/analytics-data";
import type { MeasurementField } from "../lib/server/campaign-observations";
import { observationDashboard, observationQueryStatement } from "../lib/observation-dashboard";
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
  assert.deepEqual(validateAnalyticsProgram(observationDashboard), { source: observationDashboard, measurementFields: [] });
  assert.throws(() => validateAnalyticsProgram(observationDashboard.replace("campaign_observations", "unavailable_tool")));
  // The live query has one valid form, so extra arguments are replaced instead of reaching the tool.
  const scoped = validateAnalyticsProgram(observationDashboard.replace("{dateRange: $dateRange}", '{dateRange: $dateRange, campaignId: "other"}'));
  assert.ok(scoped.source.includes(observationQueryStatement) && !scoped.source.includes("other"));
  assert.ok(validateAnalyticsProgram(observationDashboard.replace(", {}, 60)", ', {"sources": {"total": 0}}, 30)')).source.includes(observationQueryStatement));
  assert.throws(() => validateAnalyticsProgram(observationDashboard.replace("activity.sources.counts", "[10, 30]")), /bind the chart labels and values/i);
  assert.throws(() => validateAnalyticsProgram(observationDashboard + '\nchange = Mutation("write", {})'));
  assert.throws(() => validateAnalyticsProgram(observationDashboard.replace('Column("Source", activity.observations.source, "primary")',
    'Column("Source", activity.observations.source, "link")')), /columns/i);
  assert.throws(() => validateAnalyticsProgram(observationDashboard.replace('activity.observations.value, "text"',
    'activity.observations.value, "number"')), /columns/i);
});

function measurementDashboard(id: string, pageId?: string) {
  const field = `activity.measurements.${id}`;
  const chart = observationDashboard.replace('Kpi("Observations shown", activity.sources.total, "number")',
    `Kpi("Latest clicks", ${field}.latest, "number")`)
    .replace(/Card\("Observations by source"[^\n]+/,
      `Card("Clicks by period", [Bars(${field}.labels, [Series("Clicks", ${field}.values)], "number")], "full", ${field}.note)], 320)`);
  if (!pageId) return chart;
  const page = `activity.measurements.${pageId}`;
  return chart.replace("[summary, coverage, records]", "[summary, coverage, pages, records]") +
    `\npages = Row([Card("First saved page", [Table([Column("Period", ${page}.labels, "primary"), Column("Page", ${page}.display, "text")])], "full", ${page}.note)])`;
}

test("OpenUI uses only offered measurements with matching chart labels and values", () => {
  const field = { id: "m1111111111111111", source: "search", account: "website", metric: "search",
    unit: "count", numeric: true, path: ["totals", "clicks"] };
  const other = { ...field, id: "m2222222222222222", path: ["totals", "impressions"] };
  const source = measurementDashboard(field.id);
  assert.deepEqual(validateAnalyticsProgram(source, [field, other]), { source, measurementFields: [field] });
  assert.throws(() => validateAnalyticsProgram(source, []), /bind displayed values/i);
  assert.throws(() => validateAnalyticsProgram(source, [{ ...field, numeric: false }]), /bind displayed values/i);
  assert.throws(() => validateAnalyticsProgram(source.replace(`${field.id}.values`, `${other.id}.values`), [field, other]), /same query dataset/);
  assert.throws(() => validateAnalyticsProgram(observationDashboard, [field]), /show actual values/i);
  const text = observationDashboard.replace(/Card\("Observations by source"[^\n]+/,
    `Card("Variant", [Table([Column("Period", activity.measurements.${field.id}.labels, "primary"), Column("Variant", activity.measurements.${field.id}.display, "text")])], "full", activity.measurements.${field.id}.note)], 320)`);
  const textField = { ...field, numeric: false, path: ["variant"] };
  assert.deepEqual(validateAnalyticsProgram(text, [textField]).measurementFields, [textField]);
  assert.throws(() => validateAnalyticsProgram(text.replace(`${field.id}.labels`, `${other.id}.labels`), [textField, other]), /same measurement ID/);
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
  let source = observationDashboard;
  let taskCount = 1;
  let sent: Record<string, unknown> = {};
  let measurement: MeasurementField;
  let pageField: MeasurementField;
  let userMessage = "";
  const rawValue = (clicks?: number) => ({ totals: { clicks, impressions: 250 }, rows: [{ "page/path": "/pricing", clicks: 2 }], active: false, rate: null });
  let recordedValue: ReturnType<typeof rawValue> | null = rawValue(12);
  let otherValue: ReturnType<typeof rawValue> | null = null;
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
    } else if (request.url?.match(/^\/workspace\/campaigns\/(seo|other)\/analytics\?/)) {
      const filters = new URL(request.url, "http://localhost").searchParams;
      const id = request.url.split("/")[3];
      const value = id === "seo" ? recordedValue : otherValue;
      assert.ok(["2026-11-18T00:00:00.000Z", "2026-10-28T00:00:00.000Z"].includes(filters.get("start") ?? ""));
      assert.equal(filters.get("end"), "2026-11-25T00:00:00.000Z");
      assert.equal(filters.get("limit"), "100");
      response.end(JSON.stringify({
        campaign_id: id,
        observations: value ? [{
          id: 1, source: "google-search-console", metric: "search_performance", account: "sc-domain:example.test",
          value, unit: "count", dimensions: { country: "NP" },
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
      const context = sent.observationContext as { observations: { value: unknown }[]; measurement_fields: MeasurementField[] };
      const clicks = context.measurement_fields.find((field) => field.path.join(".") === "totals.clicks");
      const page = context.measurement_fields.find((field) => field.path.join(".") === "rows.0.page/path");
      if (clicks && page) {
        measurement = clicks;
        pageField = page;
        source = measurementDashboard(clicks.id, page.id);
      }
      userMessage = `Generate the campaign analytics dashboard.\n\n${JSON.stringify(context)}\n\nCampaign ID: ${sent.targetId}`;
      started.resolve();
      await release.promise;
      const output = invalid-- > 0 ? sent.targetId === "seo" && recordedValue ? observationDashboard : "incomplete program" : source;
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
  assert.match(String(sent.prompt), /Show actual values/);
  const [sample] = JSON.parse(userMessage.split("\n\n")[1]).observations;
  assert.deepEqual(sample.value, rawValue(12));
  assert.deepEqual(sample.dimensions, { country: "NP" });
  assert.equal(paths.filter((path) => path === "/workspace/analytics").length, 2);
  assert.equal(paths.filter((path) => path.startsWith("/workspace/campaigns/seo/analytics?start=2026-10-28")).length, 1);
  assert.doesNotMatch(JSON.stringify(sent), /Private brief|Private job/);
  assert.equal(readAnalytics({ ...key, userId: "other-id" }).report, null);
  assert.equal(readAnalytics({ ...key, id: "other" }).report, null);

  const firstData = await queryAnalytics(key, "7d");
  const measurementId = measurement!.id;
  const pageId = pageField!.id;
  assert.deepEqual(firstData.observations.value, [`${JSON.stringify(rawValue(12))} count`]);
  assert.deepEqual(firstData.observations.dimensions, ['{"country":"NP"}']);
  assert.deepEqual(firstData.sources.labels, ["Google Search Console"]);
  assert.deepEqual(Object.keys(firstData.measurements), [measurementId, pageId]);
  assert.deepEqual(firstData.measurements[measurementId].values, [12]);
  assert.match(firstData.measurements[measurementId].labels[0], /2026-11-23.*NP/);
  assert.equal(firstData.measurements[measurementId].latest, 12);
  assert.deepEqual(firstData.measurements[pageId].display, ["/pricing"]);

  const library = spec as LibrarySpec;
  const program = createParser(library.schema!, library.root).parse(source);
  const evaluated = evaluateRoot(program, {
    ctx: { getState: () => "7d", resolveRef: (name) => name === "activity" ? firstData : null },
    library: analyticsLibrary, store: null,
  });
  const rendered = JSON.stringify(evaluated);
  assert.match(rendered, /"label":"Latest clicks","value":12/);
  assert.match(rendered, /"name":"Clicks","values":\[12\]/);
  assert.match(rendered, /"label":"Page","values":\["\/pricing"\]/);

  recordedValue = rawValue(0);
  const updated = await queryAnalytics(key, "28d");
  assert.deepEqual(updated.measurements[measurementId].values, [0]);
  assert.equal(updated.measurements[measurementId].latest, 0);
  assert.deepEqual(updated.sources, firstData.sources);
  assert.deepEqual(readAnalytics(key), saved);
  assert.deepEqual(await generateAnalytics(key), saved);
  assert.equal(paths.filter((path) => path === "/workspace/analytics").length, 2);

  recordedValue = rawValue();
  const missing = await queryAnalytics(key, "7d");
  assert.deepEqual(missing.measurements[measurementId].values, [null]);
  assert.equal(missing.measurements[measurementId].latest, null);

  recordedValue = null;
  const empty = await queryAnalytics(key, "7d");
  assert.deepEqual(empty.observations.value, []);
  assert.equal(empty.observations.note, "No saved observations in this period.");
  assert.deepEqual(empty.measurements[measurementId].values, []);
  assert.equal(empty.measurements[measurementId].latest, null);

  const otherKey = { ...key, id: "other" };
  // An empty sample is refused before the agent is asked, so no generic layout is saved.
  await assert.rejects(generateAnalytics(otherKey), { status: 409, message: /No observations have been collected/ });
  assert.deepEqual(readAnalytics(otherKey), { report: null, generating: false });
  assert.equal(paths.filter((path) => path === "/workspace/analytics").length, 2);

  otherValue = rawValue(5);
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

  // Regenerating without records keeps the saved dashboard instead of replacing it with the example.
  await assert.rejects(generateAnalytics(key, true), { status: 409 });
  assert.deepEqual(readAnalytics(key), saved);
  assert.equal(paths.filter((path) => path === "/workspace/analytics").length, 4);

  recordedValue = rawValue(18);
  invalid = 2;
  await assert.rejects(generateAnalytics(key, true), { status: 502 });
  assert.deepEqual(readAnalytics(key), saved);
  const regenerated = await generateAnalytics(key, true);
  assert.notDeepEqual(regenerated.report?.generation, saved.report?.generation);
  assert.equal((await queryAnalytics(key, "7d")).measurements[measurementId].latest, 18);
});
