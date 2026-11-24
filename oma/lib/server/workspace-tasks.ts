import { z } from "zod";
import { taskDetail, taskKey, workspaceTasks } from "../tasks";
import { WorkspaceRequestError, workspaceRequest } from "./agent-workspace";

const tasksPath = "/workspace/tasks";

function taskPath(board: string, id: string) {
  if (!taskKey.safeParse(board).success || !taskKey.safeParse(id).success) {
    throw new WorkspaceRequestError(404, "Task not found on this board.");
  }
  return `${tasksPath}/${board}/${id}`;
}

export async function listWorkspaceTasks() {
  return workspaceTasks.parse(await workspaceRequest(tasksPath)).boards;
}

export async function readWorkspaceTask(board: string, id: string) {
  return taskDetail.parse(await workspaceRequest(taskPath(board, id)));
}

export async function postTaskComment(board: string, id: string, body: string, author: string) {
  z.object({ ok: z.literal(true) }).parse(await workspaceRequest(taskPath(board, id), { action: "comment", body, author }, "POST"));
}

export async function unblockWorkspaceTask(board: string, id: string) {
  return z.object({ status: z.string() }).parse(await workspaceRequest(taskPath(board, id), { action: "unblock" }, "POST"));
}
