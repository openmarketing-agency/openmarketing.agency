/** Verifies that saved workspace Markdown keeps its structure, navigation, and safe rendering. */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { List } from "mdast";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkspaceDocument, WorkspaceDocumentContents } from "../components/workspace-document";
import { listLayout, parseWorkspaceDocument, phaseLabel } from "../lib/workspace-document";

const brand = `# Fernway Coffee

> Small-batch coffee for people who walk.

An independent roaster in Portland.

## Overview

- **Founded:** 2017
- **Category:** Specialty coffee

## Voice and tone

- Warm
- Plain-spoken
- Curious

### Do
- Name the farm

### Don’t
- Say "artisanal"

## Visual identity

| Role | Color |
| --- | --- |
| Forest | #2F4A3A |

## Plan

### Phase 1: Tease (Apr 14 – Apr 27)
1. Open a waitlist

### Phase 2: Launch (Apr 28 – May 18)
1. Email the waitlist

## Success metrics

- **Subscriptions:** 400
- **Email CTR:** 3.5%
`;

const render = (text: string, name = "Fernway Coffee") =>
  renderToStaticMarkup(createElement(WorkspaceDocument, { document: parseWorkspaceDocument(text), name, empty: "Nothing yet." }));

const firstList = (text: string) => parseWorkspaceDocument(text).intro.find((node): node is List => node.type === "list")!;

test("splits a brand file into an opening, sections, and paired guidance", () => {
  const document = parseWorkspaceDocument(brand);
  assert.equal(document.title, "Fernway Coffee");
  assert.equal(document.tagline?.type, "blockquote");
  assert.equal(document.lede.length, 1);
  assert.deepEqual(document.sections.map(({ title }) => title), ["Overview", "Voice and tone", "Visual identity", "Plan", "Success metrics"]);
  const voice = document.sections[1];
  assert.equal(voice.guidance?.dos.title, "Do");
  assert.equal(voice.guidance?.donts.title, "Don't");
  assert.equal(voice.groups.length, 0);
  assert.equal(document.sections[3].timeline, true);
});

test("gives repeated section titles unique anchors", () => {
  const { sections } = parseWorkspaceDocument("## Notes\nA\n\n## Notes\nB");
  assert.deepEqual(sections.map(({ id }) => id), ["doc-notes", "doc-notes-2"]);
});

test("keeps card anchors and heading IDs distinct when titles overlap generated IDs", () => {
  const markup = render("## Notes\nA\n\n## Notes 2\nB\n\n## Notes\nC\n\n## Notes Heading\nD");
  const ids = Array.from(markup.matchAll(/\bid="([^"]+)"/g), ([, id]) => id);
  assert.equal(ids.length, 8);
  assert.equal(new Set(ids).size, ids.length);
});

test("chooses a list layout from the items' shape", () => {
  assert.equal(listLayout(firstList("- **Founded:** 2017\n- **Category:** Specialty coffee")), "facts");
  assert.equal(listLayout(firstList("- **Budget:** $6,000\n- **CTR**: 3.5%")), "stats");
  assert.equal(listLayout(firstList("- Warm\n- Plain-spoken\n- Curious")), "chips");
  assert.equal(listLayout(firstList("- Warm\n- Plain-spoken")), "points");
  assert.equal(listLayout(firstList("- **Important** read the guide first\n- Then the second")), "points");
  assert.equal(listLayout(firstList("1. First\n2. Second")), "steps");
  assert.equal(listLayout(firstList("- [x] Done\n- [ ] Not yet")), "tasks");
  assert.equal(listLayout(firstList("- Never discount by more than 20%.\n- Get written permission.\n- Use the inbox.")), "points");
});

test("reads phase headings with optional date ranges", () => {
  assert.deepEqual(phaseLabel("Phase 1: Tease (Apr 14 – Apr 27)"), { name: "Phase 1: Tease", when: "Apr 14 – Apr 27" });
  assert.deepEqual(phaseLabel("Week 2"), { name: "Week 2" });
});

test("renders sections as cards with structured parts", () => {
  const markup = render(brand);
  assert.doesNotMatch(markup, /doc-hero-title/, "a title matching the record name is not repeated");
  assert.match(markup, /class="doc-hero"/);
  assert.match(markup, /class="doc-facts"/);
  assert.match(markup, /class="doc-chips"/);
  assert.match(markup, /class="doc-guidance-do"/);
  assert.match(markup, /class="doc-timeline"/);
  assert.match(markup, /<span>Apr 14 – Apr 27<\/span>/);
  assert.match(markup, /class="doc-stats"/);
  assert.match(markup, /<i style="background:#2F4A3A" aria-hidden="true"><\/i>#2F4A3A/);
  assert.match(markup, /id="doc-success-metrics"/);
});

test("shows the empty message and a title that differs from the record name", () => {
  assert.equal(render("  \n"), '<p class="doc-empty">Nothing yet.</p>');
  assert.match(render("# Spring launch\n\nIntro."), /class="doc-hero-title">Spring launch</);
});

test("keeps raw HTML as text and drops images and unsafe links", () => {
  const markup = render(`<script>alert(1)</script>

## Links

[ok](https://example.com) [bad](javascript:alert(1)) <img src=x onerror=alert(1)> ![logo](https://example.com/a.png)`);
  assert.doesNotMatch(markup, /<script|<img/);
  assert.match(markup, /&lt;script&gt;/);
  assert.match(markup, /<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer nofollow">ok<\/a>/);
  assert.doesNotMatch(markup, /javascript:/);
  assert.match(markup, /logo/);
});

test("renders reference links with the first matching definition and the same URL restrictions", () => {
  const markup = render([
    "[Read the guide][guide] [Unsafe reference][unsafe]", "",
    '> [guide]: https://example.com/first "Guide title"', "",
    "[guide]: https://example.com/second", "[unsafe]: javascript:alert(1)",
  ].join("\n"));
  assert.match(markup, /<a href="https:\/\/example.com\/first" title="Guide title"[^>]*>Read the guide<\/a>/);
  assert.doesNotMatch(markup, /example\.com\/second|javascript:/);
  assert.match(markup, /Unsafe reference/);
});

test("lists contents only when there are at least two sections", () => {
  const toc = (text: string) => renderToStaticMarkup(createElement(WorkspaceDocumentContents, { document: parseWorkspaceDocument(text) }));
  assert.equal(toc("## Only\nOne"), "");
  assert.match(toc(brand), /href="#doc-voice-and-tone"/);
});
