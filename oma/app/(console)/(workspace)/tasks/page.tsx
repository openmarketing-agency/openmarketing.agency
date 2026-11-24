import { Suspense } from "react";
import Link from "next/link";
import { Box, ChevronRight, Circle, CircleAlert, CircleCheck, CircleDashed, Clock, ListTodo, MessageSquare, X } from "lucide-react";
import { Loading } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { WorkspaceRequestError } from "@/lib/server/agent-workspace";
import { listWorkspaceTasks, readWorkspaceTask } from "@/lib/server/workspace-tasks";
import { groupTasks, taskHref, taskKey, taskStatusLabel } from "@/lib/tasks";
import { TaskActions } from "./task-actions";
import "./tasks.css";

type Query = { board?: string | string[]; task?: string | string[] };
const dateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });

function StatusIcon({ status }: { status: string }) {
  const props = { className: "task-status-icon", "data-status": status, size: 16, "aria-hidden": true } as const;
  switch (status) {
    case "blocked": return <CircleAlert {...props} />;
    case "review": case "triage": return <CircleDashed {...props} />;
    case "running": case "scheduled": return <Clock {...props} />;
    case "ready": case "done": return <CircleCheck {...props} />;
    default: return <Circle {...props} />;
  }
}

function TaskDate({ at }: { at: number }) {
  const date = new Date(at * 1000);
  return <time dateTime={date.toISOString()}>{dateFormat.format(date)}</time>;
}

export default function Page({ searchParams }: { searchParams: Promise<Query> }) {
  return <Suspense fallback={<Loading label="Loading tasks…" />}><Tasks searchParams={searchParams} /></Suspense>;
}

async function Tasks({ searchParams }: { searchParams: Promise<Query> }) {
  await requireUser();
  const query = await searchParams;
  const boards = await listWorkspaceTasks().catch(() => null);
  const filteredBoard = boards?.find((board) => board.slug === query.board);
  const visible = filteredBoard ? [filteredBoard] : boards ?? [];
  const groups = groupTasks(visible);
  const total = groups.reduce((count, group) => count + group.rows.length, 0);
  const unread = visible.filter((board) => board.unavailable);
  const selectedParts = typeof query.task === "string" ? query.task.split("/") : [];
  const [selectedBoard, selectedId] = selectedParts;
  const selection = selectedParts.length === 2 && taskKey.safeParse(selectedBoard).success && taskKey.safeParse(selectedId).success
    ? { board: selectedBoard, id: selectedId } : null;
  const hasSelection = selection !== null && boards !== null;
  return (
    <div className="tasks-page" data-detail={hasSelection || undefined}>
      <header className="tasks-heading">
        <div className="tasks-title"><ListTodo size={24} aria-hidden="true" /><h1>Tasks</h1></div>
        <p>Kanban tasks across all workspace boards.</p>
      </header>
      {!boards ? <div className="tasks-empty" role="alert"><strong>Tasks unavailable</strong>
        <p>Couldn’t load Kanban tasks. Check that oma-agent is running, then refresh this page.</p>
      </div> : (
        <>
          <div className="tasks-toolbar">
            <p>{total} {total === 1 ? "task" : "tasks"} <span aria-hidden="true">·</span> {visible.length} {visible.length === 1 ? "board" : "boards"}</p>
            {boards.length > 1 && <form action="/tasks">
              <label className="sr-only" htmlFor="task-board-filter">Filter by board</label>
              <select id="task-board-filter" name="board" defaultValue={filteredBoard?.slug ?? ""} key={filteredBoard?.slug ?? "all"}>
                <option value="">All boards</option>
                {boards.map((board) => <option key={board.slug} value={board.slug}>{board.name}</option>)}
              </select>
              <button className="btn secondary" type="submit">Apply</button>
            </form>}
          </div>
          {unread.length > 0 && <p className="tasks-warning" role="status">Couldn’t load {unread.map((board) => board.name).join(", ")}. The list may be incomplete.</p>}
          <div className="tasks-layout">
            {hasSelection && selection && (
              <aside className="task-detail" id="task-detail" aria-labelledby="task-detail-title" tabIndex={-1}>
                <Suspense key={`${selection.board}/${selection.id}`} fallback={<Loading label="Loading task…" />}>
                  <TaskPanel board={selection.board} id={selection.id} filter={filteredBoard?.slug}
                    boardName={boards.find((board) => board.slug === selection.board)?.name ?? selection.board} />
                </Suspense>
              </aside>
            )}
            <div className="task-groups">
              {groups.map(({ status, rows }) => (
                <details className="task-group" data-status={status} key={status} open>
                  <summary><ChevronRight className="task-chevron" size={15} aria-hidden="true" />
                    <StatusIcon status={status} /><span>{taskStatusLabel(status)}</span><small>{rows.length}</small>
                  </summary>
                  <ul>
                    {rows.map(({ board, task }) => {
                      const selected = selection?.board === board.slug && selection.id === task.id;
                      return <li key={`${board.slug}/${task.id}`}>
                        <Link className="task-row" href={`${taskHref(filteredBoard?.slug, { board: board.slug, id: task.id })}#task-detail`}
                          prefetch={false} aria-current={selected ? "true" : undefined}>
                          <span className="task-row-id" title={task.id}>{task.id}</span>
                          <span className="task-row-title"><StatusIcon status={status} />{task.title || "Untitled task"}</span>
                          <span className="task-row-meta">
                            <span className="task-board-chip" title={board.name}><Box size={13} aria-hidden="true" /><span>{board.name}</span></span>
                            {task.commentCount > 0 && <span className="task-comment-count" aria-label={`${task.commentCount} comments`}>
                              <MessageSquare size={13} aria-hidden="true" />{task.commentCount}
                            </span>}
                            {task.assignee && <span className="task-assignee" title={task.assignee}>{task.assignee}</span>}
                            {task.createdAt && <TaskDate at={task.createdAt} />}
                          </span>
                        </Link>
                      </li>;
                    })}
                  </ul>
                </details>
              ))}
              {total === 0 && unread.length === 0 && <div className="tasks-empty"><strong>No tasks yet</strong>
                <p>{filteredBoard ? "There are no tasks on this board." : "Tasks will appear here when they’re added to a Kanban board."}</p>
              </div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

async function TaskPanel({ board, id, filter, boardName }: { board: string; id: string; filter?: string; boardName: string }) {
  const close = <Link className="btn ghost task-detail-close" href={taskHref(filter)} scroll={false} aria-label="Close task details"><X size={18} aria-hidden="true" /></Link>;
  const detail = await readWorkspaceTask(board, id).then(
    (value) => ({ value }),
    (error: unknown) => ({ missing: error instanceof WorkspaceRequestError && error.status === 404 }),
  );
  if ("missing" in detail) {
    return <header className="task-detail-heading"><div><h2 id="task-detail-title">Task unavailable</h2>
      <p role="alert">{detail.missing ? "Task not found on this board." : "Couldn’t load this task. Refresh and try again."}</p></div>{close}</header>;
  }
  const { task, body, blockReason, comments } = detail.value;
  const blocker = task.status === "blocked" ? blockReason || task.failure : "";
  return (
    <>
      <header className="task-detail-heading">
        <div><p className="task-detail-meta"><Box size={14} aria-hidden="true" /> {boardName} <span>·</span> {task.id}</p>
          <h2 id="task-detail-title">{task.title || "Untitled task"}</h2>
          <p className="task-detail-meta"><StatusIcon status={task.status} /> {taskStatusLabel(task.status)}{task.assignee ? ` · ${task.assignee}` : ""}</p>
        </div>
        {close}
      </header>
      <div className="task-detail-content" role="region" aria-label="Task details and comments" tabIndex={0}>
        <details className="task-detail-section">
          <summary><ChevronRight className="task-chevron" size={15} aria-hidden="true" /> Task details</summary>
          <div className="task-detail-section-body">
            {task.status === "blocked" && <div className="tasks-warning"><strong>Why it’s blocked</strong>
              <p>{blocker || "No reason was recorded."}</p>
            </div>}
            {body && <p className="task-detail-text">{body}</p>}
            {task.summary && task.summary !== body && task.summary !== blocker && (
              <section className="task-detail-update"><h3>Latest update</h3><p className="task-detail-text">{task.summary}</p></section>
            )}
            {!body && !task.summary && task.status !== "blocked" && <p className="task-feedback">No details yet.</p>}
          </div>
        </details>
        <details className="task-detail-section">
          <summary><ChevronRight className="task-chevron" size={15} aria-hidden="true" /> Comments <small>{comments.length}</small></summary>
          <div className="task-detail-section-body">
            {comments.length ? <ol className="task-comments">
              {comments.map((comment) => <li key={comment.id}><div><strong>{comment.author || "Unknown author"}</strong>
                {comment.at && <TaskDate at={comment.at} />}</div><p className="task-detail-text">{comment.body}</p></li>)}
            </ol> : <p className="task-feedback">No comments yet.</p>}
          </div>
        </details>
      </div>
      <TaskActions board={board} id={id} blocked={task.status === "blocked"} />
    </>
  );
}
