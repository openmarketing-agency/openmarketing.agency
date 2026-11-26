"use client";

/** Shows every research document at once, one row per folder above the open document, so the document keeps the full width. */

import Link from "next/link";
import { useState } from "react";

export type ResearchNavItem = { id: string; label: string; file: string };

/** Turn a folder path such as `docs/repository/clozva-website` into a readable name like "Clozva website". */
export function folderLabel(folder: string) {
  const name = folder.split("/").filter(Boolean).at(-1)?.replaceAll(/[-_]+/g, " ") ?? "";
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Documents";
}

/** Group documents by their folder, keeping the order the agent saved them in. */
export function groupDocuments(items: ResearchNavItem[]) {
  const groups = new Map<string, ResearchNavItem[]>();
  for (const item of items) {
    const folder = item.file.includes("/") ? item.file.slice(0, item.file.lastIndexOf("/")) : "";
    groups.set(folder, [...groups.get(folder) ?? [], item]);
  }
  return [...groups].map(([folder, documents]) => ({ folder, documents }));
}

export function ResearchNav({ items, selectedId, basePath }: { items: ResearchNavItem[]; selectedId?: string; basePath: string }) {
  const [query, setQuery] = useState("");
  const search = query.trim().toLowerCase();
  const groups = groupDocuments(items.filter(({ label, file }) => !search || (label + " " + file).toLowerCase().includes(search)));

  return (
    <nav className="research-index" aria-label="Research documents">
      <div className="research-index-heading">
        <h2>Documents <span>{items.length}</span></h2>
        {items.length > 12 && <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter documents" aria-label="Filter documents" />}
      </div>
      <dl>
        {groups.map(({ folder, documents }) => (
          <div key={folder || "root"}>
            <dt title={folder || undefined}>{folderLabel(folder)}</dt>
            <dd>
              {documents.map(({ id, label, file }) => (
                <Link key={id} href={basePath + "&document=" + id} scroll={false} prefetch={false} title={file}
                  aria-current={id === selectedId ? "page" : undefined}>{label}</Link>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      {!groups.length && <p className="research-index-empty">No documents match “{query.trim()}”.</p>}
    </nav>
  );
}
