import { z } from "zod";

export const campaignProfiles = {
  "oma-campaign-researcher": "Researcher",
  "oma-campaign-strategist": "Strategist",
  "oma-campaign-creator": "Creator",
  "oma-campaign-reviewer": "Reviewer",
} as const;

export const campaignSources = {
  google_search_console: {
    label: "Google Search Console",
    evidence: "search queries and performance",
    resourceLabel: "Search Console property",
    example: "sc-domain:example.com",
    resource: z.string().trim().max(500).refine((value) => {
      if (/^sc-domain:[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(value)) return true;
      try {
        const url = new URL(value);
        return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
          && !url.search && !url.hash && value.endsWith("/");
      } catch {
        return false;
      }
    }),
  },
  google_analytics: {
    label: "Google Analytics",
    evidence: "GA4 traffic and engagement by channel",
    resourceLabel: "GA4 property ID",
    example: "123456789",
    resource: z.string().trim().regex(/^\d{1,20}$/),
  },
} as const;

export const sourceKeySchema = z.enum(Object.keys(campaignSources) as [SourceKey, ...SourceKey[]]);
export type SourceKey = keyof typeof campaignSources;
export type CampaignProfile = keyof typeof campaignProfiles;

const note = z.string().trim().min(1).max(2000);
const briefFields = {
  brand: z.object({ name: note, audience: note, voice: note, assets: z.array(note).max(12) }),
  knowledge: z.array(note).min(1).max(12),
};
const playbookFields = {
  title: note,
  goal: note,
  approach: note,
  steps: z.array(z.object({
    profile: z.enum(Object.keys(campaignProfiles) as [CampaignProfile, ...CampaignProfile[]]),
    role: z.string().trim().min(1).max(80),
    task: note,
  })).min(1).max(4),
};
const sourceKeys = z.array(sourceKeySchema).max(Object.keys(campaignSources).length)
  .refine((keys) => new Set(keys).size === keys.length);
export const draftSchema = z.object({
  ...briefFields,
  playbook: z.object({ ...playbookFields, sources: sourceKeys }),
});

export type DraftBrief = z.infer<typeof draftSchema>;
export type Source = { toolkit: SourceKey; resource: string };
export type Brief = Omit<DraftBrief, "playbook"> & {
  playbook: Omit<DraftBrief["playbook"], "sources"> & { sources: Source[] };
};
