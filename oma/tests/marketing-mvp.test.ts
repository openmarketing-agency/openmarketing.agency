import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { getDb } from "../lib/db";
import { advanceCampaign } from "../lib/server/marketing/campaign";
import { parseWorkspaceDocument } from "../lib/server/marketing/onboarding";
import {
  beginTurn, briefSchema, claimCampaign, commitCampaign, disconnectCampaign, finishTurn,
  queueCampaign, setPaused, storeRunId, workspace, type Campaign,
} from "../lib/server/marketing/state";

const brief = briefSchema.parse({
  brand: { name: "Northstar", audience: "Small shops", voice: "Direct", assets: [] },
  knowledge: ["The business publishes a monthly guide."],
  playbook: { title: "Search growth", goal: "Find new topics", property: "sc-domain:example.com", approach: "Review search queries." },
});

test("saves a validated model document using only the property authorized by the owner", () => {
  const generated = { ...brief, playbook: { ...brief.playbook, property: "sc-domain:other.test" } };
  assert.deepEqual(parseWorkspaceDocument(`Here is the document:\n${JSON.stringify(generated)}\nDone.`, brief.playbook.property), brief);
  assert.equal(parseWorkspaceDocument(JSON.stringify(generated), "https://name:secret@example.com/"), undefined);
  assert.equal(parseWorkspaceDocument("An unfinished response"), undefined);
});

test("persists onboarding and activates one leased campaign, with pause and reconnect recovery", () => {
  process.env.OMA_DATA_DIR = mkdtempSync(join(tmpdir(), "oma-marketing-"));
  const existing = new DatabaseSync(join(process.env.OMA_DATA_DIR, "oma.sqlite"));
  existing.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, hashed_password TEXT) STRICT;
    INSERT INTO users VALUES ('owner', 'owner@example.test', 'unused');
    PRAGMA user_version = 1;
  `);
  existing.close();
  const db = getDb();
  assert.equal(db.prepare("SELECT email FROM users WHERE id = 'owner'").get()?.email, "owner@example.test");
  const turn = beginTurn("owner", "I want SEO help", "chat").pending!;
  assert.throws(() => beginTurn("owner", "duplicate", "chat"));
  storeRunId("owner", turn.id, "run_current");
  finishTurn("owner", { ...turn, id: "stale" }, { message: "wrong run" });
  assert.equal(workspace("owner").onboarding?.pending?.runId, "run_current");
  finishTurn("owner", turn, { message: "What business are we helping?" });
  assert.deepEqual(workspace("owner").onboarding?.messages.map(({ role }) => role), ["user", "assistant"]);
  assert.equal(workspace("another-user").onboarding, undefined);
  const finalize = beginTurn("owner", "Save setup", "finalize", brief.playbook.property).pending!;
  finishTurn("owner", finalize, { brief });
  assert.equal(workspace("owner").campaign?.brief.playbook.property, "sc-domain:example.com");
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
  queueCampaign("owner");
  assert.ok(claimCampaign(Date.now()));
  disconnectCampaign("owner");
  assert.equal(workspace("owner").campaign?.status, "waiting");
});

test("connected Search Console starts a bounded researcher, writer and verifier cycle", async () => {
  const starts: { profile: string; key: string; input: string }[] = [];
  let connected = false;
  let campaign: Campaign = { brief, status: "waiting" };
  const deps: Parameters<typeof advanceCampaign>[1] = {
    account: async () => connected ? "owned-account" : undefined,
    evidence: async (id, property) => {
      assert.equal(id, "owned-account");
      assert.equal(property, brief.playbook.property);
      return "search query evidence";
    },
    start: async (profile, key, input) => {
      starts.push({ profile, key, input });
      return { run_id: profile, status: "running" };
    },
    get: async (profile) => ({ run_id: profile, status: "completed", output: `Result from ${profile}` }),
    stillRunning: () => true,
  };
  assert.equal((await advanceCampaign(campaign, deps)).campaign.status, "waiting");
  assert.equal(starts.length, 0);
  connected = true;
  for (let i = 0; i < 7; i++) campaign = (await advanceCampaign(campaign, deps)).campaign;
  assert.deepEqual(starts.map(({ profile }) => profile), ["oma-seo-researcher", "oma-seo-writer", "oma-seo-verifier"]);
  assert.equal(new Set(starts.map(({ key }) => key)).size, 3);
  assert.match(starts[0].input, /search query evidence/);
  assert.match(starts[1].input, /Result from oma-seo-researcher/);
  assert.match(starts[2].input, /Result from oma-seo-writer/);
  assert.equal(campaign.status, "active");
  assert.match(campaign.report!.review, /Result from oma-seo-verifier/);
});
