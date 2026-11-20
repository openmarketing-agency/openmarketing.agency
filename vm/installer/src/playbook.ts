import Ajv from "ajv";
import { YAML } from "bun";
import { createHash } from "node:crypto";
import { lstat, readdir, realpath, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import schema from "../schemas/playbook.schema.json";

export interface Job {
  id: string;
  name?: string;
  schedule: string;
  prompt: string;
  timezone?: string | null;
  repeat?: number | null;
  skills?: string[];
}
export interface Manifest {
  id: string;
  name: string;
  version: string;
  description: string;
  orchestrator: string;
  agents: string[];
}
export interface SkillSource { id: string; path: string; digest: string }
export interface Agent {
  id: string;
  description: string;
  version: string;
  native: Record<string, any>;
  jobs: Job[];
  soul: string;
  skills: SkillSource[];
  digest: string;
}
export interface Playbook {
  path: string;
  manifest: Manifest;
  agents: Agent[];
  digest: string;
  warnings: string[];
}
const ajv = new Ajv({ allErrors: true, strict: false });
ajv.addSchema(schema);
const manifestValidator = ajv.getSchema(schema.$id)!;
const agentValidator = ajv.compile<Record<string, any>>({ $ref: `${schema.$id}#/definitions/agent` });
export const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

export function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function safeKeys(value: any): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error(`Forbidden config key: ${key}`);
    safeKeys(child);
  }
}
async function yaml(path: string): Promise<any> {
  const text = await readFile(path, "utf8");
  const value = YAML.parse(text);
  safeKeys(value);
  return value;
}
export async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error: any) { if (error.code === "ENOENT") return false; throw error; }
}
export async function assertNoSymlinks(path: string): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) throw new Error(`Symlinks are not supported in managed paths: ${path}`);
  if (stat.isDirectory()) {
    for (const entry of await readdir(path)) await assertNoSymlinks(join(path, entry));
  } else if (!stat.isFile()) throw new Error(`Not a regular file: ${path}`);
}
export async function treeDigest(path: string): Promise<string> {
  await assertNoSymlinks(path);
  const stat = await lstat(path);
  if (stat.isFile()) return hash(await readFile(path));
  const entries = (await readdir(path)).filter(name => name !== ".DS_Store").sort();
  return hash(canonical(await Promise.all(entries.map(async name => [name, await treeDigest(join(path, name))]))));
}
async function discoverSkills(root: string, result: Map<string, string[]>): Promise<void> {
  if (!await exists(root)) return;
  await assertNoSymlinks(root);
  if (await exists(join(root, "SKILL.md"))) {
    const text = await readFile(join(root, "SKILL.md"), "utf8");
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
    if (!frontmatter) throw new Error(`Missing skill frontmatter: ${root}`);
    const metadata = YAML.parse(frontmatter[1]) as Record<string, any>;
    if (typeof metadata?.name !== "string" || metadata.name !== basename(root)) {
      throw new Error(`Skill name must match directory: ${root}`);
    }
    result.set(metadata.name, [...(result.get(metadata.name) ?? []), root]);
    return;
  }
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) await discoverSkills(join(root, entry.name), result);
  }
}
export function parseSpec(spec: string): { path: string; version?: string } {
  if (!spec) throw new Error("Provide a playbook directory[:version]");
  const separator = spec.lastIndexOf(":");
  if (separator === -1) return { path: resolve(spec) };
  const path = spec.slice(0, separator), version = spec.slice(separator + 1);
  const validate = ajv.compile({ $ref: `${schema.$id}#/definitions/version` });
  if (!path || !validate(version)) throw new Error(`Invalid playbook specification: ${spec}; expected path:SemVer`);
  return { path: resolve(path), version };
}
export function compareVersions(a: string, b: string): number {
  const parts = (s: string) => s.split("+")[0].split("-");
  const [aMain, ...aPre] = parts(a), [bMain, ...bPre] = parts(b);
  const cmp = (x: bigint, y: bigint) => x < y ? -1 : x > y ? 1 : 0;
  for (let i = 0; i < 3; i++) {
    const order = cmp(BigInt(aMain.split(".")[i]), BigInt(bMain.split(".")[i]));
    if (order) return order;
  }
  const x = aPre.join("-"), y = bPre.join("-");
  if (!x || !y) return x === y ? 0 : x ? -1 : 1;
  const xs = x.split("."), ys = y.split(".");
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    if (xs[i] === ys[i]) continue;
    if (xs[i] === undefined || ys[i] === undefined) return xs[i] === undefined ? -1 : 1;
    const xn = /^\d+$/.test(xs[i]), yn = /^\d+$/.test(ys[i]);
    return xn && yn ? cmp(BigInt(xs[i]), BigInt(ys[i])) : xn !== yn ? (xn ? -1 : 1) : xs[i] < ys[i] ? -1 : 1;
  }
  return 0;
}
export async function loadPlaybook(spec: string, skillsRoot?: string): Promise<Playbook> {
  const parsed = parseSpec(spec);
  await assertNoSymlinks(parsed.path);
  const path = await realpath(parsed.path);
  const manifest = await yaml(join(path, "config.yaml")) as Manifest;
  if (!manifestValidator(manifest)) throw new Error(`Playbook schema: ${ajv.errorsText(manifestValidator.errors)}`);
  if (parsed.version !== undefined && parsed.version !== manifest.version) {
    throw new Error(`Requested ${parsed.version}, but source declares ${manifest.version}. Select the correct source checkout.`);
  }
  if (manifest.orchestrator !== `${manifest.id}__orchestrator` || !manifest.agents.includes(manifest.orchestrator)) {
    throw new Error("orchestrator must be <playbook-id>__orchestrator and appear in agents");
  }
  const dirs = (await readdir(join(path, "agents"), { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort();
  if (canonical(dirs) !== canonical([...manifest.agents].sort())) throw new Error("Manifest roster must match agent directories exactly");
  const catalog = new Map<string, string[]>();
  await discoverSkills(join(path, "skills"), catalog);
  const sibling = join(dirname(dirname(path)), "skills");
  await discoverSkills(skillsRoot ? resolve(skillsRoot) : await exists(sibling) ? sibling : join(dirname(sibling), "oma-skills"), catalog);
  const agents: Agent[] = [], warnings: string[] = [];
  for (const id of manifest.agents) {
    if (!id.startsWith(`${manifest.id}__`)) throw new Error(`Agent ${id} does not belong to ${manifest.id}`);
    const directory = join(path, "agents", id), source = await yaml(join(directory, "config.yaml"));
    if (!agentValidator(source)) throw new Error(`${id} schema: ${ajv.errorsText(agentValidator.errors)}`);
    if (source.id !== id) throw new Error(`Agent directory/ID mismatch: ${id}`);
    const { description, version, oma_skills, jobs = [], id: _id, ...native } = source;
    const soul = await readFile(join(directory, "SOUL.md"), "utf8");
    if (!soul.trim()) throw new Error(`${id}: SOUL.md is empty`);
    if (native.tool_search) {
      if (native.tools?.tool_search) throw new Error(`${id}: conflicting tool_search and tools.tool_search`);
      native.tools = { ...native.tools, tool_search: native.tool_search };
      delete native.tool_search;
      warnings.push(`${id}: translated legacy tool_search to tools.tool_search`);
    }
    const disabled: string[] = native.skills?.disabled ?? [];
    // Hermes preserves its essential skills even when a profile lists them as disabled.
    if (new Set(jobs.map((job: Job) => job.id)).size !== jobs.length) throw new Error(`${id}: duplicate job IDs`);
    for (const required of [...oma_skills, ...(native.skills?.auto_load ?? []), ...jobs.flatMap((j: Job) => j.skills ?? [])]) {
      if (disabled.includes(required)) throw new Error(`${id}: required skill ${required} is disabled`);
      if (Array.isArray(native.skills?.enabled) && !native.skills.enabled.includes(required)) {
        throw new Error(`${id}: required skill ${required} is outside skills.enabled`);
      }
    }
    const skills: SkillSource[] = [];
    for (const skill of oma_skills) {
      const paths = catalog.get(skill) ?? [];
      if (paths.length !== 1) throw new Error(`${id}: skill ${skill} resolves to ${paths.length} sources (expected one)`);
      skills.push({ id: skill, path: paths[0], digest: await treeDigest(paths[0]) });
    }
    const kb = native.kanban;
    if (kb?.orchestrator_profile !== undefined && kb.orchestrator_profile !== manifest.orchestrator) throw new Error(`${id}: invalid kanban.orchestrator_profile`);
    if (kb?.dispatch_profiles !== undefined) {
      if (!Array.isArray(kb.dispatch_profiles) || new Set(kb.dispatch_profiles).size !== kb.dispatch_profiles.length ||
          kb.dispatch_profiles.some((p: string) => !manifest.agents.includes(p) || p === manifest.orchestrator)) {
        throw new Error(`${id}: invalid kanban.dispatch_profiles`);
      }
    }
    const digest = hash(canonical({ id, description, version, native, jobs, soul, skills: skills.map(({ id, digest }) => ({ id, digest })) }));
    agents.push({ id, description, version, native, jobs, soul, skills, digest });
  }
  return { path, manifest, agents, warnings, digest: hash(canonical({ manifest, agents: agents.map(a => a.digest) })) };
}
