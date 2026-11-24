import { Clock3, LoaderCircle } from "lucide-react";

import type { ActiveAgentRun } from "@/lib/agent-chat";

const activityTime = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" });
const phaseLabels = {
  queued: "Queued…",
  running: "Working on your request…",
  waiting_for_answer: "Waiting for your answer",
  waiting_for_approval: "Waiting for your approval",
  stopping: "Stopping…",
} satisfies Record<ActiveAgentRun["phase"], string>;

const toolLabels = new Map([
  ["web_search", "Searching the web…"],
  ["web_extract", "Reading a web page…"],
  ["browser_navigate", "Opening a web page…"],
  ["browser_snapshot", "Inspecting a web page…"],
  ["read_file", "Reading a file…"],
  ["write_file", "Writing a file…"],
  ["patch", "Editing a file…"],
  ["terminal", "Running a command…"],
  ["skills_search", "Looking up skills…"],
  ["skill_view", "Reading a skill…"],
  ["delegate_task", "Waiting for delegated work…"],
]);

export function ChatProgress({ run, sending, reconnecting }: {
  run?: ActiveAgentRun;
  sending?: boolean;
  reconnecting?: boolean;
}) {
  const waiting = !reconnecting && (run?.phase === "waiting_for_answer" || run?.phase === "waiting_for_approval");
  const label = reconnecting ? "Reconnecting to oma-agent…"
    : sending ? "Sending message…"
    : !run ? "Starting turn…"
    : run.phase === "running" && run.tool ? toolLabels.get(run.tool) ?? "Using a tool…"
    : phaseLabels[run.phase];
  const Icon = waiting ? Clock3 : LoaderCircle;

  return (
    <div className="runtime-progress">
      <p className="runtime-progress-state" role="status">
        <Icon size={16} aria-hidden="true" className={waiting ? undefined : "runtime-progress-spinner"} />
        {label}
      </p>
      {run?.updatedAt && <p className="runtime-progress-time">Last activity: <time dateTime={run.updatedAt}>{activityTime.format(new Date(run.updatedAt))}</time></p>}
    </div>
  );
}
