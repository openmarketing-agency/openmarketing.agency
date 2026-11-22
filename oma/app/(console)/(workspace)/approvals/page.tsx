/** Shows the signed-in console’s campaign approval queue using sample drafts. */

import { Suspense } from "react";

import { Loading } from "@/components/ui";
import { requireUser } from "@/lib/dal";

import { ApprovalQueue } from "./approval-queue";
import "./approvals.css";

export const metadata = { title: "Approvals" };

async function Queue() {
  const user = await requireUser();
  return <ApprovalQueue userId={user.id} />;
}

export default function ApprovalsPage() {
  return <Suspense fallback={<Loading label="Loading approvals…" />}><Queue /></Suspense>;
}
