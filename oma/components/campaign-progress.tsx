/** Shows the selected campaign’s Kanban tasks, run history, scheduled jobs, and publication activity. */

"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ChevronDown, RefreshCw, Search } from "lucide-react";
import { CampaignAgentActivity } from "./campaign-agent-activity";
import { useCampaignFeed } from "./use-campaign-feed";
import { CampaignKanban } from "./campaign-kanban";
import type { CampaignKanbanStatus } from "@/lib/server/agent-workspace";
import type { CampaignProgressSnapshot, CampaignTask, CampaignTaskActivity } from "@/lib/server/campaign-progress";
import { Button } from "@/components/ui/button";
import { MarkdownContent } from "@/components/workspace-document";
import { markdownText } from "@/lib/workspace-document";
import { describeSchedule } from "@/lib/job-schedule";
import { relativeTime } from "@/lib/relative-time";
import { Input } from "@/components/ui/input";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const groups = [
  { id: "all", label: "All tasks" },
  { id: "running", label: "In progress" },
  { id: "attention", label: "Needs attention" },
  { id: "queued", label: "Queued" },
  { id: "done", label: "Done" },
] as const;
type Group = typeof groups[number]["id"];

function label(value: string) {
  const names: Record<string, string> = {
    running: "In progress", ready: "Ready", todo: "To do", triage: "Triage", review: "In review",
    pending_approval: "Needs approval", ok: "Succeeded", error: "Failed", delivery_failed: "Delivery failed",
    claimed: "Agent started", completed: "Completed", gave_up: "Retries exhausted",
  };
  return Object.hasOwn(names, value) ? names[value] : (value ? value[0].toUpperCase() + value.slice(1).replaceAll("_", " ") : "Unknown");
}

function taskGroup(status: string): Exclude<Group, "all"> {
  if (status === "running" || status === "done") return status;
  if (status === "blocked" || status === "review" || status === "failed" || status === "triage") return "attention";
  return "queued";
}

function agentName(agents: Record<string, string>, profile: string) {
  return Object.hasOwn(agents, profile) ? agents[profile] : profile;
}

function toDate(value: number | string | null) {
  if (!value) return null;
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function time(value: number | string | null) {
  const date = toDate(value);
  return date && <time dateTime={date.toISOString()}>{dateFormat.format(date)}</time>;
}

/** Shows "3 h ago" with the exact date and time on hover. */
function ago(value: number | string | null) {
  const date = toDate(value);
  return date && <time dateTime={date.toISOString()} title={dateFormat.format(date)}>{relativeTime(date)}</time>;
}

const summaryTiles: { id: Exclude<Group, "all">; label: string }[] = [
  { id: "attention", label: "Needs attention" },
  { id: "running", label: "In progress" },
  { id: "queued", label: "Queued" },
  { id: "done", label: "Done" },
];

const boardMessages = {
  unconfigured: "This campaign has no Kanban board yet. Starting a draft creates its board.",
  missing: "The saved Kanban board is missing or archived.",
  ambiguous: "More than one Kanban board has the saved name. Set a specific board ID in the campaign configuration.",
  unavailable: "The Kanban board is unavailable. Refresh to try again.",
};

function TaskDetail({ path, refresh, agents }: { path: string; refresh: number; agents: Record<string, string> }) {
  const state = useCampaignFeed<CampaignTaskActivity>(path, refresh);
  if (!state) return <p role="status">Loading task activity…</p>;
  const task = state.data;
  return <>
    {state.error && <p className="form-error" role="status">{state.error}</p>}
    {task && <>
      {task.body && <MarkdownContent className="doc-compact campaign-progress-text" text={task.body} />}
      {task.blockReason && <p className="campaign-progress-warning"><strong>Blocked</strong> · {task.blockReason}</p>}
      {task.result && <div><h4>Result</h4><MarkdownContent className="doc-compact campaign-progress-text" text={task.result} /></div>}
      {task.runs.length > 0 && <div>
        <h4>Recent run attempts</h4>
        <ul className="campaign-progress-list">
          {task.runs.map((run) => <li key={run.id}>
            <div className="campaign-progress-row">
              <strong>{label(run.outcome || run.status)}</strong>
              {run.profile && <span>{agentName(agents, run.profile)}</span>}
              {time(run.endedAt ?? run.startedAt)}
            </div>
            {run.error && <p className="campaign-progress-warning">{run.error}</p>}
            {run.summary && run.summary !== task.result && <MarkdownContent className="doc-compact campaign-progress-text" text={run.summary} />}
          </li>)}
        </ul>
      </div>}
      {task.events.length > 0 && <div>
        <h4>Recent task events</h4>
        <ol className="campaign-progress-list">
          {task.events.map(({ id, kind, at }) => <li className="campaign-progress-row" key={id}>
            <span>{label(kind)}</span>{time(at)}
          </li>)}
        </ol>
      </div>}
      {!task.body && !task.blockReason && !task.result && task.runs.length === 0 && task.events.length === 0 &&
        <p>This task has no recorded activity yet.</p>}
    </>}
  </>;
}

export function CampaignProgress({ campaign, agents, kanban }: {
  campaign: string;
  agents: Record<string, string>;
  kanban: CampaignKanbanStatus;
}) {
  const path = "/api/campaigns/" + campaign + "/progress";
  const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState<Group>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string>();
  const [pageSize, setPageSize] = useState(20);
  const id = useId();
  const state = useCampaignFeed<CampaignProgressSnapshot>(path, refresh);
  const snapshot = state?.data;
  const tasks = snapshot?.board.state === "ready" ? snapshot.board.tasks : [];
  const totals = { all: tasks.length, running: 0, attention: 0, queued: 0, done: 0 };
  for (const task of tasks) totals[taskGroup(task.status)]++;
  const order = { attention: 0, running: 1, queued: 2, done: 3 };
  const search = query.trim().toLowerCase();
  const filtered = tasks.filter((task) => (filter === "all" || taskGroup(task.status) === filter)
    && (!search || (task.title + " " + agentName(agents, task.assignee)).toLowerCase().includes(search)))
    .sort((a, b) => order[taskGroup(a.status)] - order[taskGroup(b.status)]);
  const jobs = snapshot?.schedule.jobs ?? [];
  const nextJob = jobs.map((job) => ({ job, at: toDate(job.nextRun) })).filter(({ at }) => at)
    .sort((a, b) => a.at!.getTime() - b.at!.getTime())[0];

  function choose(group: Group) {
    setFilter(group);
    setPageSize(20);
    setExpanded(undefined);
  }

  function taskInfo(task: CampaignTask) {
    if (task.status === "done" && task.completedAt) return <>Completed {ago(task.completedAt)}</>;
    if (task.status === "running" && task.startedAt) return <>Started {ago(task.startedAt)}</>;
    if (task.createdAt) return <>Added {ago(task.createdAt)}</>;
    return null;
  }

  return (<>
    <section className="campaign-progress" aria-labelledby={id + "-tasks"}>
      <header className="campaign-progress-header">
        <div>
          <h2 id={id + "-tasks"}>Tasks</h2>
          <p className="campaign-progress-live" data-error={state?.error ? "" : undefined}>
            <span aria-hidden="true" />
            {!state ? "Loading…" : state.error ? "Couldn’t refresh" : "Live"}
            {state?.updatedAt && <> · updated {relativeTime(new Date(state.updatedAt))}</>}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => setRefresh((value) => value + 1)}>
          <RefreshCw size={15} aria-hidden="true" /> Refresh
        </Button>
      </header>
      {!state && <p role="status">Loading campaign progress…</p>}
      {state?.error && <p className="form-error" role="status">{state.error}{snapshot ? " Showing the last available progress." : ""}</p>}
      {kanban.state === "ready" && ((state?.error && !snapshot) || snapshot?.board.state === "unavailable") &&
        <CampaignKanban status={kanban} />}
      {snapshot && <>
        {snapshot.board.state !== "ready" ? <p className="campaign-progress-empty">{boardMessages[snapshot.board.state]}</p>
          : tasks.length === 0 ? <div className="campaign-progress-empty-state">
            <p><strong>No tasks yet.</strong> Tasks appear here as the campaign’s agents add them to Kanban.</p>
          </div>
          : <>
            <div className="campaign-progress-summary" role="group" aria-label="Filter tasks by status">
              {summaryTiles.map(({ id: group, label: name }) => (
                <button key={group} type="button" data-group={group} aria-pressed={filter === group}
                  disabled={totals[group] === 0 && filter !== group}
                  onClick={() => choose(filter === group ? "all" : group)}>
                  <span className="campaign-progress-summary-label">{name}</span>
                  <span className="campaign-progress-summary-count">{totals[group]}</span>
                </button>
              ))}
            </div>
            <div className="campaign-progress-tools">
              <p>{filter === "all" ? `All ${totals.all} tasks` : `${filtered.length} of ${totals.all} tasks · ${groups.find(({ id }) => id === filter)?.label}`}
                {filter !== "all" && <> · <button type="button" className="campaign-link-button" onClick={() => choose("all")}>Show all</button></>}</p>
              {tasks.length > 8 && <label className="search-box campaign-progress-search">
                <Search size={15} aria-hidden="true" />
                <Input type="search" value={query} placeholder="Search tasks or agents" aria-label="Search tasks"
                  onChange={(event) => { setQuery(event.target.value); setPageSize(20); }} />
              </label>}
            </div>
            {filtered.length === 0 && <p className="campaign-progress-empty">{search ? "No tasks match this search." : "No tasks match this status."}</p>}
            <ul className="campaign-progress-tasks">
              {filtered.slice(0, pageSize).map((task) => {
                const open = expanded === task.id;
                const detailId = id + "-" + task.id;
                const assignee = agentName(agents, task.assignee);
                return <li key={task.id} data-open={open || undefined}>
                  <button type="button" className="campaign-progress-task" aria-expanded={open} aria-controls={open ? detailId : undefined}
                    onClick={() => setExpanded(open ? undefined : task.id)}>
                    <span className="campaign-task-dot" data-group={taskGroup(task.status)} aria-hidden="true" />
                    <span className="campaign-progress-task-title">{task.title || "Untitled task"}</span>
                    <span className="campaign-progress-state" data-state={task.status}>{label(task.status)}</span>
                    <ChevronDown className="campaign-progress-chevron" size={16} aria-hidden="true" />
                    <span className="campaign-progress-task-meta">
                      <span className="campaign-task-assignee">{assignee || "Unassigned"}</span>
                      <span>{taskInfo(task)}</span>
                    </span>
                  </button>
                  {(task.summary || task.failure) && <p className={task.failure ? "campaign-progress-warning" : "campaign-progress-preview"}>
                    {task.failure ? "Latest failure · " + task.failure : markdownText(task.summary)}
                  </p>}
                  {open && <div className="campaign-progress-task-detail" id={detailId}>
                    <TaskDetail path={path + "?task=" + task.id} refresh={refresh} agents={agents} />
                  </div>}
                </li>;
              })}
            </ul>
            {filtered.length > pageSize && <Button type="button" variant="outline"
              onClick={() => setPageSize((size) => size + 20)}>Show {Math.min(20, filtered.length - pageSize)} more tasks</Button>}
          </>}

        <div className="campaign-progress-panels">
          <section className="campaign-progress-panel" aria-labelledby={id + "-schedule"}>
            <header>
              <h3 id={id + "-schedule"}>Scheduled jobs</h3>
              {nextJob && <span className="campaign-progress-next">Next {ago(nextJob.job.nextRun)}</span>}
            </header>
            {snapshot.schedule.state === "partial" && <p>Some schedule details are unavailable. Check the Agents tab for saved schedules.</p>}
            {snapshot.schedule.state === "ready" && !jobs.length && <p className="campaign-progress-panel-empty">No scheduled jobs.</p>}
            {jobs.length > 0 && <ul className="campaign-progress-list">
              {jobs.map((job) => <li key={job.id}>
                <div className="campaign-progress-row">
                  <strong>{job.name}</strong>
                  <span className="campaign-progress-state" data-state={job.state}>{label(job.state)}</span>
                </div>
                <div className="campaign-progress-row campaign-progress-job-times">
                  <span>{agentName(agents, job.agent)}</span>
                  {job.schedule && <span title={job.schedule}>{describeSchedule(job.schedule)}</span>}
                  {job.nextRun && <span>Next {ago(job.nextRun)}</span>}
                  {job.lastRun && <span>Last {ago(job.lastRun)} · {label(job.lastStatus)}</span>}
                </div>
              </li>)}
            </ul>}
          </section>

          <section className="campaign-progress-panel" aria-labelledby={id + "-publishing"}>
            <header>
              <h3 id={id + "-publishing"}>Recent publications</h3>
              <Link className="campaign-progress-panel-link" href={"/approvals?campaign=" + encodeURIComponent(campaign)}>Open approvals</Link>
            </header>
            {snapshot.publications.state === "unavailable" ? <p>Publication activity is unavailable.</p>
              : snapshot.publications.items.length === 0 ? <p className="campaign-progress-panel-empty">{snapshot.publications.skipped
                ? "Publication previews could not be read." : "No publications yet."}</p>
              : <ul className="campaign-progress-list">
                {snapshot.publications.items.map((item) => <li className="campaign-progress-row" key={item.id}>
                  <strong>{label(item.platform)}</strong>
                  <span>{item.account}</span>
                  <span className="campaign-progress-pill" data-state={item.status}>{label(item.status)}</span>
                </li>)}
              </ul>}
            {snapshot.publications.state === "ready" && snapshot.publications.skipped > 0 &&
              snapshot.publications.items.length > 0 && <p>Some publication previews could not be read.</p>}
          </section>
        </div>
      </>}
    </section>
    <CampaignAgentActivity key={campaign} campaign={campaign} agents={agents} />
  </>);
}
