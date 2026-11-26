import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMessageText } from "../components/chat-message-text";

const render = (text: string) => renderToStaticMarkup(createElement(ChatMessageText, { text }));

test("short messages render in full without a disclosure button", () => {
  assert.doesNotMatch(render("Quick reply"), /Show more/);
  assert.match(render("Quick reply"), /Quick reply/);
});

test("long or multiline chat messages start with a bounded preview", () => {
  for (const text of ["First paragraph. ".repeat(60), "A short line\n".repeat(10)]) {
    const markup = render(text + "Hidden ending");
    assert.match(markup, /aria-expanded="false"/);
    assert.match(markup, /Show more/);
    assert.doesNotMatch(markup, /Hidden ending/);
  }
});

test("agent replies render Markdown while people's messages stay plain", () => {
  const agent = renderToStaticMarkup(createElement(ChatMessageText, { text: "Done: **3 drafts** ready", markdown: true }));
  assert.match(agent, /class="doc-prose doc-chat"/);
  assert.match(agent, /<strong>3 drafts<\/strong>/);
  assert.equal(render("Use **bold**"), "<p>Use **bold**</p>");
});
