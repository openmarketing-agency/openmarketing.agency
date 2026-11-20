import type { Metadata } from "next";

import { CampaignLibrary } from "@/components/campaign-library";

export const metadata: Metadata = { title: "Campaigns" };

export default function DashboardPage() {
  return <CampaignLibrary />;
}
