import { exists } from "./playbook";
import { realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { installerEnvKeys, readHermesDirectory } from "./setup";

// Only the native Hermes API adapter runs in Python. All CLI, schema, version,
// source-resolution and lifecycle logic is TypeScript. Never duplicate Hermes cron parsing.
const bridge = String.raw`
import contextlib, io, json, os, sys, tempfile
from pathlib import Path
sys.path.insert(0, sys.argv[1])
result = None
with contextlib.redirect_stdout(io.StringIO()):
    # A launcher-managed runtime prepares the data root and replaces this process (os.execv) on a
    # home's first use, so bootstrap must run before stdin is read: anything read earlier is gone
    # after the relaunch, while the environment and the untouched pipe carry over.
    if os.environ.get('OMA_BRIDGE_BOOTSTRAP'):
        import hermes_bootstrap
    request = json.load(sys.stdin)
    mode = request['mode']
    from hermes_constants import get_default_hermes_root
    from hermes_cli.config import (atomic_config_replace, require_readable_config_before_write,
        validate_config_structure, DEFAULT_CONFIG, _KNOWN_ROOT_KEYS)
    from hermes_cli.profiles import create_profile, get_profile_dir, write_profile_meta
    from cron.jobs import create_job, use_cron_store, load_jobs, save_jobs, pause_job
    from cron.job_definition import import_job_definitions
    def native_config(config):
        from copy import deepcopy
        from hermes_cli.tools_config import CONFIGURABLE_TOOLSETS, PLATFORMS, _get_platform_tools, _get_plugin_toolset_keys
        from tools.tool_search import ToolSearchConfig
        from toolsets import TOOLSETS

        config = deepcopy(config)
        agent = config.get('agent') or {}
        if 'enabled_toolsets' in agent and 'enabled_toolsets' not in DEFAULT_CONFIG.get('agent', {}):
            allowed = agent.pop('enabled_toolsets')
            servers = (config.get('mcp_servers') or {}).keys()
            selected_servers = {name for name in allowed if name in servers}
            for name in allowed:
                if name not in TOOLSETS and not name.startswith('mcp_') and name not in selected_servers:
                    raise ValueError('Unknown toolset: ' + name)
            selected = allowed + (['no_mcp'] if allowed and not selected_servers else [])
            # The API uses api_server, the dispatcher uses cli, and recurring jobs use cron.
            platforms = sorted(set(PLATFORMS) | {'api_server', 'cli', 'cron'})
            explicit = config.setdefault('platform_toolsets', {})
            builtin = config.setdefault('known_builtin_toolsets', {})
            plugins = config.setdefault('known_plugin_toolsets', {})
            builtin_names = sorted(key for key, _, _ in CONFIGURABLE_TOOLSETS)
            plugin_names = sorted(_get_plugin_toolset_keys())
            implied = set()
            for platform in platforms:
                if platform in explicit and explicit[platform] != selected:
                    raise ValueError('Conflicting toolset allowlist for ' + platform)
                explicit[platform] = selected
                builtin[platform] = builtin_names
                plugins[platform] = plugin_names
                implied.update(_get_platform_tools(config, platform) - set(selected))
            if implied:
                agent['disabled_toolsets'] = sorted(set(agent.get('disabled_toolsets') or []) | implied)
                for platform in platforms:
                    extra = _get_platform_tools(config, platform) - set(selected)
                    if extra:
                        raise ValueError('Hermes widened the campaign toolset allowlist: ' + ', '.join(sorted(extra)))
        disclosure = (config.get('tools') or {}).get('tool_search')
        if isinstance(disclosure, dict) and 'eager_toolsets' in disclosure and 'eager_toolsets' not in ToolSearchConfig.__dataclass_fields__:
            if disclosure.pop('eager_toolsets') != []:
                raise ValueError('This Hermes release requires tools.tool_search.defer for custom disclosure')
        return config

    if mode == 'inspect':
        root = get_default_hermes_root().resolve()
        result = {'root': str(root), 'profiles': str(get_profile_dir('oma-probe').parent.resolve())}
    elif mode == 'quiescent':
        from gateway.status import live_gateway_pid_for_home
        for path in request['paths']:
            if live_gateway_pid_for_home(Path(path)):
                raise ValueError('Stop the Hermes gateway before changing installed campaigns: ' + path)
        if request.get('uninstalling'):
            from hermes_cli.profiles import get_active_profile
            if get_active_profile() in request['uninstalling']:
                raise ValueError('Switch the active Hermes profile before uninstalling (hermes profile use default)')
        result = {'quiescent': True}
    elif mode == 'replace':
        from hermes_yaml import safe_load
        data = safe_load(Path(request['source']).read_text())
        if not isinstance(data, dict):
            raise ValueError('Invalid staged native configuration')
        atomic_config_replace(Path(request['target']), data)
        result = {'written': True}
    elif mode == 'validate':
        from toolsets import TOOLSETS
        for agent in request['agents']:
            native = native_config(agent['native'])
            unknown = set(native) - set(DEFAULT_CONFIG) - set(_KNOWN_ROOT_KEYS)
            if unknown:
                raise ValueError(agent['id'] + ': unknown native roots: ' + ', '.join(sorted(unknown)))
            issues = [i.message for i in validate_config_structure(native) if i.severity == 'error']
            if issues:
                raise ValueError(agent['id'] + ': ' + '; '.join(issues))
            for key in ('enabled_toolsets', 'disabled_toolsets'):
                for name in native.get('agent', {}).get(key) or []:
                    if name not in TOOLSETS and not name.startswith('mcp_'):
                        raise ValueError(agent['id'] + ': unknown toolset ' + name)
            for job in agent['jobs']:
                # Stores are disposable and always explicitly bound before native imports/write.
                with tempfile.TemporaryDirectory(dir=request['scratch']) as scratch, use_cron_store(scratch):
                    values = {k: v for k, v in job.items() if k != 'id'}
                    create_job(**values, paused=True, deliver='local')
        result = {'valid': True}
    elif mode == 'env':
        from agent.secret_scope import load_env_file, _strip_inline_comment
        from hermes_cli.config import save_env_value, validate_env_var_name_for_write
        installer_keys = ${JSON.stringify(installerEnvKeys)}
        source = Path(request['source'])
        # Fail closed on unreadable files and malformed records; the native reader
        # otherwise intentionally skips malformed lines. Never evaluate shell code.
        text = source.read_text(encoding='utf-8-sig')
        names = set()
        for number, line in enumerate(text.splitlines(), 1):
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if line.startswith('export '):
                line = line[7:].lstrip()
            key, sep, raw = line.partition('=')
            key = key.strip()
            if not sep or key in names or '\x00' in line:
                raise ValueError('Invalid or duplicate setup-env entry on line ' + str(number))
            if key not in installer_keys:
                validate_env_var_name_for_write(key)
            value = _strip_inline_comment(raw)
            if value[:1] in ('"', "'") and (len(value) < 2 or value[-1:] != value[:1]):
                raise ValueError('Invalid setup-env quoting on line ' + str(number))
            names.add(key)
        values = load_env_file(source)
        if set(values) != names:
            raise ValueError('Could not read all setup-env entries')
        # Installer routing is not agent configuration and must never reach its env.
        for key in installer_keys:
            values.pop(key, None)
        path = Path(request['path'])
        actual = load_env_file(path)
        matches = all(key in actual and actual[key] == value for key, value in values.items())
        if not request.get('checkOnly'):
            for key, value in values.items():
                save_env_value(key, value)
            os.chmod(path, 0o600) if path.exists() else None
            actual = load_env_file(path)
            if not all(key in actual and actual[key] == value for key, value in values.items()):
                raise ValueError('Setup-env failed read-back')
        result = {'matches': matches, 'verified': True}
    elif mode == 'create':
        import inspect
        from hermes_cli.profiles import seed_profile_skills
        options = {'no_alias': True, 'no_skills': False, 'description': request['description']}
        if 'seed_model' in inspect.signature(create_profile).parameters:
            options['seed_model'] = False
        profile = create_profile(request['id'], **options)
        seeded = seed_profile_skills(profile, quiet=True)
        if seeded is None:
            raise ValueError('Bundled skill seeding failed')
        result = {'path': str(profile)}
    elif mode == 'config':
        path = Path(request['path'])
        # The staged file keeps comments while using Hermes's sole config writer seam.
        current = native_config(require_readable_config_before_write(path))
        old = native_config(request.get('old', {}))
        new = request['native']
        def overlay(local, values):
            for key, value in values.items():
                if isinstance(value, dict) and isinstance(local.get(key), dict):
                    overlay(local[key], value)
                else:
                    local[key] = value
        setup = request.get('setup', {})
        overlay(new, setup)
        new = native_config(new)
        missing = object()
        def leaf_paths(values, prefix=''):
            paths = set()
            for key, value in values.items():
                name = prefix + key
                paths.update(leaf_paths(value, name + '.') if isinstance(value, dict) else {name})
            return paths
        forced = leaf_paths(native_config(setup))
        def reconcile(local, before, after, prefix=''):
            for key in set(before) | set(after):
                previous, incoming = before.get(key, missing), after.get(key, missing)
                actual = local.get(key, missing)
                name = prefix + key
                if name in forced:
                    if incoming is missing:
                        local.pop(key, None)
                    else:
                        local[key] = incoming
                    continue
                if isinstance(incoming, dict) and (previous is missing or isinstance(previous, dict)):
                    if actual is missing:
                        local[key] = {}
                    elif not isinstance(actual, dict):
                        raise ValueError('Local config conflicts at ' + name)
                    reconcile(local[key], {} if previous is missing else previous, incoming, name + '.')
                    continue
                if previous is not missing and actual is not missing and actual != previous and actual != incoming:
                    raise ValueError('Local config conflicts at ' + name + '; reconcile before upgrading')
                if incoming is missing:
                    local.pop(key, None)
                else:
                    local[key] = incoming
        reconcile(current, old, new)
        atomic_config_replace(path, current)
        result = {'written': True}
    elif mode == 'meta':
        write_profile_meta(Path(request['path']), description=request['description'])
        result = {'written': True}
    elif mode == 'jobs':
        authored = {}
        for job in request['jobs']:
            with tempfile.TemporaryDirectory(dir=request['scratch']) as scratch, use_cron_store(scratch):
                record = create_job(**{k: v for k, v in job.items() if k != 'id'}, paused=True, deliver='local')
                record['id'] = job['id']
                authored[job['id']] = record
        with use_cron_store(request['path']):
            existing = {j['id']: j for j in load_jobs()}
            for job_id in authored:
                if job_id in existing and job_id not in request['oldIds']:
                    raise ValueError('Unmanaged cron job collision: ' + job_id)
            import_job_definitions(authored, paused_reason='Installed by oma-scripts; review before resuming')
            for job_id in set(request['oldIds']) - set(authored):
                pause_job(job_id, reason='Removed from playbook definition; retained for history')
            result = {'jobs': [{'id': j['id'], 'state': j.get('state'), 'enabled': j.get('enabled')}
                               for j in load_jobs() if j['id'] in set(authored) | set(request['oldIds'])]}
    elif mode == 'read':
        from hermes_yaml import safe_load
        path = Path(request['path'])
        data = safe_load(path.read_text()) if path.exists() else {}
        # Never serialize config/secrets back to the CLI; only verify selected expected leaves.
        def contains(actual, expected):
            return all(k in actual and (contains(actual[k], v) if isinstance(v, dict) else actual[k] == v)
                       for k, v in expected.items()) if isinstance(actual, dict) else False
        matches = contains(data, native_config(request['expected']))
        if not matches and not request.get('checkOnly'):
            raise ValueError('Installed native config failed read-back')
        result = {'verified': matches}
    else:
        raise ValueError('Unknown native adapter mode')
print(json.dumps(result))
`;

export interface Runtime {
  /** Hermes source checkout that hosts the native bridge, discovered from HERMES_DIR. */
  installDir: string;
  python: string;
  root: string;
  profiles: string;
  call<T = any>(mode: string, data?: Record<string, any>, home?: string): Promise<T>;
}
export async function getRuntime(setupEnv?: string): Promise<Runtime> {
  const fromFile = await readHermesDirectory(setupEnv);
  const supplied = process.env.HERMES_DIR || fromFile;
  if (!supplied) throw new Error("Set HERMES_DIR in --setup-env or the process environment to the Hermes home directory (the .hermes directory)");
  const provided = resolve(supplied);
  // HERMES_DIR is the Hermes home, so the source checkout inside it is the default.
  // A checkout path is still accepted; only then does the home stay unset.
  const nested = join(provided, "hermes-agent");
  const installDir = await exists(join(nested, "hermes_cli")) ? nested : provided;
  if (!await exists(join(installDir, "hermes_cli", "profiles.py"))) throw new Error(`No Hermes installation found under ${provided}; set HERMES_DIR to the Hermes home (.hermes) or to a hermes-agent checkout`);
  let python = process.env.HERMES_PYTHON;
  let bootstrap = false;
  const venvPython = join(installDir, ".venv", "bin", "python");
  const launcher = join(installDir, ".hermes", "bin", "hermes");
  if (!python && await exists(venvPython)) python = venvPython;
  if (!python && await exists(launcher)) {
    // Ask the published launcher for its managed interpreter; do not scrape or
    // execute its shell contents and do not fall back to an unrelated system Python.
    const child = Bun.spawn([launcher, "--print-runtime-command"], { cwd: installDir, stdout: "pipe", stderr: "pipe" });
    const [output, _stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error("Cannot resolve Hermes's managed interpreter; set HERMES_PYTHON explicitly");
    const command: unknown = JSON.parse(output);
    if (!Array.isArray(command) || typeof command[0] !== "string" || !await exists(command[0])) throw new Error("Hermes launcher returned an invalid runtime command");
    python = command[0];
    bootstrap = true;
  }
  python ??= Bun.which("python3") ?? undefined;
  if (!python) throw new Error("No Hermes Python found. Set HERMES_PYTHON to its managed interpreter.");
  // A HERMES_DIR home is the default provisioning target; a bare checkout leaves home resolution to Hermes.
  const defaultHome = process.env.HERMES_HOME ?? (installDir !== provided ? provided : undefined);
  const call = async <T = any>(mode: string, data: Record<string, any> = {}, home?: string): Promise<T> => {
    const env: Record<string, string | undefined> = { ...process.env, PYTHONPATH: installDir, PYTHONDONTWRITEBYTECODE: "1" };
    // A caller may itself be a specialist; never inherit its routing/task identity.
    for (const name of Object.keys(env)) {
      if (name.startsWith("HERMES_KANBAN_") || ["HERMES_PROFILE", "HERMES_PROFILE_NAME", "HERMES_ACTIVE_PROFILE", "HERMES_HOME"].includes(name)) delete env[name];
    }
    // Bootstrap is signalled out of band so the bridge can run it before it reads its payload.
    if (bootstrap) env.OMA_BRIDGE_BOOTSTRAP = "1";
    if (home ?? defaultHome) env.HERMES_HOME = home ?? defaultHome;
    // Hermes anchors anything below its native home back to that root. A staged
    // profile creation must also isolate HOME or it could publish to live profiles.
    if (mode === "create" && home) env.HOME = join(home, ".isolated-user");
    const child = Bun.spawn([python, "-c", bridge, installDir], {
      cwd: installDir, env, stdin: new Response(JSON.stringify({ mode, ...data })), stdout: "pipe", stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) {
      if (mode === "env") throw new Error("Invalid --setup-env or env write failed; check dotenv syntax, unique keys and Hermes's env writer policy (contents withheld)");
      // Do not print traceback/config payloads, which can contain inline credentials.
      const last = err.trim().split("\n").at(-1) ?? "no diagnostic";
      throw new Error(`Hermes adapter (${mode}) exited ${code}: ${last}`);
    }
    return JSON.parse(out) as T;
  };
  const info = await call<{ root: string; profiles: string }>("inspect");
  // Compare canonical paths only: Hermes resolves its root, while resolve() keeps symlinked
  // components (macOS /var -> /private/var), which would look like a second home.
  const canonical = async (path: string) => { try { return await realpath(path); } catch { return resolve(path); } };
  if (defaultHome && await canonical(defaultHome) !== await canonical(info.root)) {
    throw new Error(`HERMES_HOME resolves to another Hermes root (${info.root}); provide the root home, not a nested directory or profile`);
  }
  if (info.profiles !== join(info.root, "profiles")) throw new Error("Unsupported Hermes profile-root layout");
  return { installDir, python, ...info, call };
}
