/** Verifies that campaign views and tool scopes use the saved agent workspace records. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CampaignLibrary } from "../components/campaign-library";
import { campaignAgentIds, campaignLifecycleLabel, CampaignAgents, CampaignOverview } from "../components/workspace-records";
import { type AgentWorkspace, type SavedCampaign } from "../lib/server/agent-workspace";

test("shows an empty campaign list when the agent has saved none", () => {
  const html = renderToStaticMarkup(createElement(CampaignLibrary, { saved: [] }));
  assert.match(html, /No campaigns yet/);
  assert.doesNotMatch(html, /href="\/campaigns\//);
});

test("lists an agent-saved campaign without a bundled fallback", () => {
  const html = renderToStaticMarkup(createElement(CampaignLibrary, {
    saved: [{ id: "seo", name: "Retail search", description: "", version: "", agentCount: 1 }],
  }));
  assert.match(html, /Retail search/);
  assert.match(html, /href="\/campaigns\/seo"/);
  assert.doesNotMatch(html, /href="\/campaigns\/social-media"|Mission owner/);
});

const campaign: SavedCampaign = {
  id: "seo", name: "Retail search", description: "", version: "", playbookId: "",
  orchestrator: "seo__orchestrator", agentIds: [], goals: [], plans: [], board: "",
};
const workspace: AgentWorkspace = { campaigns: [campaign], agents: [], brands: [], playbooks: [], skipped: 0 };

test("shows running, stopped, and stopping states without treating drafts as running", () => {
  for (const [lifecycleState, expected] of [["resumed", "Running"], ["paused", "Stopped"], ["pausing", "Stopping…"]]) {
    const installed = { ...campaign, installationState: "installed", lifecycleState };
    assert.equal(campaignLifecycleLabel(installed), expected);
    const overview = renderToStaticMarkup(createElement(CampaignOverview, { workspace, campaign: installed }));
    assert.ok(overview.includes(`<dt>Status</dt><dd>${expected}</dd>`));
  }
  assert.equal(campaignLifecycleLabel(campaign), "Stopped");
  assert.equal(campaignLifecycleLabel({ ...campaign, installationState: "installed" }), "Running");
  assert.equal(campaignLifecycleLabel({ ...campaign, installationState: "installing", lifecycleState: "resumed" }), "Stopped");
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
  assert.match(html, /Review traffic · Daily · UTC · 2 runs/);
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
  assert.match(html, /<h2>Goals<\/h2><ul[^>]*><li>Grow organic sales<\/li>/);
  assert.match(html, /<h2>Plans<\/h2><ol[^>]*><li>Review search traffic<\/li>/);
  assert.match(html, /href="\/workspace\/brands\/retail"/);
  assert.match(html, /href="\/workspace\/playbooks\/retail-plan"/);
});
