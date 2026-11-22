/** Groups review items by campaign and reflects draft decisions saved in this browser. */

"use client";

import { ArrowUpRight, ClipboardCheck, FileText, Mail, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useApprovalDrafts } from "@/lib/approval-storage";
import { approvalCampaigns, approvalStatusLabels, mockApprovals } from "@/lib/approvals";

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function ApprovalQueue({ userId }: { userId: string }) {
  const { drafts } = useApprovalDrafts(userId);
  const [campaign, setCampaign] = useState("all");
  const [status, setStatus] = useState("all");
  const approvals = mockApprovals.map((item) => ({ ...item, ...drafts[item.id] }));
  const pending = approvals.filter((item) => item.status === "pending").length;
  const groups = approvalCampaigns
    .filter((group) => campaign === "all" || campaign === group.id)
    .map((group) => ({
      ...group,
      items: approvals.filter((item) => item.campaign === group.id && (status === "all" || status === item.status)),
    }))
    .filter((group) => group.items.length > 0);
  const shown = groups.reduce((count, group) => count + group.items.length, 0);

  return (
    <div className="page-content approvals-page">
      <header className="approvals-heading">
        <div>
          <h1>Approvals</h1>
          <p>Review campaign drafts and make edits before approving them.</p>
        </div>
        <span className="approval-preview-label">Sample drafts</span>
      </header>

      <div className="approvals-toolbar">
        <p className="approvals-count" aria-live="polite">
          <ClipboardCheck size={17} aria-hidden="true" /> {shown} {shown === 1 ? "draft" : "drafts"} shown
          <span className="approvals-pending">{pending} pending review</span>
        </p>
        <div className="approvals-filters">
          <label>
            <span>Campaign</span>
            <select value={campaign} onChange={(event) => setCampaign(event.target.value)}>
              <option value="all">All campaigns</option>
              {approvalCampaigns.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">All statuses</option>
              {Object.entries(approvalStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
      </div>

      {groups.length ? (
        <div className="approval-groups">
          {groups.map((group) => (
            <section className="approval-group" key={group.id} aria-labelledby={"approval-group-" + group.id}>
              <div className="approval-group-heading">
                <h2 id={"approval-group-" + group.id}>{group.name}</h2>
                <span>{group.items.length} {group.items.length === 1 ? "draft" : "drafts"}</span>
              </div>
              <ul>
                {group.items.map((item) => {
                  const Icon = item.format === "Email" ? Mail : item.channel === "Blog" || item.channel === "Website" ? FileText : MessageSquare;
                  return (
                    <li key={item.id}>
                      <Link href={"/approvals/" + item.id} className="approval-row">
                        <span className="approval-draft-ident">
                          <span className="approval-format-icon"><Icon size={17} aria-hidden="true" /></span>
                          <span><strong>{item.title}</strong><span className="approval-format">{item.format}</span></span>
                        </span>
                        <span className="approval-status" data-status={item.status}>{approvalStatusLabels[item.status]}</span>
                        <time dateTime={item.submitted}>{dateFormat.format(new Date(item.submitted))}</time>
                        <ArrowUpRight className="approval-row-arrow" size={17} aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div className="approvals-empty">
          <h2>No drafts match these filters</h2>
          <button type="button" className="btn secondary" onClick={() => { setCampaign("all"); setStatus("all"); }}>Clear filters</button>
        </div>
      )}
    </div>
  );
}
