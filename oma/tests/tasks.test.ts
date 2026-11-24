import assert from "node:assert/strict";
import test from "node:test";
import { groupTasks, type TaskBoard } from "../lib/tasks";

function board(slug: string, ...tasks: { id: string; status: string }[]): TaskBoard {
  return { slug, name: slug, unavailable: false, tasks: tasks.map((task) => ({
    ...task, title: task.id, assignee: "", createdAt: null, summary: "", failure: "", commentCount: 0,
  })) };
}

test("groups tasks across boards with Blocked first and retains board identity", () => {
  const groups = groupTasks([
    board("default", { id: "same-id", status: "blocked" }, { id: "task-2", status: "running" }),
    board("campaign", { id: "same-id", status: "blocked" }, { id: "task-4", status: "done" }),
  ]);
  assert.deepEqual(groups.map(({ status }) => status), ["blocked", "running", "done"]);
  assert.deepEqual(groups[0].rows.map(({ board, task }) => [board.slug, task.id]), [
    ["default", "same-id"], ["campaign", "same-id"],
  ]);
});
