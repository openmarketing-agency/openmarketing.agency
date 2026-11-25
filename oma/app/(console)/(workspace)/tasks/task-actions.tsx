"use client";

import { useActionState, useState } from "react";
import { Unlock } from "lucide-react";
import { commentOnTask, unblockTask } from "@/app/actions/tasks";
import { maxTaskComment, type TaskActionResult } from "@/lib/tasks";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function TaskActions({ board, id, blocked }: { board: string; id: string; blocked: boolean }) {
  const [draft, setDraft] = useState("");
  const [comment, submitComment, posting] = useActionState(async (previous: TaskActionResult, form: FormData) => {
    const result = await commentOnTask(board, id, previous, form);
    if (result.message) setDraft("");
    return result;
  }, {});
  const [unblock, submitUnblock, moving] = useActionState(unblockTask.bind(null, board, id), {});
  return (
    <div className="task-actions">
      <form action={submitComment}>
        <label htmlFor="task-comment">Add a comment</label>
        <Textarea id="task-comment" name="comment" rows={2} required maxLength={maxTaskComment}
          value={draft} onChange={(event) => setDraft(event.target.value)} disabled={posting || moving}
          placeholder="Share an update or explain what changed…" />
        <div className="task-action-buttons">
          <Button type="submit" variant="outline" disabled={!draft.trim() || posting || moving}>
            {posting ? "Posting…" : "Post comment"}
          </Button>
          {blocked && <Button type="submit" form="task-unblock-form"
            aria-describedby="task-unblock-help" disabled={moving || posting || Boolean(draft.trim())}>
            <Unlock size={15} aria-hidden="true" />{moving ? "Unblocking…" : "Unblock task"}
          </Button>}
        </div>
        {comment.error && <p className="form-error" role="alert">{comment.error}</p>}
        {comment.message && <p className="task-feedback" role="status">{comment.message}</p>}
      </form>
      {blocked && <>
        <form id="task-unblock-form" action={submitUnblock} />
        <p className="task-feedback" id="task-unblock-help">{draft.trim() ? "Post or clear your comment before unblocking."
          : "Open dependencies keep the task in To do."}</p>
      </>}
      {unblock.error && <p className="form-error" role="alert">{unblock.error}</p>}
      {unblock.message && <p className="task-feedback" role="status">{unblock.message}</p>}
    </div>
  );
}
