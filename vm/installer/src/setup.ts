import { YAML } from "bun";
import Ajv from "ajv";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";
import schema from "../schemas/playbook.schema.json";
import { assertNoSymlinks, type Playbook } from "./playbook";

export interface SetupOptions { setup?: string; setupEnv?: string }
export const installerEnvKeys = ["HERMES_DIR"] as const;
type InstallerEnvKey = typeof installerEnvKeys[number];

export async function readInstallerEnv(path: string | undefined, keys: readonly InstallerEnvKey[]): Promise<Partial<Record<InstallerEnvKey, string>>> {
  if (!path) return {};
  await assertNoSymlinks(resolve(path));
  const lines = (await readFile(path, "utf8")).split(/\r?\n/);
  const values: Partial<Record<InstallerEnvKey, string>> = {};
  for (const key of keys) {
    const declarations = lines.filter(line => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(line));
    if (declarations.length === 0) continue;
    if (declarations.length !== 1) throw new Error(`--setup-env must not repeat ${key}`);
    let value: string | undefined;
    try { value = parseEnv(declarations[0])[key]; }
    catch { throw new Error(`Invalid ${key} in --setup-env`); }
    if (!value?.trim()) throw new Error(`${key} in --setup-env must not be empty`);
    values[key] = value;
  }
  return values;
}
export async function readHermesDirectory(path?: string): Promise<string | undefined> {
  const { HERMES_DIR } = await readInstallerEnv(path, ["HERMES_DIR"]);
  return path && HERMES_DIR ? resolve(dirname(resolve(path)), HERMES_DIR) : undefined;
}
export type Config = Record<string, any>;
const ajv = new Ajv({ allErrors: true, strict: false });
ajv.addSchema(schema);
const validate = ajv.compile({ $ref: `${schema.$id}#/definitions/agent` });
const mapping = (value: any): value is Config => value !== null && typeof value === "object" && !Array.isArray(value);

function checkKeys(value: any): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Unsafe key in setup YAML");
    checkKeys(child);
  }
}
export function mergeConfig(base: Config, override: Config): Config {
  const merged = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    merged[key] = mapping(value) && mapping(merged[key]) ? mergeConfig(merged[key], value) : structuredClone(value);
  }
  return merged;
}
export async function readSetup(path: string): Promise<Config> {
  path = resolve(path);
  await assertNoSymlinks(path);
  let value: any;
  try { value = YAML.parse(await readFile(path, "utf8")); }
  catch { throw new Error("Cannot parse --setup YAML (contents withheld)"); }
  if (!mapping(value)) throw new Error("--setup must contain a YAML mapping; use {} for no overrides");
  checkKeys(value);
  for (const key of ["id", "name", "description", "version", "orchestrator", "agents", "oma_skills", "jobs"]) {
    if (Object.hasOwn(value, key)) throw new Error(`--setup cannot override OMA metadata: ${key}`);
  }
  if (Object.hasOwn(value, "integrations")) {
    if (!mapping(value.integrations) || Object.keys(value.integrations).some(k => k !== "mcp") || !mapping(value.integrations.mcp)) {
      throw new Error("--setup integrations supports only an mcp server mapping");
    }
    if (Object.hasOwn(value, "mcp_servers")) throw new Error("--setup cannot declare both integrations.mcp and mcp_servers");
    value.mcp_servers = value.integrations.mcp;
    delete value.integrations;
  }
  if (Object.hasOwn(value, "tool_search")) {
    if (value.tools?.tool_search) throw new Error("--setup has conflicting tool_search definitions");
    value.tools = { ...value.tools, tool_search: value.tool_search };
    delete value.tool_search;
  }
  return value;
}
export function withSetup(playbook: Playbook, setup: Config): Playbook {
  return { ...playbook, agents: playbook.agents.map(agent => {
    const native = mergeConfig(agent.native, setup);
    const effective = { ...native, id: agent.id, description: agent.description, version: agent.version, oma_skills: agent.skills.map(s => s.id), jobs: agent.jobs };
    if (!validate(effective)) throw new Error(`${agent.id}: --setup produces invalid config types`);
    const disabled = native.skills?.disabled ?? [];
    const required = [...agent.skills.map(s => s.id), ...(native.skills?.auto_load ?? []), ...agent.jobs.flatMap(j => j.skills ?? [])];
    if (required.some(id => disabled.includes(id) || (Array.isArray(native.skills?.enabled) && !native.skills.enabled.includes(id)))) {
      throw new Error(`${agent.id}: --setup excludes required skills`);
    }
    const kb = native.kanban;
    if (kb?.orchestrator_profile !== undefined && kb.orchestrator_profile !== playbook.manifest.orchestrator) throw new Error(`${agent.id}: --setup has invalid orchestrator routing`);
    if (kb?.dispatch_profiles !== undefined && (!Array.isArray(kb.dispatch_profiles) || new Set(kb.dispatch_profiles).size !== kb.dispatch_profiles.length || kb.dispatch_profiles.some((id: string) => id === playbook.manifest.orchestrator || !playbook.manifest.agents.includes(id)))) {
      throw new Error(`${agent.id}: --setup has invalid dispatch routing`);
    }
    return { ...agent, native };
  }) };
}
