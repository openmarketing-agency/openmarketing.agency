export const tools = {
  searchconsole: {
    name: "Google Search Console",
    short: "Search Console",
    slug: "google_search_console",
    description: "Search queries, page performance, and indexing insights.",
    icon: "search",
  },
  analytics: {
    name: "Google Analytics 4",
    short: "GA4",
    slug: "google_analytics",
    description: "Traffic sources, audience behavior, and conversions.",
    icon: "chart",
  },
  docs: {
    name: "Google Docs",
    short: "Google Docs",
    slug: "googledocs",
    description: "Draft documents, editorial revisions, and review handoffs.",
    icon: "file",
  },
  sheets: {
    name: "Google Sheets",
    short: "Sheets",
    slug: "googlesheets",
    description: "Read your planning sheets and export findings.",
    icon: "table",
  },
  notion: {
    name: "Notion",
    short: "Notion",
    slug: "notion",
    description: "Bring your content calendar and team knowledge together.",
    icon: "file",
  },
  slack: {
    name: "Slack",
    short: "Slack",
    slug: "slack",
    description: "Share findings and updates with your team.",
    icon: "hash",
  },
} as const;
export type ToolId = keyof typeof tools;
export type CampaignAgent = {
  id: string;
  role: string;
  description: string;
  summary: string;
  responsibility: string;
  tools: { id: ToolId; purpose: string }[];
};
export type Campaign = {
  id: string;
  title: string;
  version: string;
  sourceDirectory: string;
  description: string;
  outcome: string;
  agents: CampaignAgent[];
  capabilities: { title: string; description: string }[];
  outputs: string[];
  prompt: string;
};

// Console descriptions of the bundled campaigns and their agent teams.
export const campaigns: Campaign[] = [
  {
    id: "seo",
    title: "SEO",
    version: "0.1.0",
    sourceDirectory: "campaigns/seo",
    description:
      "Find search opportunities, improve site content, and measure organic performance.",
    outcome:
      "An SEO coordinator and five specialists work toward ongoing improvements in your site’s organic visibility and useful traffic. The coordinator chooses work from evidence and reviews the results.",
    agents: [
      {
        id: "default",
        summary: "Owns the mission, assigns work, and reviews outcomes.",
        responsibility:
          "Coordinates the specialists and chooses the next useful action. External tools are connected to the specialist responsible for the work.",
        tools: [],
        role: "Coordinator",
        description:
          "Continuously improve the connected site's SEO by autonomously researching trends and keywords, reviewing Search Console performance, implementing permitted improvements, and measuring results.",
      },
      {
        id: "researcher",
        summary: "Turns search performance into a focused research brief.",
        responsibility:
          "Investigates keywords, trends, competitors, and site performance. GSC and GA4 are suggested sources for search and audience data.",
        tools: [
          {
            id: "searchconsole",
            purpose: "Queries, clicks, impressions, and indexing insights.",
          },
          {
            id: "analytics",
            purpose: "Traffic, engagement, and conversion performance.",
          },
          {
            id: "sheets",
            purpose: "Read planning sheets and organize research findings.",
          },
        ],
        role: "Researcher",
        description:
          "Research markets, competitors, emerging trends, and popular SEO keywords; deliver dated evidence, search intent, and content opportunities without inventing search metrics.",
      },
      {
        id: "writer",
        summary: "Produces source-backed drafts and content metadata.",
        responsibility:
          "Works from the assigned research and brief, saving editable drafts for review. Publishing stays with the publisher.",
        tools: [
          {
            id: "docs",
            purpose: "Create drafts and revise assigned documents.",
          },
          {
            id: "notion",
            purpose: "Read brand guidelines and the editorial brief.",
          },
        ],
        role: "Writer",
        description:
          "Write useful, source-backed SEO blog posts and other content from the assigned brief, audience, and keyword intent; deliver editable drafts and metadata without publishing.",
      },
      {
        id: "humanizer",
        summary: "Refines clarity, rhythm, and your brand voice.",
        responsibility:
          "Edits the assigned draft while preserving facts, citations, intent, and editorial qualifications.",
        tools: [
          {
            id: "docs",
            purpose: "Read and edit the exact document revision under review.",
          },
        ],
        role: "Humanizer",
        description:
          "Review and edit drafts for natural language, brand voice, clarity, and rhythm while preserving factual meaning, citations, useful keyword intent, and editorial qualifications.",
      },
      {
        id: "verifier",
        summary: "Checks the content, evidence, and assets before delivery.",
        responsibility:
          "Reviews the assigned content revision independently and reports blockers. Verification does not authorize publication.",
        tools: [
          {
            id: "docs",
            purpose: "Inspect draft revisions, references, and review notes.",
          },
          {
            id: "searchconsole",
            purpose: "Cross-check site and page performance evidence.",
          },
        ],
        role: "Verifier",
        description:
          "Independently verify the assigned content revision and its assets for supported claims, working references, correct presentation, accessibility, and documented usage rights; report blockers and unverified items.",
      },
      {
        id: "publisher",
        summary: "Delivers verified content to your publishing workspace.",
        responsibility:
          "Publishes or updates only the authorized revision, checks the resulting state, and records the destination. Connect the publishing workspace used by this agent.",
        tools: [
          {
            id: "notion",
            purpose:
              "Create and update approved content in your publishing workspace.",
          },
          {
            id: "docs",
            purpose: "Retrieve the approved draft and metadata.",
          },
        ],
        role: "Publisher",
        description:
          "Publish or schedule authorized content and assets through the connected CMS, preserve the verified revision and metadata, prevent duplicate posts, and confirm the resulting publication state.",
      },
    ],
    capabilities: [
      {
        title: "Research and prioritize",
        description:
          "Investigate markets, trends, keywords, and search performance to choose the next useful action.",
      },
      {
        title: "Improve content and verify changes",
        description:
          "Assign research, writing, editing, verification, or authorized publishing as needed. Tasks are chosen dynamically rather than following a fixed sequence.",
      },
      {
        title: "Measure and revisit",
        description:
          "Record changes and observations, compare results over a useful period, and decide whether to improve, investigate, wait, or stop.",
      },
    ],
    outputs: [
      "Evidence-backed opportunity briefs",
      "Content drafts, revisions, and verification reports",
      "Authorized CMS changes with publication receipts",
      "A record of changes, measurements, and follow-up decisions",
    ],
    prompt:
      "Continuously improve the site’s relevant organic visibility and useful traffic. Establish the target site, audience, objectives, connected properties, budget, and standing action policy. Use evidence to choose work for the researcher, writer, humanizer, verifier, and publisher. Verify changes and measure outcomes over an appropriate observation window. Continue independent useful work when an integration is unavailable, and wait when new evidence is needed. Publishing requires the exact verified revision and recorded authorization.",
  },
  {
    id: "social-media",
    title: "Social Media",
    version: "0.1.0",
    sourceDirectory: "campaigns/social-media",
    description: "Research your audience, plan social content, and manage community engagement.",
    outcome: "A social media coordinator and four specialists help grow reach, audience trust, and meaningful engagement across your connected accounts.",
    agents: [
      {
        id: "default",
        role: "Coordinator",
        description: "Sets priorities and coordinates the social media team.",
        summary: "Coordinates research, content, publishing, and audience engagement.",
        responsibility: "Chooses work based on brand goals, evidence, and standing authority, and reviews specialist results.",
        tools: [],
      },
      {
        id: "researcher",
        role: "Researcher",
        description: "Researches audiences, competitors, social trends, and account performance.",
        summary: "Finds evidence-backed opportunities for the content team.",
        responsibility: "Records sources and limitations for each opportunity.",
        tools: [],
      },
      {
        id: "creator",
        role: "Creator",
        description: "Creates platform-appropriate content from the brief and brand voice.",
        summary: "Creates editable copy, captions, scripts, and media drafts.",
        responsibility: "Prepares drafts for review before publication.",
        tools: [],
      },
      {
        id: "publisher",
        role: "Publisher",
        description: "Publishes, schedules, and verifies authorized social content.",
        summary: "Publishes approved revisions on the intended account.",
        responsibility: "Checks the resulting state and prevents duplicate posts.",
        tools: [],
      },
      {
        id: "interactor",
        role: "Community specialist",
        description: "Reviews comments and mentions and handles authorized replies.",
        summary: "Helps the team respond to relevant audience conversations.",
        responsibility: "Verifies external actions and protects private information.",
        tools: [],
      },
    ],
    capabilities: [
      { title: "Research your audience", description: "Review trends, audience needs, and account performance before choosing content." },
      { title: "Create and publish", description: "Draft platform-specific content and publish approved revisions on the intended account." },
      { title: "Engage and review", description: "Review relevant conversations and measure which activity supports your goals." },
    ],
    outputs: ["Audience and content briefs", "Editable content drafts", "Publication receipts and engagement reports"],
    prompt: "Grow the connected brand’s relevant reach, audience trust, and meaningful engagement. Review brand goals and standing authority, assign research and creation, and verify the results of authorized publishing and community interactions.",
  },
];

export function findCampaign(id: string) {
  return campaigns.find((p) => p.id === id);
}

export function findCampaignAgent(campaignId: string, agentId: string) {
  return findCampaign(campaignId)?.agents.find((agent) => agent.id === agentId);
}
