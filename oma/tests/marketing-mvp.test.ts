import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { getDb } from "../lib/db";
import { draftSchema, type Source } from "../lib/marketing-playbook";
import { advanceCampaign } from "../lib/server/marketing/campaign";
import { parseWorkspaceDocument } from "../lib/server/marketing/onboarding";
import {
  activateCampaign, beginTurn, claimCampaign, commitCampaign, disconnectCampaign, finishTurn,
  queueCampaign, setPaused, storeRunId, workspace, type Campaign,
} from "../lib/server/marketing/state";

const draft = draftSchema.parse({
  brand: { name: "Northstar", audience: "Small shops", voice: "Direct", assets: [] },
  knowledge: ["The product launches next month."],
  playbook: {
    title: "Launch announcement", goal: "Introduce the product", approach: "Prepare an email sequence.",
    steps: [
      { profile: "oma-campaign-strategist", role: "Launch Planner", task: "Plan the sequence." },
      { profile: "oma-campaign-creator", role: "Email Copywriter", task: "Draft the first two emails." },
    ],
    sources: [],
  },
});

const analytics: Source = { toolkit: "google_analytics", resource: "123456789" };
const search: Source = { toolkit: "google_search_console", resource: "sc-domain:example.com" };

test("accepts a non-SEO playbook and rejects arbitrary profiles and toolkits", () => {
  assert.deepEqual(parseWorkspaceDocument(`Review:\n${JSON.stringify(draft)}\nDone.`), draft);
  const { playbook } = draft;
  assert.equal(parseWorkspaceDocument(JSON.stringify({ ...draft, playbook: {
    ...playbook, steps: [{ ...playbook.steps[0], profile: "default" }],
  } })), undefined);
  assert.equal(parseWorkspaceDocument(JSON.stringify({ ...draft, playbook: {
    ...playbook, sources: ["gmail"],
  } })), undefined);
  assert.equal(parseWorkspaceDocument("An unfinished response"), undefined);
});

test("migrates saved SEO work and requires owner approval of a new playbook and its resources", () => {
  process.env.OMA_DATA_DIR = mkdtempSync(join(tmpdir(), "oma-marketing-"));
  const existing = new DatabaseSync(join(process.env.OMA_DATA_DIR, "oma.sqlite"));
  existing.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, hashed_password TEXT) STRICT;
    INSERT INTO users VALUES ('owner', 'owner@example.test', 'unused'), ('legacy', 'legacy@example.test', 'unused');
    CREATE TABLE marketing_workspaces (
      user_id TEXT PRIMARY KEY REFERENCES users(id), onboarding TEXT NOT NULL, campaign TEXT,
      next_at INTEGER, lease_until INTEGER NOT NULL DEFAULT 0, lease_token TEXT
    ) STRICT;
    PRAGMA user_version = 2;
  `);
  existing.prepare("INSERT INTO marketing_workspaces VALUES ('legacy', ?, ?, NULL, 100, 'old-lease')")
    .run(JSON.stringify({ session: "previous-session", messages: [], pending: { kind: "finalize", property: search.resource } }),
      JSON.stringify({
        brief: { ...draft, playbook: { title: "Discover content", goal: "Find topics", approach: "Review queries", property: search.resource } },
        status: "paused", work: { stage: "writer" },
        report: { draft: "Old draft", review: "Old review", property: search.resource, finishedAt: 1000 },
      }));
  existing.close();
  const db = getDb();
  assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, 3);
  assert.equal(workspace("legacy").onboarding?.pending, undefined);
  const migrated = workspace("legacy").campaign!;
  assert.equal(migrated.status, "paused");
  assert.equal(migrated.work, undefined);
  assert.deepEqual(migrated.brief.playbook.sources, [search]);
  assert.equal(migrated.brief.playbook.steps[1].profile, "oma-campaign-creator");
  assert.equal(migrated.report?.outputs[0].text, "Old draft");

  const turn = beginTurn("owner", "Help with my product launch", "chat").pending!;
  assert.throws(() => beginTurn("owner", "duplicate", "chat"));
  storeRunId("owner", turn.id, "run_current");
  finishTurn("owner", { ...turn, id: "stale" }, { message: "wrong run" });
  assert.equal(workspace("owner").onboarding?.pending?.runId, "run_current");
  finishTurn("owner", turn, { message: "What business are we helping?" });
  assert.deepEqual(workspace("owner").onboarding?.messages.map(({ role }) => role), ["user", "assistant"]);
  const finalize = beginTurn("owner", "Generate playbook", "finalize").pending!;
  finishTurn("owner", finalize, { brief: { ...draft, playbook: { ...draft.playbook, sources: [analytics.toolkit] } } });
  assert.equal(claimCampaign(Date.now()), undefined);
  assert.ok(activateCampaign("another-user", finalize.id, {}).requestError);
  assert.ok(activateCampaign("owner", "stale", {}).requestError);
  assert.ok(activateCampaign("owner", finalize.id, { [analytics.toolkit]: "invalid" }).requestError);
  const active = activateCampaign("owner", finalize.id, { [analytics.toolkit]: analytics.resource, [search.toolkit]: search.resource });
  assert.deepEqual(active.campaign?.brief.playbook.sources, [analytics]);

  const claim = claimCampaign(Date.now())!;
  assert.equal(claim.campaign.status, "waiting");
  assert.equal(claimCampaign(Date.now()), undefined);
  setPaused("owner", true);
  commitCampaign("owner", claim.token, { ...claim.campaign, status: "running" }, Date.now());
  assert.equal(workspace("owner").campaign?.status, "paused");
  assert.equal(claimCampaign(Date.now()), undefined);
  setPaused("owner", false);
  const resume = claimCampaign(Date.now())!;
  commitCampaign("owner", resume.token, resume.campaign, Date.now() + 60_000);
  queueCampaign("owner", search.toolkit);
  assert.equal(claimCampaign(Date.now()), undefined);
  queueCampaign("owner", analytics.toolkit);
  const running = claimCampaign(Date.now())!;
  commitCampaign("owner", running.token, { ...running.campaign, status: "running" }, Date.now() + 60_000);
  disconnectCampaign("owner", search.toolkit);
  assert.equal(workspace("owner").campaign?.status, "running");
  disconnectCampaign("owner", analytics.toolkit);
  assert.equal(workspace("owner").campaign?.status, "waiting");
});

test("runs a channel-specific team with no integrations and hands off prior outputs", async () => {
  const starts: { profile: string; key: string; input: string }[] = [];
  let campaign: Campaign = { brief: { ...draft, playbook: { ...draft.playbook, sources: [] } }, status: "waiting" };
  const deps: Parameters<typeof advanceCampaign>[1] = {
    account: async () => assert.fail("Unexpected Composio request"),
    evidence: async () => assert.fail("Unexpected evidence request"),
    start: async (profile, key, input) => {
      starts.push({ profile, key, input });
      return { run_id: profile, status: "running" };
    },
    get: async (profile) => ({ run_id: profile, status: "completed", output: `Result from ${profile}` }),
    stillRunning: () => true,
  };
  for (let i = 0; i < 5; i++) campaign = (await advanceCampaign(campaign, deps)).campaign;
  assert.deepEqual(starts.map(({ profile }) => profile), ["oma-campaign-strategist", "oma-campaign-creator"]);
  assert.equal(new Set(starts.map(({ key }) => key)).size, 2);
  assert.match(starts[1].input, /Result from oma-campaign-strategist/);
  assert.equal(campaign.status, "active");
  assert.deepEqual(campaign.report?.outputs.map(({ role }) => role), ["Launch Planner", "Email Copywriter"]);
});

test("waits for all required sources and drops partial work if one account disconnects", async () => {
  const sources = [analytics, search];
  const evidence: Source[] = [];
  let campaign: Campaign = { brief: { ...draft, playbook: { ...draft.playbook, sources } }, status: "waiting" };
  let connected = false;
  const deps: Parameters<typeof advanceCampaign>[1] = {
    account: async (toolkit) => toolkit === analytics.toolkit || connected ? `owned-${toolkit}` : undefined,
    evidence: async (account, source) => {
      assert.equal(account, `owned-${source.toolkit}`);
      evidence.push(source);
      return "Scoped report";
    },
    start: async () => ({ run_id: "run_started", status: "running" }),
    get: async () => assert.fail("Should not read the run after a source disconnects"),
    stillRunning: () => true,
  };
  assert.match((await advanceCampaign(campaign, deps)).campaign.notice!, /Google Search Console/);
  assert.deepEqual(evidence, []);
  connected = true;
  campaign = (await advanceCampaign(campaign, deps)).campaign;
  assert.deepEqual(evidence, sources);
  campaign = (await advanceCampaign(campaign, deps)).campaign;
  assert.equal(campaign.work?.runId, "run_started");
  connected = false;
  campaign = (await advanceCampaign(campaign, deps)).campaign;
  assert.equal(campaign.status, "waiting");
  assert.equal(campaign.work, undefined);
});
