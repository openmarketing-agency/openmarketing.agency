"use client";

/** Lists a brand's research documents by folder, with search, beside the document being read. */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export type ResearchNavItem = { id: string; label: string; file: string };

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
  const active = useRef<HTMLAnchorElement>(null);
  const search = query.trim().toLowerCase();
  const groups = groupDocuments(items.filter(({ label, file }) => !search || (label + " " + file).toLowerCase().includes(search)));

  // Keep the open document visible in a long list after navigating.
  useEffect(() => { active.current?.scrollIntoView({ block: "nearest" }); }, [selectedId]);

  return (
    <nav className="research-nav" aria-label="Research documents">
      <div className="research-nav-heading">
        <h2>Documents <span>{items.length}</span></h2>
        {items.length > 6 && <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="Search documents" aria-label="Search documents" />}
      </div>
      <div className="research-nav-list">
        {groups.map(({ folder, documents }) => (
          <section key={folder || "root"}>
            {folder && <h3>{folder}</h3>}
            <ul>
              {documents.map(({ id, label, file }) => (
                <li key={id}>
                  <Link href={basePath + "&document=" + id} scroll={false} prefetch={false}
                    aria-current={id === selectedId ? "page" : undefined} ref={id === selectedId ? active : undefined} title={file}>
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {!groups.length && <p className="research-nav-empty">No documents match “{query.trim()}”.</p>}
      </div>
    </nav>
  );
}
