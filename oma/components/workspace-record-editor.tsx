/** Edits the permitted fields of a saved brand, brand knowledge file, or strategy. */

"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import { saveWorkspaceEdit } from "@/app/actions/workspace";
import type { SavedBrand, SavedPlaybook } from "@/lib/server/agent-workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type EditorProps = { path: string } & (
  | { collection: "brands" | "brand-knowledge"; record: SavedBrand }
  | { collection: "playbooks"; record: SavedPlaybook }
);

export function WorkspaceRecordEditor(props: EditorProps) {
  const { collection, record, path } = props;
  const [name, setName] = useState(record.name);
  const [description, setDescription] = useState(record.description);
  const [text, setText] = useState("knowledge" in record ? record.knowledge : record.strategy);
  const [state, action, pending] = useActionState(saveWorkspaceEdit.bind(null, collection, record.id), { message: "" });
  const editCopy = props.collection !== "brands" || props.record.knowledgeFile === undefined;
  const revision = collection === "brand-knowledge" && "knowledge" in record ? record.knowledgeRevision : record.revision;
  const saveLabel = collection === "brands" ? "Save brand" : collection === "playbooks" ? "Save strategy" : "Save brand knowledge";

  return (
    <form action={action} className="workspace-editor">
      <input type="hidden" name="revision" value={revision} />
      <fieldset disabled={pending}>
        {collection === "brands" && (
          <>
            <label>Brand name<Input name="name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} /></label>
            <label>Description<Textarea name="description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} rows={3} /></label>
          </>
        )}
        {editCopy && (
          <label>
            {collection === "playbooks" ? "Strategy" : "Brand knowledge"}
            <Textarea name={collection === "playbooks" ? "strategy" : "knowledge_base"} value={text}
              onChange={(event) => setText(event.target.value)} maxLength={48_000} rows={12} />
          </label>
        )}
        {state.message && <p className="form-error" role="alert">{state.message}</p>}
        <div className="workspace-editor-actions">
          <Button type="submit">{pending ? "Saving…" : saveLabel}</Button>
          <Button asChild variant="outline"><Link href={path}>Cancel</Link></Button>
        </div>
      </fieldset>
    </form>
  );
}
