"use client";
import Link from "next/link";
import { Cable, Megaphone } from "lucide-react";
import { ToolkitBrowser } from "@/components/toolkit-browser";
import type { ToolAssignment } from "@/lib/agent-connections";
import type { ConnectionSnapshot } from "@/lib/tool-connection-service";
import type { Toolkit } from "@/lib/tool-catalog";
import "./workspace-connections.css";
export function WorkspaceConnections({
  snapshot,
  assignments,
  metadata,
  feedback,
  error,
  demo = false,
  demoCatalog,
}: {
  snapshot: ConnectionSnapshot;
  assignments: ToolAssignment[];
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
        <div><Megaphone size={17} aria-hidden="true" /><div><h2>Campaign tools</h2><p>Choose which tools a campaign can use from its Tools tab in <Link href="/dashboard">Campaigns</Link>.</p></div></div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <ToolkitBrowser
        snapshot={snapshot}
        selected={[...new Set(assignments.map((item) => item.toolkit_slug))]}
        metadata={metadata}
        feedback={feedback}
        demo={demo}
        demoCatalog={demoCatalog}
      />
    </div>
  );
}
