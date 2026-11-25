import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile, copyFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { type Agent, type Playbook, canonical, compareVersions, exists, hash, loadPlaybook, treeDigest, assertNoSymlinks } from "./playbook";
import { getRuntime, type Runtime } from "./runtime";
import { YAML } from "bun";
import { mergeConfig, readSetup, withSetup, type SetupOptions } from "./setup";

export interface InstalledAgent {
  id: string;
  version: string;
  description: string;
  digest: string;
  native: Record<string, any>;
  jobs: string[];
  skills: { id: string; digest: string }[];
  soulDigest: string;
  active: boolean;
}
export interface Installation {
  id: string;
  name: string;
  version: string;
  source: string;
  digest: string;
  orchestrator: string;
  installedAt: string;
  updatedAt: string;
  agents: InstalledAgent[];
}
interface Registry { schemaVersion: 1; playbooks: Installation[] }
interface Change { target: string; staged?: string; backup?: string; newProfile?: boolean }
const stateDir = (runtime: Runtime) => join(runtime.root, ".oma");
const registryPath = (runtime: Runtime) => join(stateDir(runtime), "installed.json");
const playbookIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function safeTarget(runtime: Runtime, target: string): Promise<void> {
  const rel = relative(runtime.root, target);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || resolve(runtime.root, rel) !== target) throw new Error(`Unsafe managed target: ${target}`);
  let cursor = runtime.root;
  for (const part of ["", ...rel.split(sep)]) {
    cursor = part ? join(cursor, part) : cursor;
    if (await exists(cursor) && (await lstat(cursor)).isSymbolicLink()) throw new Error(`Refusing symlink target: ${cursor}`);
  }
}
async function readRegistry(runtime: Runtime): Promise<Registry> {
  const path = registryPath(runtime);
  await safeTarget(runtime, path);
  if (!await exists(path)) return { schemaVersion: 1, playbooks: [] };
  const data = JSON.parse(await readFile(path, "utf8")) as Registry;
  if (data.schemaVersion !== 1 || !Array.isArray(data.playbooks)) throw new Error("Invalid OMA installation registry");
  const ids = new Set<string>();
  for (const pb of data.playbooks) {
    if (!playbookIdPattern.test(pb.id) || ids.has(pb.id) || !Array.isArray(pb.agents)) throw new Error("Invalid OMA registry identities");
    ids.add(pb.id);
    for (const agent of pb.agents) {
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(agent.id) || !agent.id.startsWith(`${pb.id}__`)) throw new Error("Invalid OMA registry agent identity");
      for (const skill of agent.skills) if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(skill.id)) throw new Error("Invalid OMA registry skill identity");
    }
  }
  return data;
}
export async function listInstalled(runtime?: Runtime): Promise<Installation[]> {
  return (await readRegistry(runtime ?? await getRuntime())).playbooks;
}

async function acquireLock(runtime: Runtime, operation: string, playbook: string): Promise<string> {
  const metadata = stateDir(runtime), lock = join(metadata, "operation.lock");
  await safeTarget(runtime, lock);
  await mkdir(metadata, { recursive: true, mode: 0o700 });
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (error: any) {
    if (error.code === "EEXIST") throw new Error(`Another OMA operation or interrupted transaction holds ${lock}; inspect it before retrying`);
    throw error;
  }
  try {
    await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, operation, playbook }), { mode: 0o600 });
  } catch (error) {
    await rm(lock, { recursive: true, force: true });
    throw error;
  }
  return lock;
}

export async function uninstallPlaybook(id: string, setupEnv?: string) {
  if (!playbookIdPattern.test(id)) throw new Error(`Invalid installed campaign ID: ${id}`);
  const runtime = await getRuntime(setupEnv);
  const metadata = stateDir(runtime), registryFile = registryPath(runtime);
  const lock = await acquireLock(runtime, "uninstall", id);
  let transaction: string | undefined, archive: string | undefined;
  let keepLock = false, committed = false;
  try {
    const registry = await readRegistry(runtime);
    const installed = registry.playbooks.find(p => p.id === id);
    if (!installed) throw new Error(`Campaign is not installed: ${id}`);

    const profileIds = [...new Set(installed.agents.map(a => a.id))];
    const candidates = profileIds.map(id => ({ target: join(runtime.profiles, id), relativePath: join("profiles", id) }));
    candidates.push({ target: join(metadata, "setups", id), relativePath: "setup" });
    const present: typeof candidates = [];
    for (const candidate of candidates) {
      await safeTarget(runtime, candidate.target);
      if (!await exists(candidate.target)) continue;
      if (!(await lstat(candidate.target)).isDirectory()) throw new Error(`Expected managed directory: ${candidate.target}`);
      present.push(candidate);
    }
    const archiveRoot = join(metadata, "archives");
    await safeTarget(runtime, archiveRoot);
    await safeTarget(runtime, join(runtime.root, "active_profile"));
    await runtime.call("quiescent", { paths: [runtime.root, ...candidates.slice(0, -1).map(c => c.target)], uninstalling: profileIds });

    await mkdir(archiveRoot, { recursive: true, mode: 0o700 });
    const archiveDir = archive = await mkdtemp(join(archiveRoot, `${id}-`));
    await mkdir(join(archiveDir, "profiles"), { mode: 0o700 });
    transaction = await mkdtemp(join(metadata, "transaction-"));
    const journal = join(transaction, "journal.json");
    const registryBackup = join(transaction, "installed.previous.json");
    const pendingRegistry = join(transaction, "installed.json");
    const next: Registry = { ...registry, playbooks: registry.playbooks.filter(p => p.id !== id) };
    const moves = present.map(({ target, relativePath }) => ({ target, backup: join(archiveDir, relativePath) }));
    await copyFile(registryFile, registryBackup);
    await writeFile(pendingRegistry, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
    await writeFile(journal, JSON.stringify({ operation: "uninstall", state: "publishing", archive, changes: [...moves, { target: registryFile, backup: registryBackup }] }, null, 2), { mode: 0o600 });

    const applied: typeof moves = [];
    let registryPublished = false;
    try {
      // Rename rather than copy/delete: preserve full profile state without following links inside it.
      for (const move of moves) {
        await rename(move.target, move.backup);
        applied.push(move);
      }
      await rename(pendingRegistry, registryFile);
      registryPublished = true;
      if (canonical(await readRegistry(runtime)) !== canonical(next)) throw new Error("Uninstall registry failed read-back");
      committed = true;
    } catch (error) {
      const failures: string[] = [];
      for (const { target, backup } of applied.reverse()) {
        try { await rename(backup, target); } catch { failures.push(target); }
      }
      if (registryPublished) {
        try { await rename(registryBackup, registryFile); } catch { failures.push(registryFile); }
      }
      if (failures.length) {
        keepLock = true;
        throw new Error(`Uninstall failed and rollback is incomplete for ${failures.join(", ")}. Recovery journal: ${journal}`, { cause: error });
      }
      throw error;
    }
    return { id, version: installed.version, profiles: profileIds.filter(id => present.some(c => c.relativePath === join("profiles", id))), archive: archiveDir };
  } finally {
    if (!keepLock) {
      try {
        if (!committed && archive) await rm(archive, { recursive: true, force: true });
        if (transaction) await rm(transaction, { recursive: true, force: true });
      } finally { await rm(lock, { recursive: true, force: true }); }
    }
  }
}

async function scratchDirectory(): Promise<string> {
  // The terminal's configured scratch root is inherited; do not use a fixed /tmp path.
  const root = process.env.TMPDIR ?? tmpdir();
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, "oma-validate-"));
}
export async function validatePlaybook(spec: string, skillsRoot?: string, suppliedRuntime?: Runtime): Promise<Playbook> {
  const playbook = await loadPlaybook(spec, skillsRoot);
  const runtime = suppliedRuntime ?? await getRuntime(), scratch = await scratchDirectory();
  try {
    await runtime.call("validate", { agents: playbook.agents, scratch }, scratch);
  } finally { await rm(scratch, { recursive: true, force: true }); }
  return playbook;
}
async function atomicCopy(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const staging = `${target}.oma-${crypto.randomUUID()}`;
  await cp(source, staging, { recursive: true, errorOnExist: true, force: false });
  await rename(staging, target);
}
async function verifyArtifacts(runtime: Runtime, installed: InstalledAgent): Promise<void> {
  const home = join(runtime.profiles, installed.id);
  await safeTarget(runtime, home);
  const soul = join(home, "SOUL.md");
  await safeTarget(runtime, soul);
  if (!await exists(soul) || hash(await readFile(soul)) !== installed.soulDigest) throw new Error(`${installed.id}: installed SOUL.md changed; reconcile before upgrading`);
  for (const skill of installed.skills) {
    const path = join(home, "skills", skill.id);
    await safeTarget(runtime, path);
    if (!await exists(path) || await treeDigest(path) !== skill.digest) throw new Error(`${installed.id}: managed skill ${skill.id} changed; reconcile before upgrading`);
  }
}
function record(agent: Agent): InstalledAgent {
  return { id: agent.id, version: agent.version, description: agent.description, digest: agent.digest,
    native: agent.native, jobs: agent.jobs.map(j => j.id), skills: agent.skills.map(({ id, digest }) => ({ id, digest })),
    soulDigest: hash(agent.soul), active: true };
}

export async function deploy(mode: "install" | "upgrade", spec: string, skillsRoot?: string, options: SetupOptions = {}): Promise<{ installation: Installation; unchanged: boolean; warnings: string[] }> {
  if (!options.setup) throw new Error(`${mode} requires --setup <yaml-file>`);
  if (!options.setupEnv) throw new Error(`${mode} requires --setup-env <env-file>`);
  const suppliedSetup = options.setup ? await readSetup(options.setup) : {};
  const suppliedEnv = options.setupEnv ? resolve(options.setupEnv) : undefined;
  if (suppliedEnv) await assertNoSymlinks(suppliedEnv);
  const runtime = await getRuntime(suppliedEnv);
  const playbook = await validatePlaybook(spec, skillsRoot, runtime);
  const metadata = stateDir(runtime);
  const lock = await acquireLock(runtime, mode, playbook.manifest.id);
  let transaction: string | undefined;
  const changes: Change[] = [];
  let publishing = false;
  let keepLock = false;
  try {
    const registry = await readRegistry(runtime);
    const previous = registry.playbooks.find(p => p.id === playbook.manifest.id);
    const sharedHome = join(metadata, "setups", playbook.manifest.id);
    const savedSetupPath = join(sharedHome, "setup.yaml"), savedEnvPath = join(sharedHome, ".env");
    await safeTarget(runtime, savedSetupPath);
    await safeTarget(runtime, savedEnvPath);
    const previousSetup = await exists(savedSetupPath) ? await readSetup(savedSetupPath) : {};
    const setup = mergeConfig(previousSetup, suppliedSetup);
    const effective = withSetup(playbook, setup);
    const validationScratch = await scratchDirectory();
    try {
      await runtime.call("validate", { agents: effective.agents, scratch: validationScratch }, validationScratch);
      if (suppliedEnv) await runtime.call("env", { source: suppliedEnv, path: savedEnvPath, checkOnly: true }, validationScratch);
    } finally { await rm(validationScratch, { recursive: true, force: true }); }
    if (mode === "upgrade" && !previous) throw new Error(`${playbook.manifest.id} is not installed; use install`);
    if (previous && mode === "install" && previous.version !== playbook.manifest.version) throw new Error(`${previous.id} ${previous.version} is installed; use upgrade`);
    if (previous) {
      const order = compareVersions(playbook.manifest.version, previous.version);
      if (order < 0) throw new Error(`Downgrades are not supported (${previous.version} -> ${playbook.manifest.version})`);
      if (order === 0 && previous.digest !== playbook.digest) throw new Error("Same campaign version has different content; bump its version");
      for (const old of previous.agents.filter(a => a.active)) await verifyArtifacts(runtime, old);
      let envMatches = true;
      if (suppliedEnv) {
        for (const path of [savedEnvPath, ...effective.agents.map(a => join(runtime.profiles, a.id, ".env"))]) {
          await safeTarget(runtime, path);
          const result = await runtime.call("env", { source: suppliedEnv, path, checkOnly: true }, runtime.root);
          envMatches &&= result.matches;
        }
      }
      if (previous.digest === playbook.digest && canonical(setup) === canonical(previousSetup) && envMatches) {
        let configMatches = true;
        for (const agent of effective.agents) {
          const result = await runtime.call("read", { path: join(runtime.profiles, agent.id, "config.yaml"), expected: agent.native, checkOnly: Boolean(options.setup) });
          configMatches &&= result.verified;
        }
        if (configMatches) return { installation: previous, unchanged: true, warnings: playbook.warnings };
      }
    }
    for (const agent of playbook.agents) {
      const old = previous?.agents.find(a => a.id === agent.id);
      const target = join(runtime.profiles, agent.id);
      await safeTarget(runtime, target);
      if (!old && await exists(target)) throw new Error(`Profile collision: ${agent.id} is not owned by this installation`);
      if (old && !await exists(target)) throw new Error(`Managed profile ${agent.id} is missing`);
      if (old && !old.active) await verifyArtifacts(runtime, old);
      if (old && compareVersions(agent.version, old.version) < 0) throw new Error(`${agent.id}: agent downgrade is not supported`);
      if (old && compareVersions(agent.version, old.version) === 0 && old.digest !== agent.digest) throw new Error(`${agent.id}: changed content requires an agent version bump`);
      for (const skill of agent.skills) {
        const destination = join(target, "skills", skill.id);
        await safeTarget(runtime, destination);
        if (await exists(destination) && !old?.skills.some(s => s.id === skill.id)) throw new Error(`${agent.id}: unmanaged skill collision: ${skill.id}`);
      }
    }
    // Changes span several native stores; require a maintenance window instead of
    // racing a scheduler/dispatcher or silently restarting somebody's gateway.
    await runtime.call("quiescent", { paths: [runtime.root, ...new Set([...playbook.agents.map(a => join(runtime.profiles, a.id)), ...(previous?.agents.map(a => join(runtime.profiles, a.id)) ?? [])])] });
    transaction = await mkdtemp(join(metadata, "transaction-"));
    const stageRoot = join(transaction, "staged"), backups = join(transaction, "backups");
    await mkdir(stageRoot, { mode: 0o700 });
    await mkdir(backups, { mode: 0o700 });
    const addChange = async (target: string, staged?: string, newProfile = false) => {
      await safeTarget(runtime, target);
      const change: Change = { target, staged, newProfile };
      if (await exists(target)) {
        await assertNoSymlinks(target);
        change.backup = join(backups, String(changes.length));
        await cp(target, change.backup, { recursive: true });
      }
      changes.push(change);
    };
    const stagedShared = join(stageRoot, "shared-setup");
    await mkdir(stagedShared, { mode: 0o700 });
    const stagedSetup = join(stagedShared, "setup.yaml"), stagedEnv = join(stagedShared, ".env");
    await writeFile(stagedSetup, YAML.stringify(setup), { mode: 0o600 });
    await addChange(savedSetupPath, stagedSetup);
    if (await exists(savedEnvPath)) await copyFile(savedEnvPath, stagedEnv);
    if (suppliedEnv) {
      if (!await exists(stagedEnv)) await writeFile(stagedEnv, "", { mode: 0o600 });
      await runtime.call("env", { source: suppliedEnv, path: stagedEnv }, stagedShared);
      await addChange(savedEnvPath, stagedEnv);
    }
    for (const agent of playbook.agents) {
      const old = previous?.agents.find(a => a.id === agent.id), target = join(runtime.profiles, agent.id);
      const stage = join(stageRoot, "profiles", agent.id);
      if (!old) {
        await runtime.call("create", { id: agent.id, description: agent.description }, stageRoot);
      } else {
        await mkdir(stage, { recursive: true });
        for (const file of ["config.yaml", "profile.yaml"]) {
          const source = join(target, file);
          await safeTarget(runtime, source);
          if (await exists(source)) await copyFile(source, join(stage, file));
        }
      }
      await runtime.call("config", { path: join(stage, "config.yaml"), native: mergeConfig(agent.native, previousSetup), old: old ? mergeConfig(old.native, previousSetup) : {}, setup: suppliedSetup }, stage);
      const envSource = old ? suppliedEnv : await exists(stagedEnv) ? stagedEnv : undefined;
      if (envSource) {
        const existingEnv = join(target, ".env"), stageEnv = join(stage, ".env");
        await safeTarget(runtime, existingEnv);
        if (old && await exists(existingEnv)) await copyFile(existingEnv, stageEnv);
        if (!await exists(stageEnv)) await writeFile(stageEnv, "", { mode: 0o600 });
        await runtime.call("env", { source: envSource, path: stageEnv }, stage);
        if (old) await addChange(existingEnv, stageEnv);
      }
      await writeFile(join(stage, "SOUL.md"), agent.soul, { mode: 0o600 });
      await runtime.call("meta", { path: stage, description: agent.description }, stage);
      for (const skill of agent.skills) {
        const destination = join(stage, "skills", skill.id);
        if (await exists(destination)) await rm(destination, { recursive: true });
        await mkdir(dirname(destination), { recursive: true });
        await cp(skill.path, destination, { recursive: true });
        if (await treeDigest(destination) !== skill.digest) throw new Error(`Skill source changed during installation: ${skill.id}`);
      }
      if (!old) await addChange(target, stage, true);
      else {
        for (const file of ["config.yaml", "SOUL.md", "profile.yaml"]) await addChange(join(target, file), join(stage, file));
        for (const skill of agent.skills) await addChange(join(target, "skills", skill.id), join(stage, "skills", skill.id));
        for (const removed of old.skills.filter(s => !agent.skills.some(n => n.id === s.id))) await addChange(join(target, "skills", removed.id));
      }
      // Cron uses the live, locked native importer after publication. Snapshot only
      // its store, not sessions, credentials, outputs or unrelated profile state.
      if (old) await addChange(join(target, "cron", "jobs.json"));
    }
    const removed = previous?.agents.filter(a => !playbook.agents.some(n => n.id === a.id)) ?? [];
    for (const agent of removed) if (agent.active) await addChange(join(runtime.profiles, agent.id, "cron", "jobs.json"));
    await addChange(registryPath(runtime));
    const journal = join(transaction, "journal.json");
    await writeFile(journal, JSON.stringify({ state: "prepared", changes }, null, 2), { mode: 0o600 });
    publishing = true;
    await writeFile(journal, JSON.stringify({ state: "publishing", changes }, null, 2));
    for (const change of changes) {
      if (!change.staged) {
        // Cron and registry are reconciled via their dedicated writers below.
        if (change.target.endsWith("/jobs.json") || change.target === registryPath(runtime)) continue;
        await rm(change.target, { recursive: true, force: true });
      } else if (change.target.endsWith("/config.yaml") && !change.newProfile) {
        await runtime.call("replace", { source: change.staged, target: change.target }, dirname(change.target));
      } else {
        if (await exists(change.target)) await rm(change.target, { recursive: true });
        await atomicCopy(change.staged, change.target);
      }
    }
    for (const agent of effective.agents) {
      const old = previous?.agents.find(a => a.id === agent.id), home = join(runtime.profiles, agent.id);
      await runtime.call("jobs", { path: home, jobs: agent.jobs, oldIds: old?.jobs ?? [], scratch: transaction }, home);
      await runtime.call("read", { path: join(home, "config.yaml"), expected: agent.native }, home);
      if (suppliedEnv || (!old && await exists(savedEnvPath))) {
        const result = await runtime.call("env", { source: suppliedEnv ?? savedEnvPath, path: join(home, ".env"), checkOnly: true }, home);
        if (!result.matches) throw new Error(`${agent.id}: setup env failed installed read-back`);
      }
      await verifyArtifacts(runtime, record(agent));
    }
    for (const agent of removed.filter(a => a.active)) {
      const home = join(runtime.profiles, agent.id);
      await runtime.call("jobs", { path: home, jobs: [], oldIds: agent.jobs, scratch: transaction }, home);
    }
    const now = new Date().toISOString();
    const installation: Installation = { id: playbook.manifest.id, name: playbook.manifest.name,
      version: playbook.manifest.version, source: playbook.path, digest: playbook.digest,
      orchestrator: playbook.manifest.orchestrator, installedAt: previous?.installedAt ?? now, updatedAt: now,
      agents: [...playbook.agents.map(record), ...removed.map(a => ({ ...a, active: false }))] };
    registry.playbooks = [...registry.playbooks.filter(p => p.id !== installation.id), installation];
    const pendingRegistry = join(transaction, "installed.json");
    await writeFile(pendingRegistry, JSON.stringify(registry, null, 2) + "\n", { mode: 0o600 });
    await rename(pendingRegistry, registryPath(runtime));
    const readBack = (await readRegistry(runtime)).playbooks.find(p => p.id === installation.id);
    if (canonical(readBack) !== canonical(installation)) throw new Error("Installation registry failed read-back");
    await writeFile(journal, JSON.stringify({ state: "committed", changes }, null, 2));
    publishing = false;
    await rm(transaction, { recursive: true });
    transaction = undefined;
    return { installation, unchanged: false, warnings: [...playbook.warnings,
      ...removed.filter(a => a.active).map(a => `${a.id}: removed from roster; profile retained and owned jobs paused`)] };
  } catch (error) {
    if (publishing) {
      const failures: string[] = [];
      for (const change of [...changes].reverse()) {
        try {
          if (change.backup) {
            if (change.target.endsWith("/config.yaml")) await runtime.call("replace", { source: change.backup, target: change.target }, dirname(change.target));
            else {
              await rm(change.target, { recursive: true, force: true });
              await atomicCopy(change.backup, change.target);
            }
          } else await rm(change.target, { recursive: true, force: true });
        } catch { failures.push(change.target); }
      }
      if (failures.length) {
        keepLock = true;
        throw new Error(`Installation failed and rollback is incomplete for ${failures.join(", ")}. Recovery journal: ${transaction}/journal.json`, { cause: error });
      }
    }
    if (transaction) await rm(transaction, { recursive: true, force: true });
    throw error;
  } finally { if (!keepLock) await rm(lock, { recursive: true, force: true }); }
}
