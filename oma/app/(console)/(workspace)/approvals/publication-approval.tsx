/** Submits the displayed publication revision for approval by the signed-in operator. */

"use client";

import { useActionState } from "react";
import { approveCampaignPublicationAction } from "@/app/actions/workspace";
import { Button } from "@/components/ui/button";

export function PublicationApproval({ campaignId, publicationId, revision }: {
  campaignId: string;
  publicationId: string;
  revision: number;
}) {
  const [result, action, pending] = useActionState(
    approveCampaignPublicationAction.bind(null, campaignId, publicationId), {},
  );

  return (
    <form action={action} className="publication-approval">
      <input type="hidden" name="revision" value={revision} />
      {result.error && <p role="alert" className="form-error">{result.error}</p>}
      {result.queued && <p role="status">Publisher queued.</p>}
      <Button type="submit" disabled={pending || result.queued}>
        {pending ? "Approving…" : "Approve and queue"}
      </Button>
    </form>
  );
}
