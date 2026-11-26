/** Verifies that the approvals queue lists posts beside a review pane that renders Markdown copy. */

import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { CampaignPublication } from "../lib/server/agent-publications";

function publication(id: string, status: CampaignPublication["status"], text: string): CampaignPublication {
  return {
    id, revision: 2, status, platform: "linkedin", kind: "post",
    account: { id: "acct-1", displayName: "Retail Co", handle: "", avatar: "" },
    content: { text, media: [] }, target: null, approval: null, result: null,
  };
}

test("shows pending posts first with the full Markdown copy and the approval action in the review pane", (t) => {
  const require = createRequire(import.meta.url);
  const actionsPath = require.resolve("../app/actions/workspace.ts");
  const queuePath = require.resolve("../app/(console)/(workspace)/approvals/approval-queue.tsx");
  const original = require.cache[actionsPath];
  const actions = new Module(actionsPath);
  actions.exports = { approveCampaignPublicationAction: async () => ({}) };
  actions.loaded = true;
  require.cache[actionsPath] = actions;
  t.after(() => {
    if (original) require.cache[actionsPath] = original;
    else delete require.cache[actionsPath];
    delete require.cache[queuePath];
  });
  const { ApprovalQueue } = require(queuePath) as typeof import("../app/(console)/(workspace)/approvals/approval-queue");
  const html = renderToStaticMarkup(createElement(ApprovalQueue, {
    selected: false,
    groups: [{ id: "seo", name: "Retail search", skipped: 0, items: [
      publication("p1", "published", "Already live"),
      publication("p2", "pending_approval", "**Launch day**\n\n- Free shipping\n- New arrivals"),
    ] }],
  }));
  assert.match(html, /aria-pressed="true">Needs approval <span>1<\/span>/);
  assert.doesNotMatch(html, /Already live/);
  assert.match(html, /<span class="approval-list-preview">Launch day Free shipping New arrivals<\/span>/);
  assert.match(html, /<strong>Launch day<\/strong>/);
  assert.match(html, /<li>Free shipping<\/li>/);
  assert.match(html, /Approve and queue/);
  assert.match(html, /aria-pressed="false">Exact text/);
});
