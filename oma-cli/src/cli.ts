import { join } from "node:path";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isIPv4 } from "node:net";
import { version as cliVersion } from "../package.json";
import { changeContainers, containerLogs, containers, containerStates, root, run, type Container } from "./docker";
import { agent, agentHome, gatewayLogs, gatewayState, seedWorkspace, startGateway, startWorkspace, stopGateway, workspaceRunning } from "./gateway";
import { classifyStack, configuredHost, gatewayPort, installDecision, installer, stackDir, workspaceSocket } from "./lifecycle";
import { components, readManifest } from "./release";
import { availableVersions, latestRelease, newerVersion, releaseByVersion, releaseManifest, runtimeFiles, withStackBundle } from "./update";
import { cliPath, replaceCli, requireManagedCli } from "./self-update";

const usage = `OMA CLI (x86-64 Debian and Ubuntu)

  oma install [version]               Install Docker and native tools, and pull pinned images
  oma status [--output text|json]     Show all components and readiness
  oma doctor [--output text|json]     Check readiness and recommend the next command
  oma start|stop|restart [component]  Control all, agent, console, or camofox
  oma logs <component> [--follow]     Show agent, console, or camofox logs
  oma versions [--output text|json]   List published OMA releases, newest first
  oma updates [--output text|json]    Check the latest release and component pins
  oma upgrade [version]               Upgrade the whole stack to a newer release (default: latest)
  oma setup                           Prepare keys and create stopped containers
  oma --version                       Show the standalone CLI version
  oma cli status|updates|versions [--output text|json]
  oma cli upgrade [version]           Upgrade just the CLI at /usr/local/bin/oma

Run host management commands as root: oma install, oma setup, then oma start.
Configure your model in the OMA Console after it starts.`;
const omactl = join(root, "bin/omactl");
const installedManifest = join(stackDir, "versions.yaml");
const legacyStackDir = join(root, "oma-cli");
const installedRelease = () => existsSync(installedManifest) ? readManifest(stackDir)
  : existsSync(join(legacyStackDir, "versions.yaml")) ? readManifest(legacyStackDir) : null;
const progress = (message: string) => console.error(`==> ${message}`);

function requireRoot(): void {
  if (process.platform !== "linux" || process.getuid?.() !== 0) throw new Error("Run this command as root on Linux.");
}

const nativeFilesPresent = () => [agent, omactl, ...runtimeFiles.map((file) => join(stackDir, file))].every(existsSync);
const containersPresent = (states: Map<string, string>) => Object.values(containers).every((name) => states.has(name));

function assertStopped(): void {
  if (gatewayState().pid || workspaceRunning()) throw new Error("Run sudo oma stop before changing the installed stack.");
  let states: Map<string, string>;
  try { states = containerStates(); } catch { return; }
  if (Object.values(containers).some((name) => ["running", "restarting", "paused"].includes(states.get(name) ?? ""))) {
    throw new Error("Run sudo oma stop before changing the installed stack.");
  }
}

function setupEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (containerStates().has(containers.console)) {
    const saved: string[] = JSON.parse(run("docker", ["container", "inspect", "--format", "{{json .Config.Env}}", containers.console], true));
    const keys = new Set(["OMA_BIND_ADDRESS", "OMA_FRONTEND_PORT", "OMA_APP_URL", "OMA_COOKIE_SECURE", "OMA_SECRET_KEY",
      "OMA_INTEGRATION_ENCRYPTION_KEY", "OMA_REGISTRATION_ENABLED", "OMA_CORS_ORIGINS", "OMA_DOCS_ENABLED"]);
    for (const entry of saved) {
      const index = entry.indexOf("=");
      const key = entry.slice(0, index);
      if (index > 0 && keys.has(key) && env[key] === undefined) env[key] = entry.slice(index + 1);
    }
  }
  return { ...env, OMA_STACK_STAGE: "setup" };
}

function applyBundle(bundle: string, action: "install" | "upgrade"): void {
  const manifest = readManifest(bundle);
  const currentVersion = installedRelease()?.version ?? null;
  if (action === "install") installDecision(currentVersion, manifest.version);
  else if (!currentVersion) notInstalled();
  else if (!newerVersion(manifest.version, currentVersion)) notNewer(manifest.version, currentVersion);
  assertStopped();
  progress(`Applying OMA ${manifest.version} (${action})`);
  run("bash", [join(bundle, "install.sh")], false, { ...process.env, OMA_STACK_STAGE: "install" });
  progress("Recording the installed stack release");
  run("install", ["-d", "-m", "0755", stackDir]);
  const stage = mkdtempSync(join(stackDir, ".manifest-"));
  try {
    for (const file of [...runtimeFiles, "versions.yaml"]) {
      copyFileSync(join(bundle, file), join(stage, file));
      chmodSync(join(stage, file), 0o644);
    }
    for (const file of runtimeFiles) renameSync(join(stage, file), join(stackDir, file));
    if (currentVersion !== manifest.version) rmSync(join(stackDir, "setup-state"), { force: true });
    renameSync(join(stage, "versions.yaml"), installedManifest);
  } finally { rmSync(stage, { recursive: true, force: true }); }
  progress(`OMA ${manifest.version} installed. Next: sudo oma setup, then sudo oma start.`);
}

function notInstalled(): never {
  throw new Error("OMA is not installed. Run oma install first.");
}

function notNewer(target: string, current: string): never {
  throw new Error(`OMA ${target} is not newer than installed OMA ${current}.`);
}

async function install(version?: string): Promise<void> {
  const current = installedRelease();
  if (installDecision(current?.version ?? null, version) === "unchanged" && current) {
    if (nativeFilesPresent() && !missingImages(current)) {
      progress(`OMA ${current.version} is already installed. Run sudo oma doctor for next steps.`);
      return;
    }
    version = current.version;
    progress(`Repairing OMA ${version}`);
  }
  ensureDownloader();
  progress(version ? `Looking up OMA ${version}` : "Looking up the latest OMA release");
  const release = version ? await releaseByVersion(version) : await latestRelease();
  if (!release) throw new Error("No installable OMA release has been published.");
  await withStackBundle(release, (bundle) => applyBundle(bundle, "install"));
}

function ensureDownloader(): void {
  const os = readFileSync("/etc/os-release", "utf8");
  if (process.arch !== "x64" || !/^ID=(?:debian|ubuntu)\s*$/m.test(os)) throw new Error("OMA requires x86-64 Debian or Ubuntu.");
  if (Bun.which("curl")) return;
  progress("Installing curl and CA certificates for release downloads");
  run("apt-get", ["update"]);
  run("apt-get", ["install", "-y", "--no-install-recommends", "ca-certificates", "curl"], false,
    { ...process.env, DEBIAN_FRONTEND: "noninteractive" });
}

function missingImages(release: ReturnType<typeof readManifest>): boolean {
  if (!Bun.which("docker")) return true;
  try { run("docker", ["info"], true); } catch { return false; } // Setup/start handles a stopped daemon.
  try {
    run("docker", ["image", "inspect", `ghcr.io/openmarketing-agency/oma-console:v${release.pins["oma-console"]}`, release.pins.camofox], true);
    return false;
  } catch { return true; }
}

function ensureDocker(): void {
  run("bash", [installer], false, { ...process.env, OMA_STACK_STAGE: "docker" });
}

function setup(): void {
  const current = installedRelease();
  if (!current) notInstalled();
  if (!nativeFilesPresent()) throw new Error(`Incomplete installation. Run sudo oma install ${current.version}.`);
  ensureDocker();
  if (configuredHost(current.version) && containersPresent(containerStates(current.version))) {
    progress("OMA is already configured. Next: sudo oma start.");
    return;
  }
  assertStopped();
  seedWorkspace();
  run("bash", [installer], false, setupEnvironment());
  const host = readFileSync(join(stackDir, "setup-host"), "utf8").trim();
  if (!isIPv4(host)) throw new Error("Invalid private gateway address from setup.");
  const stage = mkdtempSync(join(stackDir, ".setup-"));
  try {
    const next = join(stage, "state");
    writeFileSync(next, `${current.version}\n${host}\n`, { mode: 0o644 });
    renameSync(next, join(stackDir, "setup-state"));
  } finally { rmSync(stage, { recursive: true, force: true }); }
  progress("OMA is configured. Next: sudo oma start.");
}

async function health(url: string, platform?: string, unix?: string): Promise<string> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000), redirect: "error", unix });
    if (platform && response.ok && (await response.json()).platform !== platform) return "unexpected response";
    return response.ok ? "ready" : `HTTP ${response.status}`;
  } catch { return "unreachable"; }
}

const workspaceHealth = () => health("http://localhost/health", undefined, workspaceSocket);
const gatewayHealth = (host: string) => health(`http://${host}:${gatewayPort}/health`, "hermes-agent");

async function containerHealth(component: Container, state: string) {
  const name = containers[component];
  if (state !== "running") return { name, state, health: "not checked" };
  try {
    const port = component === "console" ? 3000 : 9377;
    const probe = component === "console" ? "/health/ready" : "/health";
    const address = run("docker", ["port", name, `${port}/tcp`], true).trim().split("\n")[0];
    if (!address) return { name, state, health: "port not published" };
    const url = `http://${address.replace(/^0\.0\.0\.0:/, "127.0.0.1:").replace(/^\[::\]:/, "[::1]:")}${probe}`;
    return { name, state, health: await health(url), url: new URL(url).origin };
  } catch { return { name, state, health: "unavailable" }; }
}

async function status(json: boolean, doctor = false): Promise<void> {
  progress("Checking OMA services");
  const installed = installedRelease();
  const host = installed && configuredHost(installed.version);
  let dockerError: string | undefined;
  let states = new Map<string, string>();
  try { states = containerStates(installed?.version); } catch (error) {
    dockerError = error instanceof Error ? error.message : String(error);
  }
  const docker = dockerError ? "unavailable" : "available";
  const gateway = gatewayState();
  const workspace = workspaceRunning();
  const stateOf = (name: Container) => dockerError ? "unknown" : states.get(containers[name]) ?? "not configured";
  const [consoleState, camofox, api, socket] = await Promise.all([
    containerHealth("console", stateOf("console")),
    containerHealth("camofox", stateOf("camofox")),
    gateway.pid && host ? gatewayHealth(host) : "not checked",
    workspace ? workspaceHealth() : "not checked",
  ]);
  const binaries = nativeFilesPresent();
  const ready = Boolean(host && binaries && !dockerError && api === "ready" && socket === "ready"
    && consoleState.health === "ready" && camofox.health === "ready");
  const services = [
    { name: "agent", running: Boolean(gateway.pid && workspace), healthy: api === "ready" && socket === "ready" },
    { name: "console", running: consoleState.state === "running", healthy: consoleState.health === "ready" },
    { name: "camofox", running: camofox.state === "running", healthy: camofox.health === "ready" },
  ] as const;
  const advice = classifyStack({ version: installed?.version ?? null, binaries, setup: Boolean(host), docker: !dockerError,
    containers: containersPresent(states), ready, stopped: services.filter((s) => !s.running).map((s) => s.name),
    unhealthy: services.filter((s) => s.running && !s.healthy).map((s) => s.name) });
  const result = {
    installation: root,
    version: installed?.version ?? null,

    components: installed?.pins ?? {},
    ready, phase: advice.phase, ...(doctor ? { recommendedCommands: advice.commands } : {}),
    docker: { state: docker, ...(dockerError ? { error: dockerError } : {}) },
    hermes: { ...gateway, health: api, home: agentHome },
    workspace: { state: workspace ? "running" : "stopped", health: socket },
    console: consoleState,
    camofox,
    omactl: { state: existsSync(omactl) ? "installed" : "not installed" },
  };
  if (doctor && !ready) process.exitCode = 1;
  if (json) { console.log(JSON.stringify(result, null, 2)); return; }
  console.log(`OMA ${result.version ?? "not installed"} — ${root} (${advice.phase})`);
  console.log(`Docker:          ${docker}${dockerError ? ` (${dockerError})` : ""}`);
  console.log(`Hermes gateway:  ${gateway.state}${gateway.pid ? ` (PID ${gateway.pid}, ${gateway.managed ? "managed" : "external"}; API ${api})` : ""}`);
  console.log(`Workspace:       ${result.workspace.state}${workspace ? ` (${socket})` : ""}`);
  console.log(`OMA Console:     ${consoleState.state}${consoleState.state === "running" ? ` (${consoleState.health}${consoleState.url ? `; ${consoleState.url}` : ""})` : ""}`);
  console.log(`Camofox:         ${camofox.state}${camofox.state === "running" ? ` (${camofox.health}${camofox.url ? `; ${camofox.url}` : ""})` : ""}`);
  console.log(`omactl:          ${result.omactl.state}`);
  if (doctor) {
    if (ready) console.log(`Doctor: services are ready. Open ${consoleState.url}. Model credentials are managed in the console.`);
    else if (advice.commands.length) console.log(`Doctor: run ${advice.commands.join(", then ")}.`);
  }
}

async function waitReady(label: string, command: string, probe: () => Promise<string>): Promise<void> {
  const deadline = Date.now() + 120_000;
  let state = await probe();
  if (state !== "ready") progress(`Waiting for ${label}`);
  while (state !== "ready" && Date.now() < deadline) {
    if (state === "exited" || state === "dead") break;
    await Bun.sleep(750);
    state = await probe();
  }
  if (state !== "ready") throw new Error(`${label} is not ready (${state}). Run ${command}.`);
}

async function startStack(host: string, targets: Container[], startAgent: boolean): Promise<void> {
  if (targets.includes("camofox")) changeContainers("start", ["camofox"]);
  if (startAgent) {
    progress("Starting Hermes gateway and private workspace");
    await startGateway();
    await startWorkspace();
  }
  if (targets.includes("console")) changeContainers("start", ["console"]);
  await Promise.all([
    ...targets.map((target) => waitReady(containers[target], `sudo oma logs ${target}`, async () => {
      const state = containerStates().get(containers[target]) ?? "exited";
      return state === "running" ? (await containerHealth(target, state)).health : state;
    })),
    ...(startAgent ? [
      waitReady("the Hermes API", "sudo oma logs agent", () => gatewayState().pid ? gatewayHealth(host) : Promise.resolve("exited")),
      waitReady("the private workspace", "sudo oma logs agent", () => workspaceRunning() ? workspaceHealth() : Promise.resolve("exited")),
    ] : []),
  ]);
  const consoleInfo = targets.includes("console") ? await containerHealth("console", "running") : undefined;
  progress(consoleInfo?.url ? `OMA Console is ready: ${consoleInfo.url}` : "Requested services are ready.");
}

async function updates(json: boolean): Promise<void> {
  progress("Checking for a newer OMA release");
  const installed = installedRelease();
  const current = installed?.version ?? null;
  const latest = await latestRelease();
  const upstream = latest ? await releaseManifest(latest) : null;
  const changes = components.map((name) => ({ name, installed: installed?.pins[name] ?? null, latest: upstream?.pins[name] ?? null }));
  const available = Boolean(latest && (!current || newerVersion(latest.version, current)));
  if (json) console.log(JSON.stringify({ installed: current, latest: latest?.version ?? null, available, components: changes }, null, 2));
  else {
    console.log(`OMA: installed ${current ?? "none"}; latest ${latest?.version ?? "not published"}${available ? " (upgrade available)" : ""}`);
    for (const change of changes) console.log(`${change.name}: ${change.installed ?? "not installed"} → ${change.latest ?? "not published"}`);
  }
}

async function upgrade(version?: string): Promise<void> {
  const current = installedRelease();
  if (!current) notInstalled();
  if (version && !newerVersion(version, current.version)) notNewer(version, current.version);
  progress(version ? `Looking up OMA ${version}` : "Checking for a newer OMA release");
  const release = version ? await releaseByVersion(version) : await latestRelease();
  if (!release || !newerVersion(release.version, current.version)) {
    console.log("No newer OMA release available."); return;
  }
  ensureDownloader();
  await withStackBundle(release, (bundle) => applyBundle(bundle, "upgrade"));
}

function jsonOutput(args: string[]): boolean {
  if (!args.length) return false;
  const format = args[0] === "--output" && args.length === 2 ? args[1]
    : args.length === 1 ? /^--output=(.+)$/.exec(args[0])?.[1] : undefined;
  if (format !== "text" && format !== "json") throw new Error("Use --output text or --output json.");
  return format === "json";
}

async function cliCommand(args: string[]): Promise<void> {
  const [command, version] = args;
  if (command === "status") {
    const json = jsonOutput(args.slice(1));
    const result = { version: cliVersion, executable: process.execPath, managedPath: cliPath };
    console.log(json ? JSON.stringify(result, null, 2) : `oma-cli ${result.version} — ${result.executable}`);
    return;
  }
  if (command === "versions") {
    const json = jsonOutput(args.slice(1));
    progress("Checking published CLI releases");
    const versions = await availableVersions(fetch, "cli");
    console.log(json ? JSON.stringify(versions, null, 2) : versions.join("\n") || "No installable CLI releases have been published.");
    return;
  }
  if (command === "updates") {
    const json = jsonOutput(args.slice(1));
    progress("Checking for a newer CLI release");
    const latest = await latestRelease(fetch, "cli");
    const result = { installed: cliVersion, latest: latest?.version ?? null, available: !!latest && newerVersion(latest.version, cliVersion) };
    console.log(json ? JSON.stringify(result, null, 2)
      : `oma-cli: installed ${result.installed}; latest ${result.latest ?? "not published"}${result.available ? " (upgrade available)" : ""}`);
    return;
  }
  if (command === "upgrade") {
    if (args.length > 2 || (version !== undefined && !/^\d+\.\d+\.\d+$/.test(version))) {
      throw new Error("Pass an optional CLI version in X.Y.Z format.");
    }
    if (version && !newerVersion(version, cliVersion)) throw new Error(`CLI ${version} is not newer than ${cliVersion}.`);
    const destination = requireManagedCli();
    progress(version ? `Looking up CLI ${version}` : "Checking for a newer CLI release");
    const release = version ? await releaseByVersion(version, fetch, "cli") : await latestRelease(fetch, "cli");
    if (!release || !newerVersion(release.version, cliVersion)) {
      console.log("No newer CLI release available."); return;
    }
    await replaceCli(release, destination);
    progress(`oma-cli ${release.version} installed`);
    return;
  }
  throw new Error("Run oma cli status, versions, updates, or upgrade.");
}

async function main(args: string[]): Promise<void> {
  const [command, target, flag] = args;
  if (!command || command === "--help" || command === "-h") { console.log(usage); return; }
  if (command === "--version" && args.length === 1) { console.log(cliVersion); return; }
  if (command === "cli") { await cliCommand(args.slice(1)); return; }
  if (command === "status" || command === "doctor") {
    const json = jsonOutput(args.slice(1));
    requireRoot(); await status(json, command === "doctor"); return;
  }
  if (command === "versions") {
    const json = jsonOutput(args.slice(1));
    progress("Checking published OMA releases");
    const versions = await availableVersions();
    if (json) console.log(JSON.stringify(versions, null, 2));
    else console.log(versions.length ? versions.join("\n") : "No installable OMA releases have been published.");
    return;
  }
  if (command === "updates") {
    await updates(jsonOutput(args.slice(1))); return;
  }
  if (command === "install" || command === "upgrade") {
    if (args.length > 2 || (target !== undefined && !/^\d+\.\d+\.\d+$/.test(target))) {
      throw new Error(`oma ${command} applies the entire release. Pass an optional release version in X.Y.Z format.`);
    }
    requireRoot();
    if (command === "install") await install(target);
    else await upgrade(target);
    return;
  }

  if (command === "setup" && args.length === 1) {
    requireRoot(); setup(); return;
  }
  if (command === "logs" && ["agent", "console", "camofox"].includes(target) && (!flag || flag === "--follow" || flag === "-f") && args.length <= 3) {
    requireRoot();
    if (target === "agent") gatewayLogs(Boolean(flag));
    else containerLogs(target as Container, Boolean(flag));
    return;
  }
  if ((command === "start" || command === "stop" || command === "restart") && args.length <= 2) {
    const component = target ?? "all";
    if (!["all", "agent", "console", "camofox"].includes(component)) throw new Error(`Unknown component: ${component}`);
    requireRoot();
    const targets: Container[] = component === "all" ? ["camofox", "console"] : component === "agent" ? [] : [component as Container];
    const manageAgent = component === "agent" || component === "all";
    const current = installedRelease();
    let host: string | null = null;
    if (command !== "stop") {
      if (!current) notInstalled();
      if (!nativeFilesPresent()) throw new Error(`Incomplete installation. Run sudo oma install ${current.version}.`);
      host = configuredHost(current.version);
      if (!host) throw new Error("Run sudo oma setup before starting OMA.");
      ensureDocker();
      const states = containerStates(current.version);
      if (!targets.every((target) => states.has(containers[target]))) throw new Error("Run sudo oma setup to prepare the missing containers.");
    }
    if (command !== "start") {
      changeContainers("stop", targets.toReversed());
      if (manageAgent) await stopGateway();
    }
    if (host) await startStack(host, targets, manageAgent);
    return;
  }
  throw new Error("Unknown command or arguments. Run oma --help.");
}

try { await main(process.argv.slice(2)); }
catch (error) { console.error(`oma: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
