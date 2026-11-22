/** Defines the sample campaign drafts and the deterministic revisions offered by the mock chat. */

import { z } from "zod";

export const approvalTitleLimit = 140;
export const approvalBodyLimit = 18_000;

export const approvalStatusLabels = {
  pending: "Pending review",
  changes: "Changes requested",
  approved: "Approved",
} as const;

export const approvalDraftSchema = z.object({
  title: z.string().min(1).max(approvalTitleLimit),
  body: z.string().min(1).max(approvalBodyLimit),
  status: z.enum(["pending", "changes", "approved"]),
});

export type ApprovalDraft = z.infer<typeof approvalDraftSchema>;
export type ApprovalStatus = ApprovalDraft["status"];

export const approvalCampaigns = [
  { id: "seo", name: "SEO" },
  { id: "social", name: "Social Media" },
  { id: "launch", name: "Product Launch" },
] as const;

type ApprovalCampaign = typeof approvalCampaigns[number]["id"];

export type Approval = ApprovalDraft & {
  id: string;
  campaign: ApprovalCampaign;
  format: "Article" | "LinkedIn post" | "Email" | "Search snippet" | "Social post";
  channel: string;
  submitted: string;
  cta: string;
};

export const mockApprovals: readonly Approval[] = [
  {
    id: "marketing-playbook-guide",
    campaign: "seo",
    format: "Article",
    channel: "Blog",
    title: "How to build a marketing playbook",
    body: "A marketing playbook gives your team one place to decide what matters, what to do next, and how to tell if it worked.\n\nStart with one goal, such as bringing in more qualified sign-ups. Write down who you want to reach, where those people already look for answers, and what would make them pay attention. Choose one channel your team can support consistently.\n\nSet a weekly review with one person responsible for bringing the numbers. Record what you learned and update the next action while it’s still fresh.",
    submitted: "2026-11-21",
    status: "pending",
    cta: "Start your playbook with one audience, one channel, and one goal.",
  },
  {
    id: "campaign-template-snippet",
    campaign: "seo",
    format: "Search snippet",
    channel: "Website",
    title: "Campaign planning template",
    body: "Plan your next marketing campaign with a template for goals, channels, ownership, and weekly reporting.",
    submitted: "2026-11-20",
    status: "approved",
    cta: "Download the campaign planning template.",
  },
  {
    id: "linkedin-launch-post",
    campaign: "social",
    format: "LinkedIn post",
    channel: "LinkedIn",
    title: "A simpler way to plan your next campaign",
    body: "Good campaigns start with a clear brief. But when the plan lives across docs, chats, and spreadsheets, it’s hard to know what’s ready.\n\nA shared playbook gives everyone a place to find the goal, see what’s been approved, and pick up the next task. The whole team can work from the same brief.\n\nHow does your team keep campaign planning organized?",
    submitted: "2026-11-21",
    status: "pending",
    cta: "Share one thing that has made campaign planning easier for your team.",
  },
  {
    id: "behind-the-scenes-post",
    campaign: "social",
    format: "Social post",
    channel: "Social",
    title: "Behind the scenes of our campaign reviews",
    body: "We review drafts in the same place we make edits. That keeps feedback next to the copy and gives the team a clear record of what was approved.",
    submitted: "2026-11-19",
    status: "changes",
    cta: "Tell us how your team handles draft reviews.",
  },
  {
    id: "launch-email",
    campaign: "launch",
    format: "Email",
    channel: "Email",
    title: "Introducing the campaign workspace",
    body: "Hi there,\n\nThe new campaign workspace brings your plan, drafts, and approvals into one place. You can check what’s waiting for feedback and open a draft without retracing an entire conversation.\n\nOpen the workspace to see how your next campaign could be organized.",
    submitted: "2026-11-20",
    status: "pending",
    cta: "Explore the campaign workspace.",
  },
];

export function proposeApprovalRevision(body: string, request: string, cta: string) {
  const text = body.trim();
  if (!text) return { message: "Add some draft copy first so I can revise it." };

  const replacement = /^replace\s+"([^"]+)"\s+with\s+"([^"]*)"[.!]?$/i.exec(request);
  const addition = /^add:\s*(\S[\s\S]*)$/i.exec(request);
  let revision: string;
  if (replacement) {
    const [, from, to] = replacement;
    if (!body.includes(from)) return { message: "I couldn’t find that text in the draft. Copy the exact phrase and try again." };
    revision = body.replaceAll(from, () => to);
  } else if (addition) {
    revision = text + "\n\n" + addition[1];
  } else if (/\b(shorter|shorten|condense|concise)\b/i.test(request)) {
    const sentences = text.split(/(?<=[.!?])\s+/);
    revision = sentences.slice(0, Math.ceil(sentences.length / 2)).join(" ");
  } else if (/\b(cta|call to action)\b/i.test(request)) {
    revision = text.endsWith(cta) ? text : text + "\n\n" + cta;
  } else {
    return { message: 'Try asking me to shorten the draft, suggest a CTA, replace "old text" with "new text", or add a paragraph with “Add: …”.' };
  }

  if (!revision.trim() || revision === text || revision === body) {
    return { message: "That request would leave the draft empty or unchanged. Try a more specific edit." };
  }
  if (revision.length > approvalBodyLimit) return { message: "That edit exceeds the draft’s character limit." };
  return { message: "Here’s a suggested revision.", revision };
}
