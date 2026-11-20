import type { Metadata } from "next";

import { PlaybookLibrary } from "@/components/playbook-library";

export const metadata: Metadata = { title: "Playbooks" };

export default function DashboardPage() {
  return <PlaybookLibrary />;
}
