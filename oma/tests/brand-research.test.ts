/** Verifies that brand research opens as a reader with a grouped, searchable document list and page controls. */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { folderLabel, groupDocuments } from "../components/research-nav";

const documents = [
  { id: "a".repeat(16), title: "market", path: "research/market.md" },
  { id: "b".repeat(16), title: "competitors", path: "research/competitors.md" },
  { id: "c".repeat(16), title: "DESIGN", path: "design/DESIGN.md" },
];

test("groups research documents by folder in saved order", () => {
  const groups = groupDocuments(documents.map(({ id, title, path }) => ({ id, label: title, file: path })).concat({ id: "d", label: "notes", file: "notes.md" }));
  assert.deepEqual(groups.map(({ folder, documents }) => [folder, documents.length]), [["research", 2], ["design", 1], ["", 1]]);
  assert.equal(folderLabel("docs/repository/clozva-website"), "Clozva website");
  assert.equal(folderLabel("research/competitors"), "Competitors");
  assert.equal(folderLabel(""), "Documents");
});

test("shows the open document beside the list with previous and next links", (t) => {
  const require = createRequire(import.meta.url);
  const sourcesPath = require.resolve("../components/brand-sources.tsx");
  t.after(() => { delete require.cache[sourcesPath]; });
  const { BrandResearch } = require(sourcesPath) as typeof import("../components/brand-sources");
  const brand = { id: "clozva", name: "CLOZVA", description: "", revision: "", knowledge: "", palette: {}, logos: {}, assets: {}, documents };
  const selected = { document: { ...documents[1], content: "# Competitors\n\nCrocs and Joybees." } };
  const html = renderToStaticMarkup(createElement(BrandResearch, { brand, path: "/workspace/brands/clozva", selected }));
  // Every document stays visible above the open one, grouped under readable folder names.
  assert.match(html, /<nav class="research-index" aria-label="Research documents">/);
  assert.match(html, /<dt title="research">Research<\/dt>.*<dt title="design">Design<\/dt>/s);
  assert.match(html, /aria-current="page" href="[^"]+">Competitors<\/a>/);
  assert.equal(html.match(/<a [^>]*href="\/workspace\/brands\/clozva\?view=research&amp;document=/g)?.length, 5);
  assert.match(html, /<span>2 of 3<\/span>/);
  assert.match(html, /aria-label="Previous: Market"/);
  assert.match(html, /aria-label="Next: DESIGN"/);
  assert.match(html, /Crocs and Joybees\./);
  assert.doesNotMatch(html, /All documents/);
});
