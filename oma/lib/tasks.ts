import { z } from "zod";

export const taskKey = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
export const maxTaskComment = 4000;
export const taskComment = z.string().trim().min(1).max(maxTaskComment);
const timestamp = z.number().int().positive().max(253402300799).nullable();
const task = z.object({
  id: taskKey, title: z.string(), status: taskKey, assignee: z.string(),
  createdAt: timestamp, summary: z.string(), failure: z.string(),
});
const board = z.object({
  slug: taskKey, name: z.string(), unavailable: z.boolean(),
  tasks: z.array(task.extend({ commentCount: z.number().int().nonnegative() })),
});
export const workspaceTasks = z.object({ boards: z.array(board) });
export const taskDetail = z.object({
  task, body: z.string(), blockReason: z.string(),
  comments: z.array(z.object({ id: z.number().int(), author: z.string(), body: z.string(), at: timestamp })),
});
export type TaskBoard = z.infer<typeof board>;
export type TaskDetail = z.infer<typeof taskDetail>;
export type TaskActionResult = { error?: string; message?: string };

type TaskRow = { board: Pick<TaskBoard, "slug" | "name">; task: TaskBoard["tasks"][number] };
const statuses = new Map([
  ["blocked", "Blocked"], ["review", "In review"], ["running", "In progress"],
  ["ready", "Ready"], ["todo", "To do"], ["scheduled", "Scheduled"],
  ["triage", "Triage"], ["done", "Done"],
]);

export function taskStatusLabel(status: string) {
  return statuses.get(status) ?? status.replaceAll(/[-_]/g, " ");
}

export function groupTasks(boards: TaskBoard[]) {
  const groups = new Map<string, TaskRow[]>();
  for (const { slug, name, tasks } of boards) {
    for (const task of tasks) {
      const rows = groups.get(task.status) ?? [];
      rows.push({ board: { slug, name }, task });
      groups.set(task.status, rows);
    }
  }
  return [...new Set([...statuses.keys(), ...groups.keys()])].flatMap((status) => {
    const rows = groups.get(status);
    return rows ? [{ status, rows }] : [];
  });
}

export function taskHref(filter?: string, selection?: { board: string; id: string }) {
  const params = new URLSearchParams();
  if (filter) params.set("board", filter);
  if (selection) params.set("task", `${selection.board}/${selection.id}`);
  return params.size ? `/tasks?${params}` : "/tasks";
}
