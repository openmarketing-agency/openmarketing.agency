/** Checks native link and form semantics after adopting the shared console controls. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";

test("a button styled as a link renders one native navigation target", () => {
  const markup = renderToStaticMarkup(
    createElement(Button, { asChild: true, variant: "outline" },
      createElement("a", { href: "/playbooks", "aria-current": "page" }, "Playbooks"),
    ),
  );

  assert.match(markup, /^<a /);
  assert.match(markup, /data-slot="button"/);
  assert.match(markup, /href="\/playbooks"/);
  assert.match(markup, /aria-current="page"/);
  assert.doesNotMatch(markup, /<button/);
});

test("console form controls preserve validation and submitter attributes", () => {
  const markup = renderToStaticMarkup(
    createElement("form", null,
      createElement(Input, { name: "cpu", type: "number", min: 1, max: 8, required: true }),
      createElement(Button, { type: "submit", name: "action", value: "provision", disabled: true }, "Retry"),
    ),
  );

  assert.match(markup, /<input[^>]*data-slot="input"/);
  assert.match(markup, /<input[^>]*name="cpu"/);
  assert.match(markup, /<input[^>]*required=""/);
  assert.match(markup, /<input[^>]*min="1"/);
  assert.match(markup, /<input[^>]*max="8"/);
  assert.match(markup, /<button[^>]*name="action"/);
  assert.match(markup, /<button[^>]*value="provision"/);
  assert.match(markup, /<button[^>]*disabled=""/);
});


test("a labeled select keeps its name, native options, and selected value", () => {
  const markup = renderToStaticMarkup(
    createElement("label", null, "Activity type",
      createElement(NativeSelect, { name: "category", defaultValue: "worker" },
        createElement("option", { value: "" }, "All activity"),
        createElement("option", { value: "worker" }, "Kanban workers"),
      ),
    ),
  );

  assert.match(markup, /<label>Activity type<span/);
  assert.match(markup, /<select[^>]*name="category"/);
  assert.match(markup, /<option value="worker" selected="">Kanban workers/);
  assert.match(markup, /<svg[^>]*aria-hidden="true"/);
});
