"use client";

/** Switches between a brand's research documents from a compact bar, so the open document keeps the full width. */

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const current = items.find(({ id }) => id === selectedId);
  const search = query.trim().toLowerCase();
  const groups = groupDocuments(items.filter(({ label, file }) => !search || (label + " " + file).toLowerCase().includes(search)));

  // Close on a click outside the switcher or on Escape.
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  return (
    <div className="research-switcher" ref={root}>
      <button type="button" className="research-switcher-button" aria-expanded={open} aria-controls="research-documents"
        onClick={() => { setOpen(!open); setQuery(""); }}>
        <span>
          <small>{current ? folderLabel(current.file.slice(0, Math.max(0, current.file.lastIndexOf("/")))) : "Documents"}</small>
          <strong>{current?.label ?? "Choose a document"}</strong>
        </span>
        <span className="research-switcher-count">All {items.length} documents<ChevronDown size={15} aria-hidden="true" /></span>
      </button>
      {open && (
        <div className="research-switcher-panel" id="research-documents">
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus
            placeholder="Search documents" aria-label="Search documents" />
          <nav aria-label="Research documents">
            {groups.map(({ folder, documents }) => (
              <section key={folder || "root"}>
                <h3 title={folder || undefined}>{folderLabel(folder)}</h3>
                <ul>
                  {documents.map(({ id, label, file }) => (
                    <li key={id}>
                      <Link href={basePath + "&document=" + id} scroll={false} prefetch={false} title={file}
                        aria-current={id === selectedId ? "page" : undefined} onClick={() => setOpen(false)}>{label}</Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {!groups.length && <p className="research-switcher-empty">No documents match “{query.trim()}”.</p>}
          </nav>
        </div>
      )}
    </div>
  );
}
