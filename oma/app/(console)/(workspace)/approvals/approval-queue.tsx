/** Renders campaign publication previews with their platform, content, and review status. */

import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, ClipboardCheck, FileText, Mail, MessageSquare } from "lucide-react";
import type { CampaignPublication, CampaignPublicationGroup } from "@/lib/server/agent-publications";
import { PublicationApproval } from "./publication-approval";
import { Button } from "@/components/ui/button";

const platformLabels: Record<string, string> = {
  x: "X", twitter: "X", linkedin: "LinkedIn", discord: "Discord", facebook: "Facebook",
  instagram: "Instagram", reddit: "Reddit", slack: "Slack", email: "Email",
};
const statusLabels: Partial<Record<string, string>> = {
  draft: "Draft", pending_approval: "Needs approval", approved: "Approved", queued: "Queued",
  publishing: "Publishing", published: "Published", failed: "Publishing failed",
  rejected: "Rejected", superseded: "Superseded",
};
const kindLabels: Record<string, string> = { post: "Post", reply: "Reply", comment: "Comment", email: "Email" };

export function PublicationCard({ campaignId, publication }: { campaignId: string; publication: CampaignPublication }) {
  const { account, content, target, result, status, platform, kind, id, revision } = publication;
  const platformName = platformLabels[platform] ?? platform.replaceAll("-", " ");
  const accountName = account.displayName || account.handle || account.id;
  const Icon = platform === "email" ? Mail : kind === "reply" ? MessageSquare : FileText;
  return (
    <article className="publication-card" id={`publication-${campaignId}-${id}`} data-platform={platform}>
      <header className="publication-card-heading">
        <span className="publication-avatar">
          {account.avatar
            ? <Image src={account.avatar} alt="" width={36} height={36} referrerPolicy="no-referrer" unoptimized />
            : <Icon aria-hidden="true" size={19} />}
        </span>
        <div className="publication-identity">
          <h3>{accountName}</h3>
          <p>{platformName} · {kindLabels[kind] ?? kind}{account.handle && account.handle !== accountName ? ` · ${account.handle}` : ""}</p>
        </div>
        <span className="approval-status" data-status={status}>{statusLabels[status] ?? status.replaceAll("_", " ")}</span>
      </header>
      <dl className="publication-details">
        <div><dt>Account ID</dt><dd>{account.id}</dd></div>
        <div><dt>Revision</dt><dd>{revision}</dd></div>
      </dl>
      {target && (
        <figure className="publication-target">
          <figcaption>
            Replying to {target.author || target.providerId}
            {target.url && <a href={target.url} target="_blank" rel="noreferrer">View original <ArrowUpRight size={13} aria-hidden="true" /></a>}
          </figcaption>
          {target.text && <blockquote>{target.text}</blockquote>}
          {target.providerId && <p>Target ID {target.providerId}</p>}
        </figure>
      )}
      {content.text && <p className="publication-copy">{content.text}</p>}
      {content.media.length > 0 && (
        <ul className="publication-media" aria-label="Publication media">
          {content.media.map(({ assetId, kind: mediaKind, url, alt }, index) => (
            <li key={`${index}-${assetId}`}>
              {url && mediaKind === "image" && <Image src={url} alt={alt} width={640} height={360}
                referrerPolicy="no-referrer" unoptimized />}
              {url ? <a href={url} target="_blank" rel="noreferrer">
                {mediaKind === "image" ? "View image" : "Open attachment"} {index + 1} <ArrowUpRight size={13} aria-hidden="true" />
              </a> : <p>Attachment {index + 1} · {assetId}</p>}
              {alt && <p>{alt}</p>}
            </li>
          ))}
        </ul>
      )}
      <footer className="publication-card-footer">
        {result?.url && <a href={result.url} target="_blank" rel="noreferrer">View published item <ArrowUpRight size={14} aria-hidden="true" /></a>}
        {result?.providerId && <span>Published ID {result.providerId}</span>}
        {publication.approval?.approvedAt && (
          <span>{publication.approval.source === "automatic" ? "Automatically approved" : `Approved by ${publication.approval.approvedBy}`} · <time dateTime={publication.approval.approvedAt}>
            {publication.approval.approvedAt.slice(0, 10)}
          </time></span>
        )}
        {status === "pending_approval" && <PublicationApproval
          key={revision} campaignId={campaignId} publicationId={id} revision={revision} />}
      </footer>
    </article>
  );
}

export function ApprovalQueue({ groups, selected, error }: {
  groups: CampaignPublicationGroup[];
  selected: boolean;
  error?: string;
}) {
  const pending = groups.reduce((count, group) => count + group.items.filter(({ status }) => status === "pending_approval").length, 0);
  const hasItems = groups.some(({ items, error, skipped }) => items.length > 0 || error || skipped);
  return (
    <div className="page-content approvals-page publication-queue">
      <header className="approvals-heading">
        <div><h1>Approvals</h1><p>Review the exact publication before queuing the campaign’s publisher.</p></div>
        {selected && <Button asChild variant="outline"><Link href="/approvals">All campaigns</Link></Button>}
      </header>
      {error && <p role="alert" className="form-error">{error}</p>}
      {hasItems && <p className="approvals-count"><ClipboardCheck size={17} aria-hidden="true" /> {pending} pending review</p>}
      {groups.filter(({ items, error, skipped }) => items.length > 0 || error || skipped).map((group) => (
        <section className="approval-group" key={group.id} aria-labelledby={"approval-group-" + group.id}>
          <div className="approval-group-heading"><h2 id={"approval-group-" + group.id}>{group.name}</h2></div>
          {group.error && <p role="alert" className="form-error">{group.error}</p>}
          {group.skipped > 0 && <p role="alert" className="form-error">
            {group.skipped} {group.skipped === 1 ? "publication has" : "publications have"} unreadable preview data.
          </p>}
          <div className="publication-list">
            {group.items.map((item) => <PublicationCard key={item.id} campaignId={group.id} publication={item} />)}
          </div>
          {group.nextCursor && <Button asChild variant="outline"><Link
            href={`/approvals?campaign=${group.id}&before=${group.nextCursor}`}>Older publications</Link></Button>}
        </section>
      ))}
      {!error && !hasItems && <div className="approvals-empty">
        <h2>No publications to review</h2>
        <p>Publication drafts submitted by your campaign agents will appear here.</p>
      </div>}
    </div>
  );
}
