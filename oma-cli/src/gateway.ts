import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { root, run } from "./docker";
import { stackDir, workspaceSocket } from "./lifecycle";

export const agentHome = join(root, "oma-agent-data");
export const agent = join(root, "bin/oma-agent");
type Service = "gateway" | "workspace";
const pidFile = (service: Service) => join(agentHome, `oma-cli-${service}.json`);
const logFile = (service: Service) => join(agentHome, `logs/oma-cli-${service}.log`);
const variable = (service: Service) => `OMA_CLI_${service.toUpperCase()}`;
const agentDir = join(root, "oma-agent");
const agentEnv = () => ({ ...process.env, PATH: `${root}/bin:${process.env.PATH}`, HERMES_HOME: agentHome });

type Identity = { pid: number; start: string };
function readPid(file: string): Partial<Identity> {
  try { return JSON.parse(readFileSync(file, "utf8")) ?? {}; } catch { return {}; }
}
function identity(pid: unknown, requiredEnv: string): Identity | undefined {
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 1) return;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (!fields[19] || fields[0] === "Z") return;
    const env = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0");
    if (!env.includes(requiredEnv)) return;
    return { pid, start: fields[19] };
  } catch { return; }
}
function managedService(service: Service): Identity | undefined {
  const saved = readPid(pidFile(service));
  const running = identity(saved.pid, `${variable(service)}=${agentHome}`);
  if (running && running.start === saved.start) return running;
}
function externalGateway(): Identity | undefined {
  const { pid } = readPid(join(agentHome, "gateway.pid"));
  const live = identity(pid, `HERMES_HOME=${agentHome}`);
  if (!live) return;
  try {
    const args = readFileSync(`/proc/${live.pid}/cmdline`, "utf8").split("\0");
    if (args.includes("gateway") && args.includes("run")) return live;
  } catch { return; }
}

export function gatewayState() {
  const managed = managedService("gateway");
  const live = managed ?? externalGateway();
  return { state: live ? "running" : existsSync(agent) ? "stopped" : "not installed", managed: Boolean(managed), pid: live?.pid ?? null };
}

export const workspaceRunning = () => Boolean(managedService("workspace"));

function runtimeCommand(module: string): string[] {
  const args: unknown = JSON.parse(run(agent, ["--print-runtime-command", "--module", module], true, agentEnv()));
  if (!Array.isArray(args) || !args.length || !args.every((value) => typeof value === "string") || !args[0].startsWith("/")) {
    throw new Error("Could not resolve the installed Hermes Python runtime.");
  }
  return args;
}

export function seedWorkspace(): void {
  const [command, ...args] = runtimeCommand("hermes_cli.oma_campaigns.standalone");
  run(command, [...args, "seed", "--install-dir", agentDir, "--ensure-maintenance"], false, agentEnv());
}

export async function startGateway(): Promise<void> {
  if (!existsSync(agent)) throw new Error("OMA Agent is not installed. Run sudo oma install first.");
  if (externalGateway() && !managedService("gateway")) throw new Error("Stop the externally managed Hermes gateway first.");
  await startService("gateway", agent, ["gateway", "run"]);
}

export async function startWorkspace(): Promise<void> {
  if (workspaceRunning()) return;
  const [python] = runtimeCommand("hermes_cli.oma_campaigns.standalone");
  // Use the same runtime bootstrap as the pinned native launcher, without writing into its checkout.
  const bootstrap = "import runpy, sys; sys.path.insert(0, sys.argv[1]); import hermes_bootstrap; " +
    "sys.path.insert(0, sys.argv[2]); runpy.run_path(sys.argv[3], run_name='__main__')";
  await startService("workspace", python, ["-BI", "-c", bootstrap, agentDir, stackDir, join(stackDir, "workspace.py")],
    { ...agentEnv(), HERMES_DIR: agentDir, OMA_WORKSPACE_SOCKET: workspaceSocket });
}

async function startService(service: Service, executable: string, args: string[], env: NodeJS.ProcessEnv = agentEnv()): Promise<void> {
  if (managedService(service)) return;
  mkdirSync(join(agentHome, "logs"), { recursive: true, mode: 0o700 });
  const log = openSync(logFile(service), "a", 0o600);
  let child: ChildProcess;
  try {
    const spawned = spawn(executable, args, {
      cwd: agentHome, detached: true, stdio: ["ignore", log, log],
      env: { ...env, [variable(service)]: agentHome },
    });
    await new Promise<void>((resolve, reject) => {
      spawned.once("spawn", resolve);
      spawned.once("error", reject);
    });
    child = spawned;
  } finally { closeSync(log); }
  child.unref();
  const live = identity(child.pid, `${variable(service)}=${agentHome}`);
  if (!live) throw new Error(`Hermes ${service} exited during startup. Run sudo oma logs agent.`);
  writeFileSync(pidFile(service), `${JSON.stringify(live)}\n`, { mode: 0o600 });
}

export async function stopGateway(): Promise<void> {
  if (!managedService("gateway") && externalGateway()) throw new Error("Hermes was started outside oma; stop it with its original launcher.");
  await stopService("gateway");
  await stopService("workspace");
}

async function stopService(service: Service): Promise<void> {
  const live = managedService(service);
  if (!live) return;
  try { process.kill(live.pid, "SIGTERM"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  for (let n = 0; managedService(service) && n < 300; n++) await Bun.sleep(100);
  if (managedService(service)) throw new Error(`Hermes ${service} is still draining; check sudo oma logs agent.`);
  if (existsSync(pidFile(service))) unlinkSync(pidFile(service));
}

export function gatewayLogs(follow: boolean): void {
  const files = [logFile("gateway"), logFile("workspace")].filter(existsSync);
  if (!files.length) throw new Error("No CLI-managed agent logs yet. Run sudo oma start first.");
  run("tail", ["-n", "100", ...(follow ? ["-f"] : []), ...files]);
}
