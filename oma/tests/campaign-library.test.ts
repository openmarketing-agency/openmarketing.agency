/** Verifies that campaign views and tool scopes use the saved agent workspace records. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CampaignLibrary } from "../components/campaign-library";
import { CampaignOverview } from "../components/workspace-records";
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

test("leaves campaign details and agent tools empty when records are absent", () => {
  const html = renderToStaticMarkup(createElement(CampaignOverview, { workspace, campaign }));
  assert.doesNotMatch(html, /<h2|<dt|<li/);
});

test("shows saved agents in their campaign overview", () => {
  const researcher = {
    id: "seo__researcher", campaignId: "seo", name: "Retail insights", description: "", toolsets: [], jobs: [],
  };
  const data = { ...workspace, agents: [
    researcher,
    { ...researcher, id: "seo__orchestrator" },
    { ...researcher, id: "seo__writer", campaignId: "social-media" },
  ] };
  const html = renderToStaticMarkup(createElement(CampaignOverview, { workspace: data, campaign }));
  assert.match(html, /Retail insights/);
  assert.doesNotMatch(html, /Google Search Console|Google Analytics/);
});
