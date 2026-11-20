import Link from "next/link";
import { Brand } from "@/components/brand";
export default function NotFound() {
  return (
    <main id="main-content" className="page-content">
      <Brand />
      <div className="empty-state" style={{ marginTop: 40 }}>
        <h1>Campaign not found</h1>
        <p>This page may have moved. Find your next workflow in the library.</p>
        <Link className="btn primary" href="/dashboard">
          Back to campaigns
        </Link>
      </div>
    </main>
  );
}
