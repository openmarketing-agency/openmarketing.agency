/** Verifies that campaign views and tool scopes use the saved agent workspace records. */

import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CampaignKanban } from "../components/campaign-kanban";
import { CampaignLibrary } from "../components/campaign-library";
import { campaignAgentIds, campaignLifecycleLabel, CampaignAgents, CampaignOverview } from "../components/workspace-records";
import { type AgentWorkspace, type SavedCampaign } from "../lib/server/agent-workspace";

test("shows an empty campaign list when the agent has saved none", () => {
  const html = renderToStaticMarkup(createElement(CampaignLibrary, { saved: [] }));
  assert.match(html, /No campaigns yet/);
  assert.doesNotMatch(html, /href="\/campaigns\//);
});

test("separates unavailable workspace data from an empty campaign list", () => {
  const html = renderToStaticMarkup(createElement(CampaignLibrary, { error: "Could not reach oma-agent." }));
  assert.match(html, /Campaign workspace unavailable/);
  assert.match(html, /role="alert">Could not reach oma-agent\./);
  assert.doesNotMatch(html, /No campaigns yet/);
});

test("shows a single setup action and explains when saved links need a retry", () => {
  const html = renderToStaticMarkup(createElement(CampaignLibrary, { saved: [], setup: { needsRetry: true } }));
  assert.match(html, /Your project links are saved/);
  assert.match(html, /href="\/onboarding"[^>]*>Finish project setup/);
  assert.doesNotMatch(html, /href="\/chat"|Set up your project/);
});

test("lists an agent-saved campaign without a bundled fallback", () => {
  const html = renderToStaticMarkup(createElement(CampaignLibrary, {
    saved: [{ id: "seo", name: "Retail search", description: "", version: "", agentCount: 1 }],
  }));
  assert.match(html, /Retail search/);
  assert.match(html, /href="\/campaigns\/seo"/);
  assert.doesNotMatch(html, /href="\/campaigns\/social-media"|Mission owner/);
});

test("shows board task counts with the campaign lifecycle in the list", () => {
  const html = renderToStaticMarkup(createElement(CampaignLibrary, {
    saved: [{
      id: "seo", name: "Retail search", description: "", version: "", agentCount: 1, status: "Running",
      kanban: { state: "ready", counts: { done: 3, blocked: 1, ready: 0, running: 2 } },
    }],
  }));
  assert.match(html, />Running</);
  assert.match(html, /aria-label="Kanban task counts"/);
  assert.match(html, /2 in progress.*1 blocked.*3 done/);
  assert.doesNotMatch(html, /0 ready/);
});

test("distinguishes empty boards from unavailable, missing, and ambiguous boards", () => {
  for (const [status, message] of [
    [{ state: "ready", counts: {} }, "No tasks yet"],
    [{ state: "unconfigured" }, "No board configured"],
    [{ state: "unavailable" }, "Status unavailable"],
    [{ state: "missing" }, "Board not found"],
    [{ state: "ambiguous" }, "Board name matches multiple boards"],
  ] as const) {
    const html = renderToStaticMarkup(createElement(CampaignKanban, { status }));
    assert.ok(html.includes(message));
  }
});

const campaign: SavedCampaign = {
  id: "seo", name: "Retail search", description: "", version: "", playbookId: "",
  orchestrator: "seo__orchestrator", agentIds: [], goals: [], plans: [], board: "",
};
const workspace: AgentWorkspace = { campaigns: [campaign], agents: [], brands: [], playbooks: [], skipped: 0 };

test("distinguishes running, paused, and draft campaigns and keeps status in the header", () => {
  for (const [lifecycleState, expected] of [["resumed", "Running"], ["paused", "Paused"], ["pausing", "Pausing…"]]) {
    const installed = { ...campaign, installationState: "installed", lifecycleState };
    assert.equal(campaignLifecycleLabel(installed), expected);
    const overview = renderToStaticMarkup(createElement(CampaignOverview, { workspace, campaign: installed }));
    assert.doesNotMatch(overview, /<dt>Status<\/dt>|<dt>Installation<\/dt>/);
  }
  assert.equal(campaignLifecycleLabel(campaign), "Draft");
  assert.equal(campaignLifecycleLabel({ ...campaign, installationState: "installed" }), "Running");
  assert.equal(campaignLifecycleLabel({ ...campaign, installationState: "installing", lifecycleState: "resumed" }), "Setup incomplete");
});

test("leaves campaign details empty when records are absent", () => {
  const html = renderToStaticMarkup(createElement(CampaignOverview, { workspace, campaign }));
  assert.doesNotMatch(html, /<h2|<dt|<li/);
});

test("shows campaign agents and scheduled work in the dedicated roster", () => {
  const researcher = {
    id: "seo__researcher", campaignId: "seo", name: "Retail insights", description: "Reviews retailer search trends.", toolsets: ["web"],
    jobs: [{ name: "Review traffic", schedule: "Daily", timezone: "UTC", repeat: 2 }],
  };
  const data = { ...workspace, agents: [
    researcher,
    { ...researcher, id: "seo__orchestrator" },
    { ...researcher, id: "seo__writer", campaignId: "social-media" },
  ] };
  const declaredCampaign = { ...campaign, agentIds: ["seo__researcher", "seo__missing"] };
  const ids = campaignAgentIds(data, declaredCampaign);
  assert.deepEqual(ids, ["seo__researcher", "seo__missing", "seo__orchestrator"]);
  const html = renderToStaticMarkup(createElement(CampaignAgents, { workspace: data, campaign: declaredCampaign, ids }));
  assert.match(html, /href="\/workspace\/agents\/seo__researcher"/);
  assert.match(html, /Coordinator/);
  assert.match(html, /<strong>Review traffic<\/strong><span>Daily · UTC · 2 runs<\/span>/);
  assert.match(html, /<p>3 agents · 2 scheduled jobs<\/p>/);
  assert.match(html, /<li class="campaign-agent-card" data-missing="true">/);
  // The coordinator comes first, with the readable name derived from its ID.
  assert.ok(html.indexOf("seo__orchestrator") < html.indexOf("seo__researcher<"));
  assert.match(html, /<span class="campaign-agent-avatar" aria-hidden="true">RI<\/span>/);
  assert.match(html, /seo__missing/);
  assert.doesNotMatch(html, /href="[^"]*seo__missing|seo__writer|Google Search Console|Google Analytics/);
});

test("keeps campaign goals and plans with their linked brand and playbook in the overview", () => {
  const saved = { ...campaign, playbookId: "retail-plan", goals: ["Grow organic sales"], plans: ["Review search traffic"] };
  const data = {
    ...workspace,
    brands: [{ id: "retail", name: "Retail Brand", description: "", revision: "", knowledge: "", palette: {}, logos: {}, assets: {} }],
    playbooks: [{ id: "retail-plan", name: "Retail strategy", description: "", revision: "", brandId: "retail", strategy: "" }],
  };
  const html = renderToStaticMarkup(createElement(CampaignOverview, { workspace: data, campaign: saved }));
  assert.match(html, /<h2 id="campaign-goals-heading">Goals<\/h2><ul class="campaign-goal-list"><li>Grow organic sales<\/li>/);
  assert.match(html, /<h2 id="campaign-steps-heading">Plan steps<\/h2><ol class="campaign-step-list"><li><span>Review search traffic<\/span><\/li>/);
  assert.match(html, /href="\/workspace\/brands\/retail"/);
  assert.match(html, /href="\/workspace\/playbooks\/retail-plan"/);
});

test("renders Markdown inside campaign goals and plan steps", () => {
  const saved = { ...campaign, goals: ["Reach **500** subscribers"], plans: ["Read [the brief](https://example.com/brief)", "<b>raw</b>"] };
  const html = renderToStaticMarkup(createElement(CampaignOverview, { workspace, campaign: saved }));
  assert.match(html, /<li>Reach <strong>500<\/strong> subscribers<\/li>/);
  assert.match(html, /<a href="https:\/\/example.com\/brief" target="_blank" rel="noopener noreferrer nofollow">the brief<\/a>/);
  assert.match(html, /&lt;b&gt;raw&lt;\/b&gt;/);
});

test("shows the saved plan with an Edit plan action instead of a hidden form", (t) => {
  const require = createRequire(import.meta.url);
  const actionsPath = require.resolve("../app/actions/workspace.ts");
  const editorsPath = require.resolve("../components/campaign-editors.tsx");
  const original = require.cache[actionsPath];
  const actions = new Module(actionsPath);
  actions.exports = { saveCampaignPlanAction: async () => ({}) };
  actions.loaded = true;
  require.cache[actionsPath] = actions;
  t.after(() => {
    if (original) require.cache[actionsPath] = original;
    else delete require.cache[actionsPath];
    delete require.cache[editorsPath];
  });
  const { CampaignPlanEditor } = require(editorsPath) as typeof import("../components/campaign-editors");
  const html = renderToStaticMarkup(createElement(CampaignPlanEditor, { campaign, revision: "r1" }, createElement("p", null, "Saved plan")));
  assert.match(html, /class="campaign-plan-toolbar"/);
  assert.match(html, /Edit plan<\/button><\/div><p>Saved plan<\/p>$/);
  assert.doesNotMatch(html, /<form|<details|textarea/);
});

test("derives readable agent names and initials from profile IDs", async () => {
  const { agentDisplayName, agentInitials } = await import("../lib/agent-name");
  assert.equal(agentDisplayName({ id: "seo__content_writer", name: "seo__content_writer" }), "Content Writer");
  assert.equal(agentDisplayName({ id: "seo__writer", name: "Editorial lead" }), "Editorial lead");
  assert.equal(agentInitials("Content Writer"), "CW");
  assert.equal(agentInitials("Researcher"), "RE");
});

test("describes activity times relative to now", async () => {
  const { relativeTime } = await import("../lib/relative-time");
  const now = 1_800_000_000_000;
  assert.equal(relativeTime(new Date(now - 10_000), now), "just now");
  assert.equal(relativeTime(new Date(now - 3 * 3600_000), now), "3 h ago");
  assert.equal(relativeTime(new Date(now - 2 * 86400_000), now), "2 days ago");
  assert.equal(relativeTime(new Date(now + 5 * 60_000), now), "in 5 min");
});

test("offers publishing modes as option cards with the saved mode marked", (t) => {
  const require = createRequire(import.meta.url);
  const actionsPath = require.resolve("../app/actions/workspace.ts");
  const modePath = require.resolve("../components/campaign-mode-settings.tsx");
  const original = require.cache[actionsPath];
  const actions = new Module(actionsPath);
  actions.exports = { saveCampaignModeAction: async () => ({}) };
  actions.loaded = true;
  require.cache[actionsPath] = actions;
  t.after(() => {
    if (original) require.cache[actionsPath] = original;
    else delete require.cache[actionsPath];
    delete require.cache[modePath];
  });
  const { CampaignModeSettings } = require(modePath) as typeof import("../components/campaign-mode-settings");
  const html = renderToStaticMarkup(createElement(CampaignModeSettings, {
    campaignId: "seo", installed: true,
    configuration: { revision: "a".repeat(64), provider: "", modelId: "", baseUrl: "", hasModelKey: false, mode: "control" },
  }));
  assert.equal(html.match(/type="radio" name="mode"/g)?.length, 3);
  assert.match(html, /<input type="radio" name="mode" checked="" value="control"\/>/);
  assert.match(html, /Control<span class="campaign-mode-current">Current<\/span>/);
  assert.match(html, /<button[^>]*type="submit"[^>]*disabled=""[^>]*>Save mode<\/button>/);
});
