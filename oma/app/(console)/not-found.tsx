/** Displays missing workspace records inside the console’s existing main landmark. */

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function ConsoleNotFound() {
  return (
    <section className="workspace-page" aria-labelledby="console-not-found-heading">
      <header className="workspace-heading">
        <h1 id="console-not-found-heading">Page not found</h1>
        <p>Check the address or return to your campaigns.</p>
      </header>
      <div><Link className="btn primary" href="/dashboard"><ArrowLeft size={16} aria-hidden="true" /> Back to campaigns</Link></div>
    </section>
  );
}
