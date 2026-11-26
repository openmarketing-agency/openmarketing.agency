/** Verifies that designed document layouts stay read-only, faithful to document colors, and render with OpenUI components. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Renderer } from "@openuidev/react-lang";
import { createElement, type ComponentProps } from "react";
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
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const componentPath = require.resolve("../components/designed-document.tsx");
  t.after(() => { delete require.cache[componentPath]; });
  const { DesignedDocument } = require(componentPath) as typeof import("../components/designed-document");
  const props = {
    target: { kind: "brand", id: "fernway" },
    layout: { source: program, generatedAt: 1, generation: { systemPrompt: "SYSTEM PROMPT", userMessage: "Make this Markdown visually better" } },
  } as ComponentProps<typeof DesignedDocument>;
  const html = renderToStaticMarkup(createElement(DesignedDocument, props, createElement("p", null, "standard")));
  assert.match(html, /<summary>Generation details<\/summary>/);
  assert.match(html, /<code>SYSTEM PROMPT<\/code>/);
  assert.match(html, /<code>Make this Markdown visually better<\/code>/);
  assert.match(html, /aria-label="Agent-generated OpenUI source"><code>root = Stack/);
});

test("streams the page as the agent writes it, retries one invalid draft, and saves the exact prompts", async (t) => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { createServer } = await import("node:http");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { DatabaseSync } = await import("node:sqlite");
  const dir = await mkdtemp(join(tmpdir(), "oma-layout-"));
  const env = { OMA_DATA_DIR: dir, OMA_WORKSPACE_SOCKET: join(dir, "ws") };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  // An installation from before the prompt columns upgrades in place.
  const old = new DatabaseSync(join(dir, "oma.sqlite"));
  old.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, onboarding_state TEXT); INSERT INTO users VALUES ('owner', NULL);
    CREATE TABLE document_layouts (user_id TEXT NOT NULL, content_hash TEXT NOT NULL, source TEXT, generated_at INTEGER, attempt TEXT, lease_until INTEGER, PRIMARY KEY (user_id, content_hash));
    PRAGMA user_version = 9;`);
  old.close();

  const requests: { prompt: string; message: string }[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push(JSON.parse(body));
    response.writeHead(200, { "Content-Type": "application/x-ndjson" });
    const draft = requests.length === 1 ? program.replace("root = Stack(", "root = Card(") : program;
    const half = Math.floor(draft.length / 2);
    for (const text of [draft.slice(0, half), draft.slice(half)]) response.write(JSON.stringify({ type: "delta", text }) + "\n");
    response.end(JSON.stringify({ type: "done" }) + "\n");
  });
  await new Promise<void>((resolve) => server.listen(env.OMA_WORKSPACE_SOCKET, resolve));
  const { getDb } = await import("../lib/db");
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    getDb().close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });

  const { documentLayoutMessage, generateDocumentLayout, readDocumentLayout } = await import("../lib/server/document-layout");
  const events: { type: string }[] = [];
  const layout = await generateDocumentLayout("owner", markdown, (event) => events.push(event));
  assert.deepEqual(events.map(({ type }) => type), ["delta", "delta", "retry", "delta", "delta"]);
  assert.equal(layout.source, program);
  assert.equal(requests[0].message, documentLayoutMessage(markdown));
  assert.match(requests[1].prompt, /Correct the following validation issue/);
  const saved = readDocumentLayout("owner", markdown).layout;
  assert.equal(saved?.source, program);
  assert.equal(saved?.generation?.userMessage, "Make this Markdown visually better, easy to read, and fun to read. Keep all of its content.\n\n" + markdown);
  assert.equal(saved?.generation?.systemPrompt, requests[1].prompt);
});
