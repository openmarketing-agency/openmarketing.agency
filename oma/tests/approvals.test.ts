/** Checks sample approval identifiers and the mock chat’s draft transformations and validation. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  approvalBodyLimit, approvalCampaigns, approvalDraftSchema, mockApprovals, proposeApprovalRevision,
} from "../lib/approvals";

test("exposes uniquely linked, valid sample approvals for the campaign queue", () => {
  const ids = new Set(mockApprovals.map((approval) => approval.id));
  assert.equal(ids.size, mockApprovals.length);
  for (const campaign of approvalCampaigns) {
    assert.ok(mockApprovals.some((approval) => approval.campaign === campaign.id));
  }
  for (const approval of mockApprovals) {
    assert.equal(approvalDraftSchema.safeParse(approval).success, true);
  }
  assert.equal(approvalDraftSchema.safeParse({ title: "Example", body: "Draft", status: "published" }).success, false);
});

test("offers concrete changes to the current editor text", () => {
  const body = "Start here. Write a plan. Review the draft.";
  assert.equal(proposeApprovalRevision(body, "Make it shorter", "").revision, "Start here. Write a plan.");
  assert.equal(proposeApprovalRevision(body, "Suggest a CTA", "Try the example.").revision, body + "\n\nTry the example.");
  assert.equal(proposeApprovalRevision(body, 'Replace "plan" with "brief"', "").revision, "Start here. Write a brief. Review the draft.");
  assert.equal(proposeApprovalRevision(body, "Add: Share the draft.", "").revision, body + "\n\nShare the draft.");
  assert.equal(proposeApprovalRevision("Draft draft", 'Replace "draft" with "$&"', "").revision, "Draft $&");
});

test("leaves the draft untouched for unsupported, unchanged, empty, or oversized edits", () => {
  assert.equal(proposeApprovalRevision("Draft.", 'Replace "missing" with "new"', "").revision, undefined);
  assert.equal(proposeApprovalRevision("Draft.", 'Replace "Draft." with ""', "").revision, undefined);
  assert.equal(proposeApprovalRevision("Draft.", "Translate this", "").revision, undefined);
  assert.equal(proposeApprovalRevision("One sentence.", "Make it shorter", "").revision, undefined);
  assert.equal(proposeApprovalRevision("", "Suggest a CTA", "Try the example.").revision, undefined);
  assert.equal(proposeApprovalRevision("x".repeat(approvalBodyLimit), "Add: More", "").revision, undefined);
});
