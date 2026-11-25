import { spawnSync } from "node:child_process";

export const root = "/opt/oma";
export const ownership = `agency.openmarketing.oma.installation=${root}`;
export const containers = { camofox: "oma-camofox", console: "oma-console" } as const;
export type Container = keyof typeof containers;

export function run(command: string, args: string[], capture = false, env = process.env): string {
  if (command === "docker") {
    env = { ...env, DOCKER_HOST: "unix:///var/run/docker.sock" };
    delete env.DOCKER_CONTEXT;
  }
  const result = spawnSync(command, args, { env, encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr?.trim();
    throw new Error(`${command} ${args[0] ?? ""} failed${detail ? `: ${detail}` : ` (${result.signal ?? result.status})`}`);
  }
  return result.stdout ?? "";
}

export function containerStates(version?: string): Map<string, string> {
  const release = version ? ["--filter", `label=agency.openmarketing.oma.release=${version}`] : [];
  const states = run("docker", ["container", "ls", "-a", "--filter", `label=${ownership}`, ...release, "--format", "{{.Names}}\t{{.State}}"], true);
  return new Map(states.trim().split("\n").filter(Boolean).map((line) => {
    const [name, state] = line.trim().split("\t");
    return [name, state];
  }));
}

export function changeContainers(action: "start" | "stop", targets: Container[]): void {
  if (!targets.length) return;
  const states = containerStates();
  for (const target of targets) {
    const name = containers[target];
    const state = states.get(name);
    if (!state) {
      if (action === "start") throw new Error(`${name} is not configured. Run sudo oma setup first.`);
      continue;
    }
    if (action === "start" && state !== "running") run("docker", ["start", name]);
    if (action === "stop" && ["running", "restarting", "paused"].includes(state)) run("docker", ["stop", name]);
  }
}

export function containerLogs(target: Container, follow: boolean): void {
  const name = containers[target];
  if (!containerStates().has(name)) throw new Error(`${name} is not managed by OMA.`);
  run("docker", ["logs", "--tail", "100", ...(follow ? ["--follow"] : []), name]);
}
