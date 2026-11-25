/** Validates activity requests and the campaign-scoped history returned by the private VM. */

import { z } from "zod";

import { workspaceId, workspaceRequest } from "./agent-workspace";
import { campaignChatScope } from "./chat-history";

const category = z.enum(["chat", "agent", "worker", "cron", "delegated"]);
const kind = z.enum(["session", "task-log", "job-log", "profile-log"]);
const reference = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_./-]+$/);
const profile = z.union([workspaceId, z.literal("")]);
const position = z.number().int().min(0).max(2_000_000_000);
const offset = z.string().regex(/^\d{1,10}$/).transform(Number).pipe(position).default(0);
const at = z.number().positive().max(253402300799.999).nullable();
const entry = z.object({
  kind, category, profile, ref: reference, parent: reference.nullable(), title: z.string(), at,
  status: z.string(), messages: z.number().int().nonnegative(), tools: z.number().int().nonnegative(),
});
const index = z.object({ entries: z.array(entry).max(30), nextOffset: position.nullable(), partial: z.boolean() });
const textPage = z.object({ text: z.string(), nextOffset: position.nullable() });
const transcript = z.object({
  messages: z.array(z.object({
    id: z.number().int(), role: z.enum(["user", "assistant", "tool"]), at, text: z.string(),
    truncated: z.boolean(), tool: z.string(), calls: z.array(z.object({ name: z.string(), arguments: z.string() })),
  })).max(25), nextOffset: position.nullable(),
});

const listQuery = z.strictObject({ category: category.optional(), agent: workspaceId.optional(), offset });
const detailQuery = z.strictObject({ kind, profile, ref: reference, offset, view: z.enum(["log", "message"]).optional(),
  message: z.string().regex(/^\d{1,16}$/).transform(Number).pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)).optional(),
}).refine((query) => query.view === "message" ? query.kind === "session" && query.message !== undefined : query.message === undefined);
export const campaignActivityQuery = z.union([listQuery, detailQuery]);
export type CampaignActivityCategory = z.infer<typeof category>;
export type CampaignActivityEntry = z.infer<typeof entry>;
export type CampaignActivityIndex = z.infer<typeof index>;
export type CampaignActivityTranscript = z.infer<typeof transcript>;
export type CampaignActivityText = z.infer<typeof textPage>;

export async function readCampaignActivity(userId: string, id: string, query: z.output<typeof campaignActivityQuery>) {
  const scope = campaignChatScope(userId, id);
  const result = await workspaceRequest(`/workspace/campaigns/${id}/activity`, { ...query, ...scope }, "POST");
  if (!("kind" in query)) return index.parse(result);
  return query.kind === "session" && !query.view ? transcript.parse(result) : textPage.parse(result);
}
