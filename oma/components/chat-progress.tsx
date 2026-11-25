import { Clock3, LoaderCircle } from "lucide-react";

import type { ChatToolCall } from "@/lib/agent-activity";
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

const toolStatus: Record<ChatToolCall["status"], string> = { running: "Running", completed: "Completed", failed: "Failed", recorded: "Recorded" };

export function ChatProgress({ active = true, run, sending, reconnecting, tools = [], recordedTools = [], reasoning }: {
  active?: boolean;
  run?: ActiveAgentRun;
  sending?: boolean;
  reconnecting?: boolean;
  tools?: ChatToolCall[];
  recordedTools?: ChatToolCall[];
  reasoning?: boolean;
}) {
  const waiting = !reconnecting && (run?.phase === "waiting_for_answer" || run?.phase === "waiting_for_approval");
  const label = reconnecting ? "Reconnecting to oma-agent…"
    : sending ? "Sending message…"
    : !run ? "Starting turn…"
    : run.phase === "running" && run.tool ? toolLabels.get(run.tool) ?? "Using a tool…"
    : phaseLabels[run.phase];
  const Icon = waiting ? Clock3 : LoaderCircle;
  const shownTools = tools.length ? tools : recordedTools;
  const latestTool = shownTools.findLast(({ status }) => status === "running") ?? shownTools.at(-1);

  return (
    <div className="runtime-progress">
      {active && <p className="runtime-progress-state" role="status">
        <Icon size={16} aria-hidden="true" className={waiting ? undefined : "runtime-progress-spinner"} />
        {label}
      </p>}
      {active && reasoning && <span className="runtime-progress-time">Reasoning activity reported</span>}
      {active && run?.updatedAt && <p className="runtime-progress-time">Last activity: <time dateTime={run.updatedAt}>{activityTime.format(new Date(run.updatedAt))}</time></p>}
      {latestTool && <details className="runtime-tool-activity">
        <summary>{tools.length ? "Tool activity" : "Recent tool activity"} <span>· {latestTool.name.replaceAll("_", " ")} — {toolStatus[latestTool.status]}</span></summary>
        <ul aria-label="Recent tool calls">
          {shownTools.slice().reverse().map(({ id, name, status }) => (
            <li key={id ? "call:" + id : "name:" + name}><span>{name.replaceAll("_", " ")}</span><span>{toolStatus[status]}</span></li>
          ))}
        </ul>
      </details>}
    </div>
  );
}
