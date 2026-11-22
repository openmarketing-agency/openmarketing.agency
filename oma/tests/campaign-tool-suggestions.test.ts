/** Checks that recommendations depend on verified brand evidence and the saved campaign’s purpose. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { suggestCampaignTools } from "../lib/campaign-tool-suggestions";
import type { SavedBrand } from "../lib/server/agent-workspace";

type Discovery = NonNullable<SavedBrand["channels"]>[number];
const discovery = (label: string, url: string, status: Discovery["status"] = "verified"): Discovery => ({
  label, url, status, feedUrl: "", signupUrl: "",
});
const campaign = (name: string, goals: string[] = []) => ({ id: "custom-campaign", name, description: "", goals, plans: [] });
const brand = {
  channels: [
    discovery("Website", "https://example.test/"),
    discovery("LinkedIn", "https://www.linkedin.com/company/example"),
    discovery("GitHub", "https://github.com/example/project"),
    discovery("X", "https://x.com/example", "not_found"),
    discovery("Discord", "https://discord.gg/example", "not_checked"),
    discovery("YouTube", "https://youtube.com.unrelated.test/example"),
    discovery("Newsletter", "https://user@list-manage.com/example"),
  ],
  launches: [
    discovery("Product Hunt", "https://producthunt.com/products/example"),
    discovery("GitHub", "https://github.com/example/project/releases"),
    discovery("GitHub", "https://github.com/example/project/releases"),
    discovery("Other", "https://trendshift.io/example"),
    discovery("Reddit", "javascript:alert(1)"),
  ],
};

test("suggests from both channels and launches and deduplicates shared providers", () => {
  const result = suggestCampaignTools(campaign("Product launch"), brand);
  assert.deepEqual(result.map(({ slug }) => slug), ["linkedin", "github", "product_hunt"]);
  assert.deepEqual(result.find(({ slug }) => slug === "github")?.evidence, [
    { kind: "channel", label: "GitHub", url: "https://github.com/example/project" },
    { kind: "launch", label: "GitHub", url: "https://github.com/example/project/releases" },
  ]);
  assert.equal(result.find(({ slug }) => slug === "product_hunt")?.evidence[0].kind, "launch");
});

test("uses campaign intent and requires verified source data", () => {
  const seo = campaign("Organic Search");
  assert.deepEqual(suggestCampaignTools(seo, brand), []);
  assert.deepEqual(suggestCampaignTools(campaign("Documentation"), brand).map(({ slug }) => slug), ["github"]);
  assert.deepEqual(suggestCampaignTools(campaign("Pilot", ["Grow the newsletter"]), brand), []);
  assert.deepEqual(suggestCampaignTools(seo, undefined), []);
  assert.deepEqual(suggestCampaignTools(seo, {
    channels: [discovery("Webflow", "https://example.webflow.io/", "not_checked")], launches: [],
  }), []);
});

test("an SEO campaign suggests tools only for matching provider links", () => {
  const seo = campaign("Organic Search");
  const channels = [discovery("Website", "https://example.test/")];
  assert.deepEqual(suggestCampaignTools(seo, { channels, launches: [] }), []);
  assert.deepEqual(suggestCampaignTools(seo, {
    channels: [...channels, discovery("Website", "https://example.webflow.io/")],
    launches: [],
  }), [{
    slug: "webflow",
    name: "Webflow",
    evidence: [{ kind: "channel", label: "Website", url: "https://example.webflow.io/" }],
  }]);
});
