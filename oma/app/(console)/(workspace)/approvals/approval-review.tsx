/** Edits an individual sample draft and records its approval decision in the browser. */

"use client";

import { ArrowLeft, Check, FileText, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  approvalBodyLimit, approvalCampaigns, approvalStatusLabels, approvalTitleLimit,
  type Approval, type ApprovalStatus,
} from "@/lib/approvals";
import { useApprovalDrafts } from "@/lib/approval-storage";

import { ApprovalChat } from "./approval-chat";

type Copy = { title: string; body: string };
type Notice = { message: string; error?: true };

const savedMessages: Record<ApprovalStatus, string> = {
  pending: "Review reopened.",
  changes: "Changes requested.",
  approved: "Draft approved.",
};

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function ApprovalReview({ approval, userId }: { approval: Approval; userId: string }) {
  const { drafts, save } = useApprovalDrafts(userId);
  const saved = drafts[approval.id] ?? approval;
  const [edits, setEdits] = useState<Copy>();
  const [notice, setNotice] = useState<Notice>();
  const draft = edits ?? saved;
  const approved = saved.status === "approved";
  const dirty = draft.title !== saved.title || draft.body !== saved.body;
  const campaign = approvalCampaigns.find((group) => group.id === approval.campaign);

  function change(copy: Partial<Copy>, feedback?: string) {
    setEdits({ title: draft.title, body: draft.body, ...copy });
    setNotice(feedback ? { message: feedback } : undefined);
  }

  function persist(status?: ApprovalStatus) {
    const title = draft.title.trim();
    const body = draft.body.trim();
    if (!title || !body) {
      setNotice({ message: "Enter a title and draft copy before saving.", error: true });
      return;
    }
    if (!save(approval.id, { title, body, status: status ?? saved.status })) {
      setNotice({ message: "Couldn’t save in this browser. Check whether browser storage is available, then try again.", error: true });
      return;
    }
    setEdits(undefined);
    setNotice({ message: status ? savedMessages[status] : "Draft saved in this browser." });
  }

  return (
    <div className="page-content approvals-page approval-detail">
      <Link href="/approvals" className="approval-back"><ArrowLeft size={16} aria-hidden="true" /> All approvals</Link>

      <header className="approvals-heading approval-detail-heading">
        <div>
          <h1>{saved.title}</h1>
          <p>{campaign?.name} <span aria-hidden="true">·</span> {approval.format} <span aria-hidden="true">·</span> Sample draft</p>
        </div>
        <span className="approval-status" data-status={saved.status}>{approvalStatusLabels[saved.status]}</span>
      </header>

      <div className="approval-review-grid">
        <section className="approval-editor" aria-labelledby="approval-editor-title">
          <header className="approval-editor-heading">
            <div className="approval-editor-heading-title">
              <FileText size={18} aria-hidden="true" />
              <h2 id="approval-editor-title">Draft</h2>
            </div>
            <a className="approval-chat-jump" href="#approval-chat"><MessageSquare size={15} aria-hidden="true" /> Edit with chat</a>
          </header>

          <form className="approval-editor-form" onSubmit={(event) => { event.preventDefault(); if (!approved && dirty) persist(); }}>
            <dl className="approval-editor-meta">
              <div><dt>Channel</dt><dd>{approval.channel}</dd></div>
              <div><dt>Submitted</dt><dd><time dateTime={approval.submitted}>{dateFormat.format(new Date(approval.submitted))}</time></dd></div>
            </dl>

            <label htmlFor="approval-draft-title">Title</label>
            <input id="approval-draft-title" value={draft.title} maxLength={approvalTitleLimit}
              onChange={(event) => change({ title: event.target.value })} readOnly={approved} />

            <label htmlFor="approval-draft-body">Draft copy</label>
            <textarea id="approval-draft-body" value={draft.body} maxLength={approvalBodyLimit} rows={8}
              onChange={(event) => change({ body: event.target.value })} readOnly={approved} />

            <div className="approval-editor-footer">
              {notice?.error
                ? <p role="alert" className="approval-editor-error">{notice.message}</p>
                : <p role="status">{notice?.message ?? (dirty ? "Unsaved changes" : "")}</p>}
              {approved ? (
                <button type="button" className="btn secondary" onClick={() => persist("pending")}>Reopen review</button>
              ) : (
                <div className="approval-editor-actions">
                  <button className="btn secondary" type="submit" disabled={!dirty}>Save draft</button>
                  {saved.status !== "changes" && (
                    <button className="btn ghost" type="button" onClick={() => persist("changes")}>Request changes</button>
                  )}
                  <button className="btn primary" type="button" onClick={() => persist("approved")}>
                    <Check size={16} aria-hidden="true" /> Approve draft
                  </button>
                </div>
              )}
            </div>
          </form>
        </section>

        <ApprovalChat body={draft.body} cta={approval.cta} disabled={approved}
          onApply={(body) => change({ body }, "Suggestion applied. Save the draft to keep it.")} />
      </div>
    </div>
  );
}
