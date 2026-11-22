"use client";
import { useState } from "react";
import { ToolkitBrowser } from "@/components/toolkit-browser";
import type { ToolAssignment } from "@/lib/agent-connections";
import type { ConnectionSnapshot } from "@/lib/tool-connection-service";
import type { Toolkit } from "@/lib/tool-catalog";
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
  const [current, setCurrent] = useState(snapshot);
  return (
    <div className="agent-library-page workspace-connections-page">
      <header className="agent-library-heading">
        <div>
          <h1>Tool connections</h1>
          <p>Connect an account here, then add the tool to any campaign that needs it.</p>
        </div>
      </header>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <ToolkitBrowser
        snapshot={current}
        selected={[...new Set(assignments.map((item) => item.toolkit_slug))]}
        metadata={metadata}
        feedback={feedback}
        demo={demo}
        demoCatalog={demoCatalog}
        onChange={(next) => setCurrent(next)}
      />
      {(current.configured || demo) && (
        <p className="connections-sharing-note">Disconnecting an account affects every campaign using it.</p>
      )}
    </div>
  );
}
