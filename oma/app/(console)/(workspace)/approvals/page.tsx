/** Loads each accessible campaign’s publication previews for the authenticated approvals queue. */

import { Suspense } from "react";

import { Loading } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { listCampaignPublications, type CampaignPublicationGroup } from "@/lib/server/agent-publications";
import { loadAgentWorkspace, WorkspaceRequestError } from "@/lib/server/agent-workspace";

import { ApprovalQueue } from "./approval-queue";
import "@/components/workspace-document.css";
import "./approvals.css";

export const metadata = { title: "Approvals" };
type Props = { searchParams: Promise<{ campaign?: string | string[]; before?: string | string[] }> };

async function Queue({ searchParams }: Props) {
  await requireUser();
  const { campaign, before } = await searchParams;
  const selection = typeof campaign === "string" ? campaign : undefined;
  const cursor = selection && typeof before === "string" && /^[1-9][0-9]{0,15}$/.test(before) ? Number(before) : undefined;
  const { records, error } = await loadAgentWorkspace();
  const campaigns = records?.campaigns.filter(({ id }) => !selection || id === selection) ?? [];
  const groups = await Promise.all(campaigns.map(async ({ id, name }): Promise<CampaignPublicationGroup> => {
    try {
      const { publications, skipped, nextCursor } = await listCampaignPublications(id, cursor);
      return { id, name, items: publications, skipped, nextCursor };
    } catch (cause) {
      const unavailable = cause instanceof WorkspaceRequestError && cause.status === 404
        && cause.message === "Unknown workspace request.";
      return {
        id, name, items: [], skipped: 0,
        error: unavailable ? "Publication reviews require oma-agent 20." : "Couldn’t load publications for this campaign.",
      };
    }
  }));
  return <ApprovalQueue groups={groups} selected={Boolean(selection)}
    error={error ?? (!campaigns.length && selection ? "Campaign not found." : undefined)} />;
}

export default function ApprovalsPage(props: Props) {
  return <Suspense fallback={<Loading label="Loading approvals…" />}><Queue {...props} /></Suspense>;
}
