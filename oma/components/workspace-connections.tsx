"use client";
import Link from "next/link";
import { Cable, Megaphone } from "lucide-react";
import { ToolkitBrowser } from "@/components/toolkit-browser";
import type { ConnectionSnapshot } from "@/lib/tool-connection-service";
import type { Toolkit } from "@/lib/tool-catalog";
import "./workspace-connections.css";
export function WorkspaceConnections({
  snapshot,
  selected,
  metadata,
  feedback,
  error,
  demo = false,
  demoCatalog,
}: {
  snapshot: ConnectionSnapshot;
  selected: string[];
  metadata: Toolkit[];
  feedback?: string;
  error?: string;
  demo?: boolean;
  demoCatalog?: Toolkit[];
}) {
  return (
    <div className="agent-library-page workspace-connections-page">
      <header className="agent-library-heading">
        <div>
          <h1>Tool connections</h1>
          <p>Manage the accounts your campaigns can use.</p>
        </div>
      </header>
      <div className="connections-overview">
        <div><Cable size={17} aria-hidden="true" /><div><h2>Shared accounts</h2><p>Connect an account once for campaigns to reuse. Disconnecting it affects every campaign using it.</p></div></div>
        <div><Megaphone size={17} aria-hidden="true" /><div><h2>Campaign tools</h2><p>See the integrations configured for each campaign in <Link href="/dashboard">Campaigns</Link>.</p></div></div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <ToolkitBrowser
        snapshot={snapshot}
        selected={selected}
        metadata={metadata}
        feedback={feedback}
        demo={demo}
        demoCatalog={demoCatalog}
      />
    </div>
  );
}
