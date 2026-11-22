/** Matches verified brand links to supported toolkits that are relevant to a saved campaign. */

import type { SavedBrand, SavedCampaign } from "./server/agent-workspace";
import type { Toolkit } from "./tool-catalog";

type Discovery = NonNullable<SavedBrand["channels"]>[number];
type Interest = "search" | "editorial" | "community" | "developer" | "launch";
type Rule = { slug: string; name: string; hosts: string[]; interests: Interest[] };

export type CampaignToolEvidence = {
  label: string;
  url: string;
  kind: "channel" | "launch";
};
export type CampaignToolSuggestion = Pick<Toolkit, "slug" | "name"> & { evidence: CampaignToolEvidence[] };
export type CampaignToolRecommendation = CampaignToolSuggestion & { tool?: Toolkit };

const interests: Record<Interest, RegExp> = {
  search: /\b(seo|organic search|search engine|search visibility|search console|indexing)\b/i,
  editorial: /\b(blog|newsletter|email marketing|editorial|publishing|content marketing)\b/i,
  community: /\b(social|community|audience engagement)\b/i,
  developer: /\b(docs|documentation|developer enablement|repository|open.source)\b/i,
  launch: /\b(launch(?:es|ing)?|release announcement|product hunt|hacker news)\b/i,
};

const toolkitRules: Rule[] = [
  { slug: "twitter", name: "X (Twitter)", hosts: ["x.com", "twitter.com"], interests: ["community", "launch"] },
  { slug: "linkedin", name: "LinkedIn", hosts: ["linkedin.com"], interests: ["community", "launch"] },
  { slug: "youtube", name: "YouTube", hosts: ["youtube.com", "youtu.be"], interests: ["community", "editorial", "launch"] },
  { slug: "discord", name: "Discord", hosts: ["discord.com", "discord.gg"], interests: ["community", "launch"] },
  { slug: "reddit", name: "Reddit", hosts: ["reddit.com"], interests: ["community", "launch"] },
  { slug: "instagram", name: "Instagram", hosts: ["instagram.com"], interests: ["community", "launch"] },
  { slug: "facebook", name: "Facebook", hosts: ["facebook.com", "fb.me"], interests: ["community", "launch"] },
  { slug: "slack", name: "Slack", hosts: ["slack.com"], interests: ["community", "launch"] },
  { slug: "github", name: "GitHub", hosts: ["github.com"], interests: ["developer", "community", "launch"] },
  { slug: "product_hunt", name: "Product Hunt", hosts: ["producthunt.com"], interests: ["launch", "community"] },
  { slug: "hackernews", name: "Hacker News", hosts: ["news.ycombinator.com"], interests: ["launch", "community"] },
  { slug: "mailchimp", name: "Mailchimp", hosts: ["mailchimp.com", "list-manage.com", "mailchi.mp"], interests: ["editorial", "launch"] },
  { slug: "webflow", name: "Webflow", hosts: ["webflow.com", "webflow.io"], interests: ["editorial", "search", "developer"] },
  { slug: "hashnode", name: "Hashnode", hosts: ["hashnode.com", "hashnode.dev"], interests: ["editorial", "developer", "search"] },
];

function verifiedUrl(item: Discovery) {
  if (item.status !== "verified" || !item.label.trim()) return;
  const url = URL.parse(item.url);
  if (url && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return url;
}

export function suggestCampaignTools(
  campaign: Pick<SavedCampaign, "id" | "name" | "description" | "goals" | "plans">,
  brand: Pick<SavedBrand, "channels" | "launches"> | undefined,
): CampaignToolSuggestion[] {
  if (!brand) return [];
  const core = [campaign.id.replaceAll("-", " "), campaign.name, campaign.description].join(" ");
  const work = [...campaign.goals, ...campaign.plans].join(" ");
  const match = (description: string) => Object.entries(interests)
    .filter(([, expression]) => expression.test(description)).map(([kind]) => kind as Interest);
  const coreInterests = match(core);
  const campaignInterests = coreInterests.length ? coreInterests : match(work);
  const suggestions = new Map<string, CampaignToolSuggestion>();

  function add(rule: Rule, evidence: CampaignToolEvidence) {
    const existing = suggestions.get(rule.slug);
    if (!existing) {
      suggestions.set(rule.slug, { slug: rule.slug, name: rule.name, evidence: [evidence] });
    } else if (!existing.evidence.some((item) => item.url === evidence.url && item.kind === evidence.kind)) {
      existing.evidence.push(evidence);
    }
  }

  for (const [kind, items] of [["channel", brand.channels], ["launch", brand.launches]] as const) {
    for (const item of items ?? []) {
      const url = verifiedUrl(item);
      if (!url) continue;
      const evidence = { kind, label: item.label.trim(), url: url.href };
      for (const rule of toolkitRules) {
        if (!rule.hosts.some((host) => url.hostname === host || url.hostname.endsWith("." + host))) continue;
        if (!campaignInterests.length || rule.interests.some((interest) => campaignInterests.includes(interest))) {
          add(rule, evidence);
        }
      }
    }
  }

  return [...suggestions.values()];
}
