"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/dal";
import { taskComment, taskStatusLabel, type TaskActionResult } from "@/lib/tasks";
import { WorkspaceRequestError } from "@/lib/server/agent-workspace";
import { postTaskComment, unblockWorkspaceTask } from "@/lib/server/workspace-tasks";

const uncertainUpdate = "Couldn’t confirm the task update. Refresh the list before retrying.";

export async function commentOnTask(board: string, id: string, _previous: TaskActionResult, form: FormData): Promise<TaskActionResult> {
  const user = await requireUser();
  const body = taskComment.safeParse(form.get("comment"));
  if (!body.success) return { error: "Enter a comment of 1–4,000 characters." };
  try {
    await postTaskComment(board, id, body.data, user.email);
    revalidatePath("/tasks");
    return { message: "Comment posted." };
  } catch (error) {
    return { error: error instanceof WorkspaceRequestError && error.status < 500 ? error.message : uncertainUpdate };
  }
}

export async function unblockTask(board: string, id: string): Promise<TaskActionResult> {
  await requireUser();
  try {
    const { status } = await unblockWorkspaceTask(board, id);
    revalidatePath("/tasks");
    revalidatePath("/dashboard");
    revalidatePath("/campaigns/[id]", "page");
    return { message: status ? `Task unblocked. Status: ${taskStatusLabel(status)}.` : "Task unblocked." };
  } catch (error) {
    return { error: error instanceof WorkspaceRequestError && error.status < 500 ? error.message : uncertainUpdate };
  }
}
