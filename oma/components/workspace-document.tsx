/** Renders agent-authored Markdown: workspace documents as section cards, and short text such as chat replies as prose. */

import type { List, ListItem, PhrasingContent, RootContent, Table } from "mdast";
import { createElement, Fragment, type ReactNode } from "react";
import {
  BookOpen, CalendarDays, ChartColumn, Check, ListChecks, Megaphone, MessageSquareText, Palette,
  ShieldCheck, Sparkles, Square, SquareCheck, Target, Users, X, type LucideIcon,
} from "lucide-react";
import { toString } from "mdast-util-to-string";

import {
  colorCode, documentFact, listLayout, parseMarkdown, phaseLabel, safeLink,
  type DocumentGroup, type DocumentSection, type WorkspaceDocument as ParsedDocument,
} from "@/lib/workspace-document";

const maxDepth = 24;
const colorSplit = new RegExp("(" + colorCode.source + ")");

const sectionIcons: [RegExp, LucideIcon][] = [
  [/audience|customer|persona|segment|who we/i, Users],
  [/voice|tone|copy|messag|language/i, MessageSquareText],
  [/visual|colou?r|logo|typograph|design|imagery/i, Palette],
  [/channel|distribution|media/i, Megaphone],
  [/metric|kpi|measure|success|result|report/i, ChartColumn],
  [/timeline|schedule|calendar|plan|phase|roadmap/i, CalendarDays],
  [/guardrail|compliance|legal|risk|rule|policy/i, ShieldCheck],
  [/objective|goal|offer|target/i, Target],
  [/overview|about|position|story|mission|summary|value/i, Sparkles],
  [/step|tactic|execution|checklist|process/i, ListChecks],
];

export function sectionIcon(title: string) {
  return sectionIcons.find(([pattern]) => pattern.test(title))?.[1] ?? BookOpen;
}

function SectionIcon({ title, size }: { title: string; size: number }) {
  return createElement(sectionIcon(title), { size, "aria-hidden": true });
}

function text(value: string): ReactNode {
  const parts = value.split(colorSplit);
  if (parts.length === 1) return value;
  return parts.map((part, index) => index % 2
    ? <span key={index} className="doc-swatch"><i style={{ background: part }} aria-hidden="true" />{part.toUpperCase()}</span>
    : part);
}

function inline(nodes: PhrasingContent[]): ReactNode {
  return nodes.map((node, index) => <Fragment key={index}>{phrase(node)}</Fragment>);
}

function phrase(node: PhrasingContent): ReactNode {
  switch (node.type) {
    case "text": return text(node.value);
    case "strong": return <strong>{inline(node.children)}</strong>;
    case "emphasis": return <em>{inline(node.children)}</em>;
    case "delete": return <del>{inline(node.children)}</del>;
    case "inlineCode": return <code>{node.value}</code>;
    case "break": return <br />;
    case "link": {
      const href = safeLink(node.url);
      return href ? <a href={href} title={node.title ?? undefined} target="_blank" rel="noopener noreferrer nofollow">{inline(node.children)}</a> : inline(node.children);
    }
    case "linkReference": return inline(node.children);
    // Images stay disabled, as in the VM renderer, and raw HTML is shown as text.
    case "image": case "imageReference": return node.alt ?? "";
    case "html": return node.value;
    case "footnoteReference": return <sup>[{node.label ?? node.identifier}]</sup>;
    default: return toString(node);
  }
}

function blocks(nodes: RootContent[], depth = 0): ReactNode {
  return nodes.map((node, index) => <Fragment key={index}>{block(node, depth)}</Fragment>);
}

function block(node: RootContent, depth: number): ReactNode {
  if (depth > maxDepth) return <p>{toString(node)}</p>;
  switch (node.type) {
    case "paragraph": return <p>{inline(node.children)}</p>;
    case "heading": {
      const Tag = ("h" + Math.min(6, Math.max(3, node.depth + 1))) as "h3" | "h4" | "h5" | "h6";
      return <Tag className="doc-subheading">{inline(node.children)}</Tag>;
    }
    case "blockquote": return <blockquote className="doc-callout">{blocks(node.children, depth + 1)}</blockquote>;
    case "list": return <DocumentList list={node} depth={depth} />;
    case "table": return <DocumentTable table={node} />;
    case "code": return <pre className="doc-code"><code>{node.value}</code></pre>;
    case "thematicBreak": return <hr />;
    case "html": return <p>{node.value}</p>;
    case "footnoteDefinition": return <div className="doc-footnote"><sup>[{node.label ?? node.identifier}]</sup>{blocks(node.children, depth + 1)}</div>;
    case "definition": return null;
    default: return <p>{toString(node)}</p>;
  }
}

function itemContent(item: ListItem, depth: number) {
  const [first, ...rest] = item.children;
  // Tight list items hold a single paragraph; render it inline so markers line up with the text.
  return first?.type === "paragraph"
    ? <>{inline(first.children)}{blocks(rest, depth + 1)}</>
    : blocks(item.children, depth + 1);
}

function DocumentList({ list, depth }: { list: List; depth: number }) {
  const layout = listLayout(list);
  const items = list.children;
  if (layout === "stats" || layout === "facts") {
    const facts = items.map((item) => documentFact(item)!);
    return layout === "stats"
      ? <dl className="doc-stats">{facts.map((fact, index) => (
        <div key={index}><dd>{inline(fact.value)}</dd><dt>{fact.label}</dt></div>
      ))}</dl>
      : <dl className="doc-facts">{facts.map((fact, index) => (
        <div key={index}><dt>{fact.label}</dt><dd>{inline(fact.value)}</dd></div>
      ))}</dl>;
  }
  if (layout === "chips") return <ul className="doc-chips">{items.map((item, index) => <li key={index}>{itemContent(item, depth)}</li>)}</ul>;
  if (layout === "steps") {
    return <ol className="doc-steps" start={list.start ?? undefined}>
      {items.map((item, index) => <li key={index}><div>{itemContent(item, depth)}</div></li>)}
    </ol>;
  }
  if (layout === "tasks") {
    return <ul className="doc-tasks">{items.map((item, index) => {
      const Icon = item.checked ? SquareCheck : Square;
      return <li key={index} data-checked={item.checked ? "" : undefined}>
        <Icon size={15} aria-label={item.checked ? "Done" : "Not done"} /><div>{itemContent(item, depth)}</div>
      </li>;
    })}</ul>;
  }
  return <ul className="doc-points">{items.map((item, index) => <li key={index}>{itemContent(item, depth)}</li>)}</ul>;
}

function DocumentTable({ table }: { table: Table }) {
  const [header, ...rows] = table.children;
  const align = (index: number) => table.align?.[index] ?? undefined;
  return (
    <div className="doc-table">
      <table>
        {header && <thead><tr>{header.children.map((cell, index) => (
          <th key={index} scope="col" style={{ textAlign: align(index) }}>{inline(cell.children)}</th>
        ))}</tr></thead>}
        <tbody>{rows.map((row, rowIndex) => (
          <tr key={rowIndex}>{row.children.map((cell, index) => (
            <td key={index} style={{ textAlign: align(index) }}>{inline(cell.children)}</td>
          ))}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function GuidanceColumn({ group, kind }: { group: DocumentGroup; kind: "do" | "dont" }) {
  const Icon = kind === "do" ? Check : X;
  return (
    <div className={"doc-guidance-" + kind}>
      <h3><Icon size={15} aria-hidden="true" />{inline(group.heading.children)}</h3>
      {group.nodes.map((node, index) => node.type === "list"
        ? <ul key={index}>{node.children.map((item, itemIndex) => (
          <li key={itemIndex}><Icon size={14} aria-hidden="true" /><div>{itemContent(item, 1)}</div></li>
        ))}</ul>
        : <Fragment key={index}>{block(node, 1)}</Fragment>)}
    </div>
  );
}

function Section({ section }: { section: DocumentSection }) {
  const headingId = section.id + "-heading";
  return (
    <section className="doc-card" id={section.id} aria-labelledby={headingId}>
      <header className="doc-card-heading">
        <span aria-hidden="true"><SectionIcon title={section.title} size={17} /></span>
        <h3 id={headingId}>{inline(section.heading.children)}</h3>
      </header>
      <div className="doc-card-body">
        {blocks(section.lead)}
        {section.guidance && (
          <div className="doc-guidance">
            <GuidanceColumn group={section.guidance.dos} kind="do" />
            <GuidanceColumn group={section.guidance.donts} kind="dont" />
          </div>
        )}
        {section.timeline ? (
          <ol className="doc-timeline">
            {section.groups.map((group, index) => {
              const { name, when } = phaseLabel(group.title);
              return (
                <li key={index}>
                  <div className="doc-phase-heading"><h4>{name}</h4>{when && <span>{when}</span>}</div>
                  {blocks(group.nodes, 1)}
                </li>
              );
            })}
          </ol>
        ) : section.groups.length > 0 && (
          <div className="doc-subsections">
            {section.groups.map((group, index) => (
              <article key={index}>
                <h4>{inline(group.heading.children)}</h4>
                {blocks(group.nodes, 1)}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function WorkspaceDocument({ document, name, empty, contents = false }: {
  document: ParsedDocument;
  name?: string;
  empty: string;
  /** Lists the sections above the document, for pages without a side column. */
  contents?: boolean;
}) {
  if (document.empty) return <p className="doc-empty">{empty}</p>;
  const title = document.title && document.title.toLowerCase() !== name?.trim().toLowerCase() ? document.title : undefined;
  return (
    <div className="workspace-document">
      {(title || document.tagline || document.lede.length > 0) && (
        <div className="doc-hero">
          {title && <p className="doc-hero-title">{title}</p>}
          {document.tagline && <blockquote>{blocks(document.tagline.children, 1)}</blockquote>}
          {document.lede.length > 0 && <div className="doc-hero-lede">{blocks(document.lede)}</div>}
        </div>
      )}
      {contents && document.sections.length >= 3 && (
        <nav className="doc-inline-contents" aria-label="Document sections">
          <ul>{document.sections.map(({ id, title }) => (
            <li key={id}><a href={"#" + id}><SectionIcon title={title} size={14} />{title}</a></li>
          ))}</ul>
        </nav>
      )}
      {document.intro.length > 0 && <section className="doc-card"><div className="doc-card-body">{blocks(document.intro)}</div></section>}
      {document.sections.map((section) => <Section key={section.id} section={section} />)}
    </div>
  );
}

/** Lists the document's sections for the page's side column. */
export function WorkspaceDocumentContents({ document }: { document: ParsedDocument }) {
  if (document.sections.length < 2) return null;
  return (
    <nav className="record-links doc-contents" aria-label="On this page">
      <h2>On this page</h2>
      <ul>
        {document.sections.map(({ id, title }) => (
          <li key={id}><a href={"#" + id}><SectionIcon title={title} size={15} />{title}</a></li>
        ))}
      </ul>
    </nav>
  );
}

/** Renders short Markdown, such as a chat reply, as plain prose without section cards. */
export function MarkdownContent({ text, id, className }: { text: string; id?: string; className?: string }) {
  return <div id={id} className={"doc-prose" + (className ? " " + className : "")}>{blocks(parseMarkdown(text).children)}</div>;
}

/** Renders one short Markdown item, such as a goal, keeping inline formatting without paragraph spacing. */
export function MarkdownInline({ text }: { text: string }) {
  const nodes = parseMarkdown(text).children;
  if (nodes.length === 1 && nodes[0].type === "paragraph") return <>{inline(nodes[0].children)}</>;
  return <MarkdownContent text={text} className="doc-compact" />;
}
