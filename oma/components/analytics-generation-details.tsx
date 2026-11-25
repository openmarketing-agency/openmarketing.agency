/** Shows the live data sources and the saved inputs and output for a campaign dashboard. */

import type { AnalyticsReport } from "@/lib/analytics";

export function AnalyticsGenerationDetails({ report }: { report?: AnalyticsReport | null }) {
  return (
    <details className="analytics-generation">
      <summary>Generation details</summary>
      <div className="analytics-generation-body">
        <p>oma-agent’s default profile generates the OpenUI layout once. The console saves its source in SQLite and reads new observations as they become available.</p>
        <h3>Data sources</h3>
        <dl>
          <div>
            <dt>Campaign observations</dt>
            <dd>The campaign analyst records OMA publication measurements and any configured Google Analytics or Search Console measurements.</dd>
          </div>
          {report && !report.dataSource && (
            <div>
              <dt>Workspace activity</dt>
              <dd>The saved activity layout still reads the campaign board, scheduled jobs, and recent publication records.</dd>
            </div>
          )}
        </dl>
        {report ? (
          <div className="analytics-generation-messages">
            {report.generation ? (
              <>
                <GenerationText label="System prompt" text={report.generation.systemPrompt} />
                <GenerationText label="User message" text={report.generation.userMessage}>
                  The user message is unavailable for this runtime version.
                </GenerationText>
              </>
            ) : <p>Prompts were unavailable when this dashboard was saved.</p>}
            <GenerationText label="Agent-generated OpenUI source" text={report.source} />
          </div>
        ) : <p>Generate a dashboard to inspect its prompts and source.</p>}
      </div>
    </details>
  );
}

function GenerationText({ label, text, children }: { label: string; text?: string; children?: string }) {
  return (
    <details>
      <summary>{label}</summary>
      {text ? <pre tabIndex={0} role="region" aria-label={label}><code>{text}</code></pre> : <p>{children}</p>}
    </details>
  );
}
