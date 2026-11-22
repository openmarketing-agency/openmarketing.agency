/** Opens a sample approval from a stable URL inside the authenticated workspace. */

import { Suspense } from "react";
import { notFound } from "next/navigation";

import { Loading } from "@/components/ui";
import { mockApprovals } from "@/lib/approvals";
import { requireUser } from "@/lib/dal";

import { ApprovalReview } from "../approval-review";
import "../approvals.css";

export const metadata = { title: "Review approval" };

type Props = { params: Promise<{ id: string }> };

async function Review({ params }: Props) {
  const [user, { id }] = await Promise.all([requireUser(), params]);
  const approval = mockApprovals.find((item) => item.id === id);
  if (!approval) notFound();
  return <ApprovalReview key={approval.id} approval={approval} userId={user.id} />;
}

export default function ApprovalPage(props: Props) {
  return <Suspense fallback={<Loading label="Loading draft…" />}><Review {...props} /></Suspense>;
}
