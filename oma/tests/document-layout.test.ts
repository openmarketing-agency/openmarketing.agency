/** Verifies that designed document layouts stay read-only, faithful to document colors, and render with OpenUI components. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Renderer } from "@openuidev/react-lang";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { documentLibrary, swatch } from "../lib/document-library";
import { brandExample, documentLayoutPrompt, playbookExample, validateDocumentLayout } from "../lib/server/document-layout";

const markdown = "# Fernway\n\nPrimary #2F5D50 and cream #F4EDE1.\n\n## Voice\n\nWarm and precise.";
const program = [
  "root = Stack([hero, colors, voice], \"column\", \"l\")",
  "hero = Card([CardHeader(\"Fernway\", \"Small-batch coffee\")])",
  "colors = Card([InlineHeader(\"Colors\"), ColorSwatches([{name: \"Fern\", hex: \"#2F5D50\", usage: \"Primary\"}, {name: \"Cream\", hex: \"#f4ede1\"}])])",
  "voice = Card([InlineHeader(\"Voice\"), ContextCardBlock([ContextCardItem(\"warm\", \"Warm\", \"Talk like a neighbor.\", \"gray\"), ContextCardItem(\"precise\", \"Precise\", \"Name the origin.\", \"gray\")], \"grid\", true)])",
].join("\n");

test("accepts a read-only page built from the document's own colors", () => {
  assert.equal(validateDocumentLayout("```openui\n" + program + "\n```", markdown), program);
  assert.match(documentLayoutPrompt, /ColorSwatches\(colors:/);
  assert.match(documentLayoutPrompt, /ContextCardBlock\(/);
});

test("rejects interactive components, bindings, remote images, and invented colors", () => {
  const swap = (from: string, to: string) => program.replace(from, to);
  for (const [source, message] of [
    [swap("CardHeader(\"Fernway\", \"Small-batch coffee\")", "Form(\"f\", Buttons([]))"), /Form is not available/],
    [swap("\"#2F5D50\"", "\"#000000\""), /hex codes written in the document/],
    [swap("\"gray\")", "\"gray\", \"https://example.com/a.jpg\")"), /Leave out images/],
    [program + "\n$open = true", /queries, mutations, and \$variables/],
    [swap("\"Talk like a neighbor.\"", "\"![x](https://example.com/x.png)\""), /without scripts/],
    [swap("root = Stack(", "root = Card("), /rooted in a Stack/],
  ] as const) {
    assert.throws(() => validateDocumentLayout(source, markdown), message);
  }
});

test("renders swatches only for literal hex colors through the OpenUI library", () => {
  assert.equal(swatch(" #2f5d50 "), "#2f5d50");
  assert.equal(swatch("red; background: url(x)"), undefined);
  const html = renderToStaticMarkup(createElement(Renderer, { response: program, library: documentLibrary, isStreaming: false }));
  assert.match(html, /class="openui-doc-swatches"/);
  assert.match(html, /style="background:#2F5D50"/);
  assert.match(html, /Talk like a neighbor\./);
});

test("repairs small model slips instead of discarding the whole page", async () => {
  const { trimArguments } = await import("../lib/server/openui-repair");
  assert.equal(trimArguments(`k = Kpis([Kpi("A, (b)", x.y, "number", null, null, "hint, with comma"), Kpi("B", 1)])`, { Kpi: 3 }),
    `k = Kpis([Kpi("A, (b)", x.y, "number"), Kpi("B", 1)])`);
  // A reference to a card the model never defined is dropped, and the rest of the page stays valid.
  const missing = program.replace("[hero, colors, voice]", "[hero, colors, ghost, voice]");
  assert.equal(validateDocumentLayout(missing, markdown), program);
  const orphan = program + "\nextra = Card([CardHeader(\"Unused\")])";
  assert.throws(() => validateDocumentLayout(orphan, markdown), /Connect extra to root/);
});

test("repairs small model slips instead of discarding the whole page", async () => {
  const { trimArguments } = await import("../lib/server/openui-repair");
  assert.equal(trimArguments(`k = Kpis([Kpi("A, (b)", x.y, "number", null, null, "hint, with comma"), Kpi("B", 1)])`, { Kpi: 3 }),
    `k = Kpis([Kpi("A, (b)", x.y, "number"), Kpi("B", 1)])`);
  // A reference to a card the model never defined is dropped, and the rest of the page stays valid.
  const missing = program.replace("[hero, colors, voice]", "[hero, colors, ghost, voice]");
  assert.equal(validateDocumentLayout(missing, markdown), program);
  const orphan = program + "\nextra = Card([CardHeader(\"Unused\")])";
  assert.throws(() => validateDocumentLayout(orphan, markdown), /Connect extra to root/);
});

test("teaches the model with a brand and a playbook example that pass validation themselves", () => {
  for (const example of [brandExample, playbookExample]) {
    assert.equal(validateDocumentLayout(example, example), example);
    assert.ok(documentLayoutPrompt.includes(example.split("\n")[1]));
  }
  assert.match(documentLayoutPrompt, /large-heavy/);
  assert.match(documentLayoutPrompt, /OverviewCardBlock of 3–4 key facts/);
});

test("shows the saved system prompt, user message, and OpenUI source under a designed page", async (t) => {
  const { createRequire, default: Module } = await import("node:module");
  const require = createRequire(import.meta.url);
  const actionPath = require.resolve("../app/actions/document-layout.ts");
  const componentPath = require.resolve("../components/designed-document.tsx");
  const action = new Module(actionPath);
  action.exports = { designDocumentAction: async () => ({}) };
  action.loaded = true;
  require.cache[actionPath] = action;
  t.after(() => { delete require.cache[actionPath]; delete require.cache[componentPath]; });
  const { DesignedDocument } = require(componentPath) as typeof import("../components/designed-document");
  const html = renderToStaticMarkup(createElement(DesignedDocument, {
    target: { kind: "brand", id: "fernway" },
    layout: { source: program, generatedAt: 1, generation: { systemPrompt: "SYSTEM PROMPT", userMessage: "Make this Markdown visually better" } },
    children: createElement("p", null, "standard"),
  }));
  assert.match(html, /<summary>Generation details<\/summary>/);
  assert.match(html, /<code>SYSTEM PROMPT<\/code>/);
  assert.match(html, /<code>Make this Markdown visually better<\/code>/);
  assert.match(html, /aria-label="Agent-generated OpenUI source"><code>root = Stack/);
});
