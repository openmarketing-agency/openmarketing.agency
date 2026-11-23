/** Redirects older approval links to the live campaign publication queue. */

import { redirect } from "next/navigation";

export default function PreviousApprovalPage() {
  redirect("/approvals");
}
