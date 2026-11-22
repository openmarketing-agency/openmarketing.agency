/** Defines the draft fields and bounded conversation shared by the campaign editor and workspace service. */

import { z } from "zod";

const text = (limit: number) => z.string().max(limit).refine((value) => !value.includes("\0"));
const items = z.array(text(2000).refine((value) => Boolean(value.trim()))).max(32);

export const campaignPlanSchema = z.strictObject({
  name: text(120).refine((value) => Boolean(value.trim())),
  description: text(4000),
  goals: items,
  plans: items,
});

export const campaignPlanMessageLimit = 4000;
const chatMessageSchema = z.strictObject({
  role: z.enum(["user", "assistant"]),
  content: text(campaignPlanMessageLimit).refine((value) => Boolean(value.trim())),
});
export const campaignPlanChatSchema = z.strictObject({
  draft: campaignPlanSchema,
  history: z.array(chatMessageSchema).min(1).max(11)
    .refine((history) => history.length % 2 === 1
      && history.every(({ role }, index) => role === (index % 2 === 0 ? "user" : "assistant"))),
});
export const campaignPlanResponseSchema = z.strictObject({
  reply: chatMessageSchema.shape.content,
  plan: campaignPlanSchema.nullable(),
});

export type CampaignPlan = z.infer<typeof campaignPlanSchema>;
export type CampaignPlanMessage = z.infer<typeof chatMessageSchema>;
export type CampaignPlanReply = z.infer<typeof campaignPlanResponseSchema>;
