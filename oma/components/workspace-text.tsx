/** Displays Markdown formatted by the private VM reader, with a plain-text fallback for older agents. */

export function WorkspaceText({ text, html, empty }: { text: string; html?: string; empty: string }) {
  if (!text.trim()) return <p>{empty}</p>;
  // The VM's Markdown renderer escapes raw HTML, disallows images, and validates links.
  return html
    ? <div className="workspace-markdown" dangerouslySetInnerHTML={{ __html: html }} />
    : <p className="workspace-record-copy">{text}</p>;
}
