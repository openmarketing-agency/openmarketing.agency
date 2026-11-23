/** Loads native publication previews and approves the reviewed revision through the private agent socket. */

import { z } from "zod";
import { workspaceId, workspaceRequest, WorkspaceRequestError } from "./agent-workspace";

const httpsLink = z.string().nullish().transform((value) => {
  const url = URL.parse(value ?? "");
  return url?.protocol === "https:" && !url.username && !url.password ? value ?? "" : "";
});
const optionalText = z.string().nullish().transform((value) => value ?? "");
const publicationId = z.string().regex(/^[a-f0-9]{32}$/);
const publicationRevision = z.number().int().positive();
const publication = z.object({
  id: publicationId,
  revision: publicationRevision,
  status: z.enum(["pending_approval", "approved", "publishing", "published", "failed"]),
  platform: workspaceId,
  kind: z.enum(["post", "reply"]),
  account: z.object({ id: z.string().min(1), name: optionalText, handle: optionalText, avatar_url: httpsLink }),
  content: z.object({
    text: z.string(),
    media: z.array(z.object({ asset_id: z.string().min(1), kind: z.enum(["image", "video", "document"]),
      url: httpsLink, alt_text: optionalText })).default([]),
  }),
  target: z.object({ id: z.string().min(1), url: httpsLink, author_name: optionalText,
    author_handle: optionalText, text: optionalText }).nullish(),
  approval: z.object({ by: optionalText, at: optionalText, source: z.enum(["human", "automatic"]) }).nullish(),
  result: z.object({ provider_id: optionalText, url: httpsLink }).nullish(),
}).refine((value) => (value.content.text.trim() || value.content.media.length > 0) && (value.kind !== "reply" || value.target))
  .transform(({ account, content, target, approval, result, ...value }) => ({
    ...value,
    account: { id: account.id, displayName: account.name, handle: account.handle, avatar: account.avatar_url },
    content: { text: content.text, media: content.media.map(({ asset_id, kind, url, alt_text }) => ({
      assetId: asset_id, kind, url, alt: alt_text,
    })) },
    target: target ? { providerId: target.id, url: target.url, text: target.text,
      author: target.author_name || target.author_handle } : null,
    approval: approval ? { approvedBy: approval.by, approvedAt: approval.at, source: approval.source } : null,
    result: result ? { providerId: result.provider_id, url: result.url } : null,
  }));

const cursor = z.number().int().positive();
const publicationList = z.object({
  campaign_id: workspaceId, publications: z.array(z.unknown()), next_cursor: cursor.nullish(),
});

export type CampaignPublication = z.infer<typeof publication>;
export type CampaignPublicationGroup = {
  id: string;
  name: string;
  items: CampaignPublication[];
  skipped: number;
  nextCursor?: number;
  error?: string;
};

export async function listCampaignPublications(campaignId: string, before?: number) {
  if (!workspaceId.safeParse(campaignId).success) throw new WorkspaceRequestError(404, "Campaign not found.");
  const query = cursor.safeParse(before);
  const path = "/workspace/campaigns/" + campaignId + "/publications";
  const result = publicationList.safeParse(await workspaceRequest(path + (query.success ? "?before=" + query.data : "")));
  if (!result.success || result.data.campaign_id !== campaignId) {
    throw new WorkspaceRequestError(502, "Couldn’t read the campaign’s publication previews.");
  }
  const publications: CampaignPublication[] = [];
  let skipped = 0;
  for (const item of result.data.publications) {
    const parsed = publication.safeParse(item);
    if (parsed.success) publications.push(parsed.data);
    else skipped++;
  }
  return { publications, skipped, nextCursor: result.data.next_cursor ?? undefined };
}

export async function approveCampaignPublication(campaignId: string, id: string, input: unknown) {
  if (!workspaceId.safeParse(campaignId).success || !publicationId.safeParse(id).success) {
    throw new WorkspaceRequestError(404, "Publication not found.");
  }
  const reviewed = z.object({ revision: publicationRevision, approver: z.string().min(1).max(128) }).safeParse(input);
  if (!reviewed.success) throw new WorkspaceRequestError(422, "Review the current publication before approving.");
  await workspaceRequest("/workspace/campaigns/" + campaignId + "/publications/" + id + "/approve", reviewed.data, "POST");
}
