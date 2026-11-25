import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isValidFernetKey } from "../../oma/lib/server/common/fernet";

// Exercise the actual installer with isolated paths and fake downloads/Docker, never a live installation.
function fixture(use: (root: string, run: (extra?: Record<string, string>) => ReturnType<typeof Bun.spawnSync>) => void) {
  const work = mkdtempSync(join(tmpdir(), "oma-install-keys-"));
  const root = join(work, "oma");
  const bin = join(work, "bin");
  const agentHome = join(root, "oma-agent-data");
  try {
    mkdirSync(bin);
    mkdirSync(agentHome, { recursive: true });
    writeFileSync(join(work, "versions.yaml"), readFileSync(new URL("../../versions/0.1.0.yaml", import.meta.url)));
    const installer = readFileSync(new URL("../../oma-cli/scripts/install-stack.sh", import.meta.url), "utf8")
      .replace(/\[\[ \$\(uname -s\)[\s\S]+?^\[\[ \$EUID == 0 \]\].*$/m, "")
      .replace(/^oma_root=\/opt\/oma$/m, 'oma_root="$TEST_ROOT"')
      .replace(process.getuid?.() === 0 ? /$^/ : / -o \d+ -g \d+|^    chown 0:10000 "\$key_stage"$/gm, "");
    const detectDocker = `command() {
      if [[ $* == '-v docker' && \${FIXTURE_NO_DOCKER:-0} == 1 && ! -f $FIXTURE/apt-installed ]]; then return 1; fi
      builtin command "$@"
    }\n`;
    writeFileSync(join(work, "install.sh"), installer.replace("set -euo pipefail\n", `set -euo pipefail\n${detectDocker}`));
    mkdirSync(join(work, "asset", "bin"), { recursive: true });
    mkdirSync(join(work, "asset", "catalog"));
    writeFileSync(join(work, "asset", "bin", "omactl"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(join(work, "asset", "catalog", "catalog.json"), "{}\n");
    writeFileSync(join(work, "asset", "LICENSE"), "fixture\n");
    const archive = join(work, "omactl-linux-x64.tar.gz");
    expect(Bun.spawnSync(["tar", "-czf", archive, "bin", "catalog", "LICENSE"], { cwd: join(work, "asset") }).exitCode).toBe(0);
    writeFileSync(join(work, "SHA256SUMS"), `${createHash("sha256").update(readFileSync(archive)).digest("hex")}  omactl-linux-x64.tar.gz\n`);
    const scripts = {
      "dpkg-query": 'printf "install ok installed"',
      "apt-get": `printf '%s\\n' "$*" >> "$FIXTURE/apt-calls"
        if [[ $1 == install ]]; then [[ $* == *docker.io ]] && touch "$FIXTURE/apt-installed"; fi`,
      service: '[[ $* == "docker start" ]] && touch "$FIXTURE/daemon-started"',
      systemctl: '[[ $* == "start docker" ]] && touch "$FIXTURE/daemon-started"',
      id: '[[ $1 == -u ]]; printf "0\\n"',
      git: 'printf "%040d\t%s\\n" 1 "$4"',
      curl: `case "$*" in
        *githubusercontent.com*) cp "$FIXTURE/agent-install.sh" "\${@: -1}" ;;
        *omactl-linux-x64.tar.gz*) cp "$FIXTURE/omactl-linux-x64.tar.gz" "\${@: -1}" ;;
        *SHA256SUMS*) cp "$FIXTURE/SHA256SUMS" "\${@: -1}" ;;
        *127.0.0.1*) exit 0 ;;
        *) exit 1 ;;
      esac`,
      docker: `case "$1 \${2:-}" in
        'container ls') ;;
        'container inspect')
          [[ -f "$FIXTURE/\${@: -1}.created" ]] || exit 1
          if [[ "$*" == *agency.openmarketing.oma.release* ]]; then printf '0.1.0\\n'; fi ;;
        'network inspect')
          [[ -e "$FIXTURE/network" ]] || exit 1
          case "$*" in
            *Labels*) printf '%s\\n' "$TEST_ROOT" ;;
            *Gateway*) printf '172.32.0.1\\n' ;;
          esac ;;
        'network create') touch "$FIXTURE/network" ;;
        'info ') [[ \${FIXTURE_NO_DOCKER:-0} == 0 || -f "$FIXTURE/daemon-started" ]] ;;
        'image inspect'|'pull '*) ;;
        'create --pull')
          [[ "$*" =~ --name\\ (oma-[a-z]+) ]] || exit 1
          name=\${BASH_REMATCH[1]}
          [[ ! -f "$FIXTURE/$name.created" ]] || exit 1
          printf '%s\\n' "$*" > "$FIXTURE/$name.created"
          if [[ "$*" == *'--name oma-console '* ]]; then
            [[ $* == *'-e OMA_INTEGRATION_ENCRYPTION_KEY '* ]] || exit 1
            (umask 077; printf '%s' "$OMA_INTEGRATION_ENCRYPTION_KEY" > "$FIXTURE/console-key")
          fi ;;
        *) exit 1 ;;
      esac`,
      ...(process.platform === "darwin" ? {
        stat: `case "$2" in
          '%a') exec /usr/bin/stat -f '%Lp' "$3" ;;
          '%a:%h') exec /usr/bin/stat -f '%Lp:%l' "$3" ;;
        esac
        exit 2`,
        sha256sum: 'exec /usr/bin/shasum -a 256 -c',
      } : {}),
    };
    for (const [name, body] of Object.entries(scripts)) {
      writeFileSync(join(bin, name), `#!/bin/bash\nset -eu\n${body}\n`, { mode: 0o755 });
    }
    writeFileSync(join(work, "agent-install.sh"), `mkdir -p "$TEST_ROOT/oma-agent/.hermes/bin"
      printf '#!/bin/sh\\nexit 0\\n' > "$TEST_ROOT/oma-agent/.hermes/bin/hermes"
      chmod 0755 "$TEST_ROOT/oma-agent/.hermes/bin/hermes"\n`);
    use(root, (extra = {}) => Bun.spawnSync(["bash", join(work, "install.sh")], { env: {
      PATH: `${bin}:${process.env.PATH}`, FIXTURE: work, TEST_ROOT: root, ...extra,
    } }));
  } finally { rmSync(work, { recursive: true, force: true }); }
}

function keys(root: string) {
  return Object.fromEntries(readFileSync(join(root, "keys.txt"), "utf8").trim().split("\n").map((line) => {
    const at = line.indexOf("=");
    return [line.slice(0, at), line.slice(at + 1)];
  }));
}

test("a missing Docker installation is installed and its daemon starts before image pulls", () => fixture((root, run) => {
  expect(run({ FIXTURE_NO_DOCKER: "1" }).exitCode).toBe(0);
  const work = join(root, "..");
  expect(readFileSync(join(work, "apt-calls"), "utf8")).toBe("update\ninstall -y docker.io\n");
  expect(existsSync(join(work, "daemon-started"))).toBe(true);
  expect(existsSync(join(work, "oma-console.created"))).toBe(false);
}));

test("install only stages artifacts; setup persists service keys and creates stopped containers once", () => fixture((root, run) => {
  expect(run().exitCode).toBe(0);
  expect(existsSync(join(root, "keys.txt"))).toBe(false);
  expect(existsSync(join(root, "..", "oma-console.created"))).toBe(false);
  const first = run({ OMA_STACK_STAGE: "setup" });
  expect(first.exitCode).toBe(0);
  const saved = keys(root);
  expect(Object.keys(saved).sort()).toEqual(["API_SERVER_KEY", "OMA_INTEGRATION_ENCRYPTION_KEY"]);
  expect(/^[a-f0-9]{64}$/.test(saved.API_SERVER_KEY)).toBe(true);
  expect(isValidFernetKey(saved.OMA_INTEGRATION_ENCRYPTION_KEY)).toBe(true);
  expect(statSync(join(root, "keys.txt")).mode & 0o777).toBe(0o600);
  const nativeEnv = join(root, "oma-agent-data", ".env");
  expect(readFileSync(nativeEnv, "utf8").includes(`API_SERVER_KEY=${saved.API_SERVER_KEY}\n`)).toBe(true);
  expect(readFileSync(nativeEnv, "utf8")).toContain("API_SERVER_HOST=172.32.0.1");
  expect(readFileSync(nativeEnv, "utf8")).toContain("API_SERVER_ENABLED=true");
  const consoleArgs = readFileSync(join(root, "..", "oma-console.created"), "utf8");
  expect(consoleArgs).toContain("OMA_WORKSPACE_SOCKET=/run/oma-console/workspace.sock");
  expect(consoleArgs).toContain("OMA_AGENT_URL=http://172.32.0.1:8642");
  expect(readFileSync(join(root, "..", "console-key"), "utf8") === saved.OMA_INTEGRATION_ENCRYPTION_KEY).toBe(true);
  expect(run({ OMA_STACK_STAGE: "setup" }).exitCode).toBe(0);
  expect(JSON.stringify(keys(root)) === JSON.stringify(saved)).toBe(true);
  for (const value of Object.values(saved)) {
    expect(`${first.stdout}${first.stderr}`.includes(value)).toBe(false);
  }
}));

test("preconfigured keys are adopted without changing the agent's model credentials", () => fixture((root, run) => {
  expect(run().exitCode).toBe(0);
  const nativeEnv = join(root, "oma-agent-data", ".env");
  const legacyApi = "1234567890abcdef1234567890abcdef";
  const integration = Buffer.alloc(32, 7).toString("base64url") + "=";
  writeFileSync(nativeEnv, `export API_SERVER_KEY="${legacyApi}"\nHERMES_MODEL_API_KEY=model-fixture\n`, { mode: 0o600 });
  expect(run({ OMA_STACK_STAGE: "setup", OMA_INTEGRATION_ENCRYPTION_KEY: integration }).exitCode).toBe(0);
  expect(keys(root).API_SERVER_KEY === legacyApi).toBe(true);
  expect(keys(root).OMA_INTEGRATION_ENCRYPTION_KEY === integration).toBe(true);
  expect(readFileSync(nativeEnv, "utf8").includes("HERMES_MODEL_API_KEY=model-fixture\n")).toBe(true);
  expect(run({ OMA_STACK_STAGE: "setup", OMA_INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64url") }).exitCode).toBe(1);
  expect(keys(root).OMA_INTEGRATION_ENCRYPTION_KEY === integration).toBe(true);
}));

test("the installer refuses symlinked or readable-by-others key files", () => fixture((root, run) => {
  expect(run().exitCode).toBe(0);
  const target = join(root, "untouched");
  const store = join(root, "keys.txt");
  writeFileSync(target, "fixture\n");
  symlinkSync(target, store);
  expect(run({ OMA_STACK_STAGE: "setup" }).stderr.toString()).toContain("keys.txt must be");
  expect(readFileSync(target, "utf8")).toBe("fixture\n");
  rmSync(store);
  writeFileSync(store, "fixture\n");
  chmodSync(store, 0o644);
  expect(run({ OMA_STACK_STAGE: "setup" }).stderr.toString()).toContain("keys.txt must be");
  expect(readFileSync(store, "utf8")).toBe("fixture\n");
}));
