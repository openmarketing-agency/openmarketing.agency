#!/usr/bin/env bun
import { deploy, listInstalled, uninstallPlaybook, validatePlaybook, type Installation } from "./lifecycle";
import { getRuntime } from "./runtime";
import { withPlaybookSources } from "./sources";

function publicInstallation(pb: Installation) {
  const { agents, ...metadata } = pb;
  return { ...metadata, agents: agents.map(({ id, version, description, active }) => ({ id, version, description, active })) };
}

const help = `oma-scripts — manage OMA campaigns in an existing Hermes installation

Usage:
  oma-scripts validate <campaign-id|directory>[:version] [--setup-env <env-file>] [--skills-dir <directory>] [--json]
  oma-scripts install  <campaign-id|directory>[:version] --setup <yaml-file> --setup-env <env-file> [--skills-dir <directory>] [--json]
  oma-scripts upgrade  <campaign-id|directory>[:version] --setup <yaml-file> --setup-env <env-file> [--skills-dir <directory>] [--json]
  oma-scripts update   Alias for upgrade
  oma-scripts uninstall <installed-campaign-id> [--setup-env <env-file>] [--json]
  oma-scripts list [--setup-env <env-file>] [--json]
  oma-scripts agents <installed-campaign-id> [--setup-env <env-file>] [--json]

Environment:
  HERMES_DIR          Set in --setup-env: the Hermes home directory (.hermes)
  HERMES_HOME         Optional: target Hermes data home (resolved by Hermes)
  HERMES_PYTHON       Optional: installed Hermes managed Python interpreter

Bare IDs resolve to campaigns/<id> in this checkout; prefix local directories with
./ or use an absolute path. Shared skills resolve from the checkout's sibling
skills/ directory; --skills-dir overrides that directory.
Versions assert the source manifest version, not the Git branch or tag.
New jobs are paused. No gateway, mission, inference or integration is started.
`;

export async function main(args = Bun.argv.slice(2)): Promise<void> {
  if (args.length === 0 || args.includes("--help") || args[0] === "help") { console.log(help); return; }
  const command = args[0] === "update" ? "upgrade" : args[0], positional: string[] = [];
  let json = false, skillsRoot: string | undefined, setup: string | undefined, setupEnv: string | undefined;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") json = true;
    else if (["--skills-dir", "--setup", "--setup-env"].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a path`);
      if (arg === "--skills-dir") skillsRoot = value;
      else if (arg === "--setup") setup = value;
      else setupEnv = value;
    } else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    else positional.push(arg);
  }
  const commands = ["validate", "install", "upgrade", "uninstall", "list", "agents"];
  if (!commands.includes(command)) throw new Error(`Unknown command: ${command}\n${help}`);
  const required = command === "list" ? 0 : 1;
  if (positional.length !== required) throw new Error(`${command} requires ${required} argument(s)\n${help}`);
  if (skillsRoot && ["list", "agents", "uninstall"].includes(command)) throw new Error(`--skills-dir is not valid for ${command}`);
  if (setup && !["install", "upgrade"].includes(command)) throw new Error(`--setup is not valid for ${command}`);
  if (["install", "upgrade"].includes(command) && !setup) throw new Error(`${command} requires --setup <yaml-file>`);
  if (["install", "upgrade"].includes(command) && !setupEnv) throw new Error(`${command} requires --setup-env <env-file>`);
  if (command === "validate") {
    const runtime = await getRuntime(setupEnv);
    const pb = await withPlaybookSources(positional[0], skillsRoot,
      (spec, skills) => validatePlaybook(spec, skills, runtime));
    const result = { valid: true, id: pb.manifest.id, version: pb.manifest.version, agents: pb.agents.map(({ id, version }) => ({ id, version })), warnings: pb.warnings };
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Valid: ${result.id} ${result.version} (${result.agents.length} agents)`);
      for (const warning of result.warnings) console.error(`Warning: ${warning}`);
    }
  } else if (command === "install" || command === "upgrade") {
    const result = await withPlaybookSources(positional[0], skillsRoot,
      (spec, skills) => deploy(command, spec, skills, { setup, setupEnv }));
    if (json) console.log(JSON.stringify({ ...result, installation: publicInstallation(result.installation) }, null, 2));
    else {
      console.log(`${result.unchanged ? "Already installed" : command === "install" ? "Installed" : "Upgraded"}: ${result.installation.id} ${result.installation.version}`);
      for (const agent of result.installation.agents) console.log(`  ${agent.id}\t${agent.version}\t${agent.active ? "active" : "retained"}`);
      for (const warning of result.warnings) console.error(`Warning: ${warning}`);
      console.log("New cron jobs are paused; review/resume them through Hermes. Gateway and mission were not started.");
    }
  } else if (command === "uninstall") {
    const result = await uninstallPlaybook(positional[0], setupEnv);
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Uninstalled: ${result.id} ${result.version}`);
      console.log(`Archived ${result.profiles.length} profile(s) and any saved setup at ${result.archive}`);
    }
  } else {
    const installations = await listInstalled(await getRuntime(setupEnv));
    if (command === "list") {
      if (json) console.log(JSON.stringify(installations.map(publicInstallation), null, 2));
      else if (!installations.length) console.log("No OMA campaigns installed.");
      else {
        console.log("CAMPAIGN\tVERSION\tAGENTS");
        for (const pb of installations) console.log(`${pb.id}\t${pb.version}\t${pb.agents.filter(a => a.active).length}`);
      }
    } else {
      const pb = installations.find(p => p.id === positional[0]);
      if (!pb) throw new Error(`Campaign is not installed: ${positional[0]}`);
      const agents = pb.agents.map(({ id, version, description, active }) => ({ id, version, description, active }));
      if (json) console.log(JSON.stringify({ playbook: pb.id, version: pb.version, agents }, null, 2));
      else {
        console.log(`Agents: ${pb.id} ${pb.version}\nAGENT\tVERSION\tSTATUS`);
        for (const agent of agents) console.log(`${agent.id}\t${agent.version}\t${agent.active ? "active" : "retained"}`);
      }
    }
  }
}
export async function run(args?: string[]): Promise<void> {
  try { await main(args); }
  catch (error) { console.error(`Error: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
}
if (import.meta.main) await run();
