/** Displays the campaign’s Kanban task counts or the reason the board could not be read. */

import type { CampaignKanbanStatus } from "@/lib/server/agent-workspace";

const labels = new Map([
  ["triage", "in triage"],
  ["todo", "to do"],
  ["scheduled", "scheduled"],
  ["ready", "ready"],
  ["running", "in progress"],
  ["blocked", "blocked"],
  ["review", "in review"],
  ["done", "done"],
]);
const messages = {
  unconfigured: "No board configured",
  missing: "Board not found",
  ambiguous: "Board name matches multiple boards",
  unavailable: "Status unavailable",
};

export function CampaignKanban({ status }: { status: CampaignKanbanStatus }) {
  const counts = status.state === "ready" ? status.counts : {};
  const stages = new Set([...labels.keys(), ...Object.keys(counts)]);
  const active = [...stages].filter((stage) => counts[stage] > 0);
  return (
    <div className="campaign-kanban">
      <span className="campaign-kanban-label">Kanban</span>
      {active.length ? (
        <ul className="campaign-kanban-counts" aria-label="Kanban task counts">
          {active.map((stage) => (
            <li key={stage}>{counts[stage]} {labels.get(stage) ?? stage.replaceAll(/[-_]/g, " ")}</li>
          ))}
        </ul>
      ) : <span>{status.state === "ready" ? "No tasks yet" : messages[status.state]}</span>}
    </div>
  );
}
