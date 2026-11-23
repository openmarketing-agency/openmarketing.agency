import Link from "next/link";
import { Brand } from "@/components/brand";
import "@/components/auth-layout.css";

export default function NotFound() {
  return (
    <div className="workspace-entry">
      <header className="workspace-entry-bar"><Brand href="/" /></header>
      <main id="main-content" tabIndex={-1} className="entry-form-panel entry-missing-page">
        <h1>Page not found</h1>
        <p>Check the address or return to your campaign workspace.</p>
        <Link className="btn primary" href="/dashboard">
          Back to campaigns
        </Link>
      </main>
    </div>
  );
}
