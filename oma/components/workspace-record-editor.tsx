/** Edits the permitted fields of a saved brand or playbook with revision-aware saves. */

"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import { saveWorkspaceEdit } from "@/app/actions/workspace";
import type { SavedBrand, SavedPlaybook } from "@/lib/server/agent-workspace";

type EditorProps = { path: string } & (
  | { collection: "brands"; record: SavedBrand }
  | { collection: "playbooks"; record: SavedPlaybook }
);

export function WorkspaceRecordEditor(props: EditorProps) {
  const { collection, record, path } = props;
  const [name, setName] = useState(record.name);
  const [description, setDescription] = useState(record.description);
  const [text, setText] = useState(props.collection === "brands" ? props.record.knowledge : props.record.strategy);
  const [state, action, pending] = useActionState(saveWorkspaceEdit.bind(null, collection, record.id), { message: "" });

  return (
    <form action={action} className="workspace-editor">
      <input type="hidden" name="revision" value={record.revision} />
      <fieldset disabled={pending}>
        {collection === "brands" && (
          <>
            <label>Brand name<input name="name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} /></label>
            <label>Description<textarea name="description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} rows={3} /></label>
          </>
        )}
        <label>
          {collection === "brands" ? "Brand knowledge" : "Strategy"}
          <textarea name={collection === "brands" ? "knowledge_base" : "strategy"} value={text}
            onChange={(event) => setText(event.target.value)} maxLength={48_000} rows={12} />
        </label>
        {state.message && <p className="form-error" role="alert">{state.message}</p>}
        <div className="workspace-editor-actions">
          <button className="btn primary" type="submit">{pending ? "Saving…" : collection === "brands" ? "Save brand" : "Save strategy"}</button>
          <Link className="btn secondary" href={path}>Cancel</Link>
        </div>
      </fieldset>
    </form>
  );
}
