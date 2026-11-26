/** Lists campaign publication previews beside a pinned review pane for the selected post. */

"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, FileText, Mail, MessageSquare } from "lucide-react";
import { useState } from "react";
import type { CampaignPublication, CampaignPublicationGroup } from "@/lib/server/agent-publications";
import { markdownText } from "@/lib/workspace-document";
import { MarkdownContent } from "@/components/workspace-document";
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
const numberFormat = new Intl.NumberFormat("en");

type Entry = { campaignId: string; publication: CampaignPublication };
type Filter = "pending" | "all";

const entryKey = ({ campaignId, publication }: Entry) => campaignId + "/" + publication.id;
const statusLabel = (status: string) => statusLabels[status] ?? status.replaceAll("_", " ");

function describe(publication: CampaignPublication) {
  const { account, platform, kind } = publication;
  const accountName = account.displayName || account.handle || account.id;
  const platformName = platformLabels[platform] ?? platform.replaceAll("-", " ");
  return { accountName, meta: `${platformName} · ${kindLabels[kind] ?? kind}` };
}

function Avatar({ publication, size }: { publication: CampaignPublication; size: number }) {
  const { account, platform, kind } = publication;
  const Icon = platform === "email" ? Mail : kind === "reply" ? MessageSquare : FileText;
  return <span className="publication-avatar" data-platform={platform} style={{ width: size, height: size, flexBasis: size }}>
    {account.avatar
      ? <Image src={account.avatar} alt="" width={size} height={size} referrerPolicy="no-referrer" unoptimized />
      : <Icon aria-hidden="true" size={Math.round(size / 2)} />}
  </span>;
}

function ReplyTarget({ target }: { target: NonNullable<CampaignPublication["target"]> }) {
  const [open, setOpen] = useState(false);
  const long = target.text.length > 280;
  return <figure className="publication-target">
    <figcaption>
      Replying to {target.author || target.providerId}
      {target.url && <a href={target.url} target="_blank" rel="noreferrer">View original <ArrowUpRight size={13} aria-hidden="true" /></a>}
    </figcaption>
    {target.text && <blockquote data-clamped={long && !open || undefined}>{target.text}</blockquote>}
    {long && <button type="button" className="publication-more" onClick={() => setOpen(!open)}>
      {open ? "Show less" : "Show full message"}
    </button>}
  </figure>;
}

/** Shows one publication in full, with the approval action kept in view while the copy scrolls. */
export function PublicationReview({ campaignId, publication, position, onMove, onBack }: Entry & {
  position?: { index: number; total: number };
  onMove?: (step: number) => void;
  onBack?: () => void;
}) {
  const [plain, setPlain] = useState(false);
  const { account, content, target, result, status, id, revision, approval } = publication;
  const { accountName, meta } = describe(publication);
  const characters = [...content.text].length;
  return (
    <article className="publication-review" id={`publication-${campaignId}-${id}`} aria-labelledby={`publication-${id}-title`}>
      <header className="publication-review-heading">
        {onBack && <button type="button" className="publication-back" onClick={onBack}>
          <ArrowLeft size={15} aria-hidden="true" /> All posts
        </button>}
        <div className="publication-review-identity">
          <Avatar publication={publication} size={40} />
          <div className="publication-identity">
            <h3 id={`publication-${id}-title`}>{accountName}</h3>
            <p>{meta}{account.handle && account.handle !== accountName ? ` · ${account.handle}` : ""}</p>
          </div>
          <span className="approval-status" data-status={status}>{statusLabel(status)}</span>
        </div>
        <div className="publication-review-actions">
          {position && onMove && position.total > 1 && <div className="publication-stepper">
            <Button type="button" variant="ghost" aria-label="Previous post" disabled={position.index === 0}
              onClick={() => onMove(-1)}><ChevronLeft size={16} aria-hidden="true" /></Button>
            <span>{position.index + 1} of {position.total}</span>
            <Button type="button" variant="ghost" aria-label="Next post" disabled={position.index === position.total - 1}
              onClick={() => onMove(1)}><ChevronRight size={16} aria-hidden="true" /></Button>
          </div>}
          {status === "pending_approval" && <PublicationApproval
            key={revision} campaignId={campaignId} publicationId={id} revision={revision} />}
        </div>
      </header>

      <div className="publication-review-body" role="region" aria-label="Publication content" tabIndex={0}>
        {target && <ReplyTarget target={target} />}
        {content.text && <section className="publication-copy-section" aria-label="Post copy">
          <div className="publication-copy-toolbar">
            <span>{numberFormat.format(characters)} {characters === 1 ? "character" : "characters"}</span>
            <div className="publication-view-toggle" role="group" aria-label="Copy view">
              <button type="button" aria-pressed={!plain} onClick={() => setPlain(false)}>Formatted</button>
              <button type="button" aria-pressed={plain} onClick={() => setPlain(true)}>Exact text</button>
            </div>
          </div>
          {plain
            ? <pre className="publication-copy-plain">{content.text}</pre>
            : <MarkdownContent className="doc-compact publication-copy" text={content.text} plain />}
        </section>}
        {content.media.length > 0 && (
          <ul className="publication-media" aria-label="Publication media">
            {content.media.map(({ assetId, kind: mediaKind, url, alt }, index) => (
              <li key={`${index}-${assetId}`}>
                {url && mediaKind === "image" && <a href={url} target="_blank" rel="noreferrer">
                  <Image src={url} alt={alt} width={640} height={360} referrerPolicy="no-referrer" unoptimized />
                </a>}
                {url ? (mediaKind !== "image" && <a href={url} target="_blank" rel="noreferrer">
                  Open attachment {index + 1} <ArrowUpRight size={13} aria-hidden="true" />
                </a>) : <p>Attachment {index + 1} · {assetId}</p>}
                {alt && <p>{alt}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="publication-review-footer">
        <span>Account ID {account.id}</span>
        <span>Revision {revision}</span>
        {result?.url && <a href={result.url} target="_blank" rel="noreferrer">View published item <ArrowUpRight size={13} aria-hidden="true" /></a>}
        {result?.providerId && <span>Published ID {result.providerId}</span>}
        {approval?.approvedAt && (
          <span>{approval.source === "automatic" ? "Automatically approved" : `Approved by ${approval.approvedBy}`} · <time dateTime={approval.approvedAt}>
            {approval.approvedAt.slice(0, 10)}
          </time></span>
        )}
      </footer>
    </article>
  );
}

export function ApprovalQueue({ groups, selected, error }: {
  groups: CampaignPublicationGroup[];
  selected: boolean;
  error?: string;
}) {
  const shown = groups.filter(({ items, error, skipped }) => items.length > 0 || error || skipped);
  const entries: Entry[] = shown.flatMap((group) => group.items.map((publication) => ({ campaignId: group.id, publication })));
  const pending = entries.filter(({ publication }) => publication.status === "pending_approval").length;
  const [filter, setFilter] = useState<Filter>(pending ? "pending" : "all");
  const [active, setActive] = useState<string>();
  const [detail, setDetail] = useState(false);
  const visible = entries.filter(({ publication }) => filter === "all" || publication.status === "pending_approval");
  const current = visible.find((entry) => entryKey(entry) === active) ?? visible[0];
  const index = current ? visible.indexOf(current) : -1;

  function open(entry: Entry) {
    setActive(entryKey(entry));
    setDetail(true);
  }

  return (
    <div className="page-content approvals-page publication-queue" data-view={detail && current ? "detail" : "list"}>
      <header className="approvals-heading">
        <div><h1>Approvals</h1><p>Review the exact publication before queuing the campaign’s publisher.</p></div>
        {selected && <Button asChild variant="outline"><Link href="/approvals">All campaigns</Link></Button>}
      </header>
      {error && <p role="alert" className="form-error">{error}</p>}

      {shown.length > 0 && <>
        <div className="approval-filters" role="group" aria-label="Show publications">
          <button type="button" aria-pressed={filter === "pending"} onClick={() => setFilter("pending")}>
            Needs approval <span>{pending}</span>
          </button>
          <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All <span>{entries.length}</span>
          </button>
        </div>

        <div className="approval-workspace">
          <nav className="approval-list" aria-label="Publications">
            {shown.map((group) => {
              const items = visible.filter(({ campaignId }) => campaignId === group.id);
              return <section className="approval-group" key={group.id} aria-labelledby={"approval-group-" + group.id}>
                <h2 id={"approval-group-" + group.id}>{group.name}</h2>
                {group.error && <p role="alert" className="form-error">{group.error}</p>}
                {group.skipped > 0 && <p role="alert" className="form-error">
                  {group.skipped} {group.skipped === 1 ? "publication has" : "publications have"} unreadable preview data.
                </p>}
                {items.length > 0 ? <ul>
                  {items.map((entry) => {
                    const { publication } = entry;
                    const { accountName, meta } = describe(publication);
                    const preview = markdownText(publication.content.text)
                      || (publication.content.media.length ? `${publication.content.media.length} attachment${publication.content.media.length === 1 ? "" : "s"}` : "");
                    return <li key={publication.id}>
                      <button type="button" className="approval-list-item" aria-current={entry === current || undefined}
                        onClick={() => open(entry)}>
                        <Avatar publication={publication} size={32} />
                        <span className="approval-list-text">
                          <span className="approval-list-title">
                            <strong>{accountName}</strong>
                            <span className="approval-status" data-status={publication.status}>{statusLabel(publication.status)}</span>
                          </span>
                          <span className="approval-list-meta">{meta}</span>
                          {preview && <span className="approval-list-preview">{preview}</span>}
                        </span>
                      </button>
                    </li>;
                  })}
                </ul> : !group.error && <p className="approval-list-empty">
                  {filter === "pending" ? "Nothing waiting for approval." : "No publications."}
                </p>}
                {group.nextCursor && <Button asChild variant="outline"><Link
                  href={`/approvals?campaign=${group.id}&before=${group.nextCursor}`}>Older publications</Link></Button>}
              </section>;
            })}
          </nav>

          {current
            ? <PublicationReview key={entryKey(current)} {...current}
              position={{ index, total: visible.length }}
              onMove={(step) => { const next = visible[index + step]; if (next) setActive(entryKey(next)); }}
              onBack={() => setDetail(false)} />
            : <div className="publication-review publication-review-empty">
              <h2>{filter === "pending" ? "All caught up" : "No publications"}</h2>
              <p>{filter === "pending" ? "Nothing is waiting for approval right now." : "Publications will appear here."}</p>
              {filter === "pending" && entries.length > 0 && <Button type="button" variant="outline" onClick={() => setFilter("all")}>Show all publications</Button>}
            </div>}
        </div>
      </>}

      {!error && !shown.length && <div className="approvals-empty">
        <h2>No publications to review</h2>
        <p>Publication drafts submitted by your campaign agents will appear here.</p>
      </div>}
    </div>
  );
}
