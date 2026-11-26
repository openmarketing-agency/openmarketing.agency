/** Verifies that designed document layouts stay read-only, faithful to document colors, and render with OpenUI components. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Renderer } from "@openuidev/react-lang";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { documentLibrary, swatch } from "../lib/document-library";
import { documentLayoutPrompt, validateDocumentLayout } from "../lib/server/document-layout";

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
