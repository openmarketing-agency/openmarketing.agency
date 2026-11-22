/** Ensures the agent page renders the saved profile, configuration, and schedule without inventing records. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentProfileDetail } from "../components/agent-profile-detail";
import type { SavedAgent } from "../lib/server/agent-workspace";

const agent: SavedAgent = {
  id: "seo__humanizer",
  name: "seo__humanizer",
  campaignId: "seo",
  description: "Reviews drafts for clarity.",
  model: "fixture/model",
  toolsets: ["file", "memory"],
  skills: ["humanizer"],
  jobs: [],
};

test("keeps canonical identifiers accessible and links back to the campaign roster", () => {
  const html = renderToStaticMarkup(createElement(AgentProfileDetail, {
    agent,
    campaign: { id: "seo", name: "Organic Search" },
    profile: { content: "Review for clarity.", html: "<p>Review for clarity.</p>" },
  }));
  assert.match(html, /<h1>Humanizer<\/h1>/);
  assert.match(html, /href="\/campaigns\/seo\?view=agents"/);
  assert.match(html, /<code>seo__humanizer<\/code>/);
  assert.match(html, /<code>fixture\/model<\/code>/);
  assert.match(html, /<li>humanizer<\/li>/);
  assert.match(html, /<li>file<\/li><li>memory<\/li>/);
  assert.match(html, /<p>Review for clarity\.<\/p>/);
  assert.match(html, /No jobs saved for this agent/);
});

test("retains the saved display name, job details, and profile load error", () => {
  const html = renderToStaticMarkup(createElement(AgentProfileDetail, {
    agent: {
      ...agent, name: "Editorial reviewer",
      jobs: [{ name: "Review drafts", schedule: "0 9 * * 1", timezone: "UTC", repeat: 1 }],
    },
    error: "The profile could not be read.",
  }));
  assert.match(html, /<h1>Editorial reviewer<\/h1>/);
  assert.match(html, /role="alert">The profile could not be read/);
  assert.match(html, /href="\/dashboard"/);
  assert.match(html, /<h3>Review drafts<\/h3>/);
  assert.match(html, /<p>0 9 \* \* 1<\/p>/);
  assert.match(html, /UTC · 1 run<\/p>/);
  assert.doesNotMatch(html, /No jobs saved/);
});
