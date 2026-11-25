import { expect, test } from "bun:test";
import { classifyStack, installDecision } from "../src/lifecycle";

const staged: Parameters<typeof classifyStack>[0] = { version: "0.1.0", binaries: true, setup: false, docker: true, containers: false,
  stopped: ["agent", "console", "camofox"], unhealthy: [], ready: false };

test("install reruns are no-ops and cannot silently change releases", () => {
  expect(installDecision(null)).toBe("install");
  expect(installDecision("0.1.0")).toBe("unchanged");
  expect(installDecision("0.1.0", "0.1.0")).toBe("unchanged");
  expect(() => installDecision("0.1.0", "0.2.0")).toThrow("sudo oma upgrade 0.2.0");
});

test("doctor gives the next command for each deployment stage", () => {
  expect(classifyStack({ ...staged, version: null, docker: false }).commands).toEqual(["sudo oma install"]);
  expect(classifyStack(staged)).toEqual({ phase: "installed", commands: ["sudo oma setup", "sudo oma start"] });
  const configured = { ...staged, setup: true, containers: true };
  expect(classifyStack(configured)).toEqual({ phase: "configured", commands: ["sudo oma start"] });
  expect(classifyStack({ ...configured, docker: false }).commands).toEqual(["sudo oma start"]);
  expect(classifyStack({ ...configured, containers: false }).commands).toEqual(["sudo oma setup", "sudo oma start"]);
  expect(classifyStack({ ...configured, stopped: ["console"], unhealthy: ["agent"] }).commands)
    .toEqual(["sudo oma start console", "sudo oma logs agent"]);
  expect(classifyStack({ ...configured, stopped: [], ready: true })).toEqual({ phase: "running", commands: [] });
});
