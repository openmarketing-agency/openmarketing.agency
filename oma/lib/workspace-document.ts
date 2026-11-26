/** Parses agent-authored workspace Markdown, splits documents into sections, and picks a layout for each part. */

import type { Blockquote, Definition, Heading, LinkReference, List, ListItem, Paragraph, PhrasingContent, Root, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toString } from "mdast-util-to-string";
import { gfm } from "micromark-extension-gfm";

export type DocumentGroup = { title: string; heading: Heading; nodes: RootContent[] };

export type DocumentSection = {
  id: string;
  title: string;
  heading: Heading;
  lead: RootContent[];
  /** Paired "Do" and "Don't" subsections, shown side by side. */
  guidance?: { dos: DocumentGroup; donts: DocumentGroup };
  groups: DocumentGroup[];
  /** True when every remaining subsection is a phase, week, or stage. */
  timeline: boolean;
};

export type WorkspaceDocument = {
  empty: boolean;
  title?: string;
  tagline?: Blockquote;
  lede: Paragraph[];
  intro: RootContent[];
  sections: DocumentSection[];
};

export type DocumentFact = { label: string; value: PhrasingContent[]; text: string };
export type ListLayout = "steps" | "tasks" | "stats" | "facts" | "chips" | "points";

const doHeading = /^(?:do|dos|do's|do this)$/i;
const dontHeading = /^(?:don't|dont|don'ts|donts|do not|avoid)$/i;
const phaseHeading = /^(?:phase|week|stage|step|sprint|month|day|q[1-4])\b/i;

const plain = (node: Parameters<typeof toString>[0]) => toString(node).replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();

function slug(text: string, used: Map<string, number>) {
  const base = "doc-" + (text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "section");
  let count = used.get(base) ?? 1;
  let id = base;
  while (used.has(id) || used.has(id + "-heading")) id = base + "-" + ++count;
  used.set(id, 1);
  used.set(id + "-heading", 1);
  used.set(base, count);
  return id;
}

function section(heading: Heading, nodes: RootContent[], used: Map<string, number>): DocumentSection {
  const title = plain(heading);
  const lead: RootContent[] = [];
  const groups: DocumentGroup[] = [];
  for (const node of nodes) {
    if (node.type === "heading" && node.depth === 3) groups.push({ title: plain(node), heading: node, nodes: [] });
    else (groups.at(-1)?.nodes ?? lead).push(node);
  }
  const dos = groups.find(({ title }) => doHeading.test(title));
  const donts = groups.find(({ title }) => dontHeading.test(title));
  const guidance = dos && donts ? { dos, donts } : undefined;
  const rest = guidance ? groups.filter((group) => group !== dos && group !== donts) : groups;
  return {
    id: slug(title, used), title, heading, lead, guidance, groups: rest,
    timeline: rest.length >= 2 && rest.every(({ title }) => phaseHeading.test(title)),
  };
}

function resolveReferenceLinks(root: Root) {
  const definitions = new Map<string, Definition>();
  const references: { children: RootContent[]; index: number; node: LinkReference }[] = [];
  const pending = [{ children: root.children, index: 0 }];

  // Visit in document order because CommonMark uses the first definition for a label.
  while (pending.length) {
    const frame = pending[pending.length - 1];
    const index = frame.index++;
    const node = frame.children[index];
    if (!node) pending.pop();
    else if (node.type === "definition" && !definitions.has(node.identifier)) definitions.set(node.identifier, node);
    else if (node.type === "linkReference") references.push({ children: frame.children, index, node });
    else if ("children" in node) pending.push({ children: node.children, index: 0 });
  }

  for (const { children, index, node } of references) {
    const definition = definitions.get(node.identifier);
    if (definition) children[index] = { type: "link", url: definition.url, title: definition.title, children: node.children };
  }
}

/** Parses GitHub-flavored Markdown and resolves reference-style links. */
export function parseMarkdown(markdown: string): Root {
  const root = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  resolveReferenceLinks(root);
  return root;
}

export function parseWorkspaceDocument(markdown: string): WorkspaceDocument {
  const root = parseMarkdown(markdown);
  const used = new Map<string, number>();
  const intro: RootContent[] = [];
  const sections: DocumentSection[] = [];
  let title: string | undefined;
  let current: { heading: Heading; nodes: RootContent[] } | undefined;
  const close = () => { if (current) sections.push(section(current.heading, current.nodes, used)); };

  root.children.forEach((node, index) => {
    if (node.type === "heading" && node.depth === 1 && index === 0) title = plain(node);
    else if (node.type === "heading" && node.depth <= 2) { close(); current = { heading: node, nodes: [] }; }
    else (current?.nodes ?? intro).push(node);
  });
  close();

  // A leading quote and the paragraphs right after it introduce the whole document.
  const tagline = intro[0]?.type === "blockquote" ? intro.shift() as Blockquote : undefined;
  const lede: Paragraph[] = [];
  while (intro[0]?.type === "paragraph") lede.push(intro.shift() as Paragraph);
  return { empty: !markdown.trim(), title, tagline, lede, intro, sections };
}

/** Reads a `**Label:** value` list item. */
export function documentFact(item: ListItem): DocumentFact | undefined {
  const [paragraph] = item.children;
  if (item.children.length !== 1 || paragraph.type !== "paragraph") return;
  const [first, ...rest] = paragraph.children;
  if (first?.type !== "strong") return;
  let label = plain(first);
  let value = rest;
  if (label.endsWith(":")) label = label.slice(0, -1).trim();
  else if (rest[0]?.type === "text" && rest[0].value.trimStart().startsWith(":")) {
    value = [{ ...rest[0], value: rest[0].value.trimStart().slice(1) }, ...rest.slice(1)];
  } else return;
  if (value[0]?.type === "text") value = [{ ...value[0], value: value[0].value.trimStart() }, ...value.slice(1)];
  const text = plain(value);
  return label && text ? { label, value, text } : undefined;
}

export function listLayout(list: List): ListLayout {
  const items = list.children;
  if (items.some(({ checked }) => typeof checked === "boolean")) return "tasks";
  if (list.ordered) return "steps";
  const facts = items.map(documentFact);
  if (facts.every(Boolean)) {
    return items.length >= 2 && facts.every((fact) => fact!.text.length <= 16 && /\d/.test(fact!.text)) ? "stats" : "facts";
  }
  const short = items.every((item) => {
    if (item.children.length !== 1 || item.children[0].type !== "paragraph") return false;
    const text = plain(item);
    return text.length <= 24 && text.split(" ").length <= 3 && !/[.:;!?]$/.test(text);
  });
  return items.length >= 3 && short ? "chips" : "points";
}

/** Splits a "Phase 1: Tease (Apr 14 – Apr 27)" heading into its name and date range. */
export function phaseLabel(title: string) {
  const match = title.match(/^(.+?)\s*\(([^()]+)\)$/);
  return match ? { name: match[1], when: match[2] } : { name: title };
}

/** Accepts the same absolute http(s) links as the VM's Markdown renderer. */
export function safeLink(value: string) {
  if (value.length > 2048 || /[\s\\]/.test(value)) return;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname && !url.username ? value : undefined;
  } catch {
    return;
  }
}

export const colorCode = /(?<![\w&])#[0-9a-fA-F]{6}\b/g;

type TextNode = { type: string; value?: unknown; alt?: unknown; children?: TextNode[] };
const blockContainers = new Set(["root", "list", "listItem", "blockquote", "table", "tableRow", "footnoteDefinition"]);

function nodeText(node: TextNode): string {
  if (node.type === "break") return " ";
  if (node.type === "image" || node.type === "imageReference") return typeof node.alt === "string" ? node.alt : "";
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(nodeText).join(blockContainers.has(node.type) ? " " : "");
}

/** Reduces Markdown to one line of readable text, for previews that cannot hold formatting. */
export function markdownText(markdown: string) {
  return nodeText(parseMarkdown(markdown) as TextNode).replace(/\s+/g, " ").trim();
}
