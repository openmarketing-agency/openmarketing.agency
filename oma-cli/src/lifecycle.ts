import { existsSync, readFileSync } from "node:fs";
import { isIPv4 } from "node:net";
import { join } from "node:path";
import { root } from "./docker";

export const stackDir = join(root, "stack");
export const installer = join(stackDir, "install.sh");
export const workspaceSocket = join(root, "run/console/workspace.sock");
export const gatewayPort = 8642;

export function configuredHost(version: string): string | null {
  try {
    const [savedVersion, host] = readFileSync(join(stackDir, "setup-state"), "utf8").trim().split("\n");
    return savedVersion === version && isIPv4(host) && existsSync(join(root, "keys.txt")) ? host : null;
  } catch { return null; }
}

export function installDecision(current: string | null, requested?: string): "install" | "unchanged" {
  if (!current) return "install";
  if (!requested || requested === current) return "unchanged";
  throw new Error(`OMA ${current} is installed. Use sudo oma upgrade ${requested} to select a newer release.`);
}

type Service = "agent" | "console" | "camofox";
type StackState = {
  version: string | null; binaries: boolean; setup: boolean; docker: boolean; containers: boolean;
  stopped: Service[]; unhealthy: Service[]; ready: boolean;
};

export function classifyStack(s: StackState) {
  if (!s.version) return { phase: "not installed", commands: ["sudo oma install"] };
  if (!s.binaries) return { phase: "incomplete installation", commands: [`sudo oma install ${s.version}`] };
  if (!s.setup || (s.docker && !s.containers)) return { phase: "installed", commands: ["sudo oma setup", "sudo oma start"] };
  if (s.ready) return { phase: "running", commands: [] };
  if (!s.docker || s.stopped.length === 3) return { phase: "configured", commands: ["sudo oma start"] };
  return { phase: "degraded", commands: [
    ...s.stopped.map((service) => `sudo oma start ${service}`),
    ...s.unhealthy.map((service) => `sudo oma logs ${service}`),
  ] };
}
