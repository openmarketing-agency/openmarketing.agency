import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ChatProgress } from "../components/chat-progress";
import type { ActiveAgentRun } from "../lib/agent-chat";

const render = (run?: ActiveAgentRun, reconnecting = false) =>
  renderToStaticMarkup(createElement(ChatProgress, { run, reconnecting }));

test("chat progress uses the latest reported activity and timestamp rather than a percentage", () => {
  assert.match(renderToStaticMarkup(createElement(ChatProgress, { sending: true })), /Sending message/);
  assert.match(render(), /Starting turn/);
  assert.match(render({ status: "running", phase: "queued" }), /Queued/);
  const updatedAt = "2023-11-14T22:13:20.000Z";
  const searching = render({ status: "running", phase: "running", tool: "web_search", updatedAt });
  assert.match(searching, /Searching the web/);
  assert.match(searching, /Last activity: <time dateTime="2023-11-14T22:13:20.000Z"/);
  assert.doesNotMatch(searching, /progressbar|web_search/);
  assert.match(render({ status: "running", phase: "running" }), /Working on your request/);
  assert.match(render({ status: "running", phase: "running", tool: "custom_tool" }), /Using a tool/);
});

test("chat distinguishes waiting for input from reconnecting and working", () => {
  assert.match(render({ status: "running", phase: "waiting_for_answer" }), /Waiting for your answer/);
  assert.match(render({ status: "running", phase: "waiting_for_approval" }), /Waiting for your approval/);
  assert.match(render({ status: "running", phase: "stopping" }), /Stopping/);
  const reconnecting = render({ status: "running", phase: "running", tool: "web_search" }, true);
  assert.match(reconnecting, /Reconnecting/);
  assert.doesNotMatch(reconnecting, /Searching the web/);
});
