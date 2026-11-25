import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const gate = fileURLToPath(new URL("../../.github/scripts/check-release.sh", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "oma-release-gate-"));
const bin = join(work, "bin");
mkdirSync(bin);
mkdirSync(join(work, "versions"));
const manifest = readFileSync(new URL("../../versions/0.1.0.yaml", import.meta.url), "utf8")
  .replace(/^version: .*$/m, "version: 0.1.0").replace(/^oma-console: .*$/m, "oma-console: 0.9.0");
const agentVersion = manifest.match(/^oma-agent: ([0-9]+\.[0-9]+\.[0-9]+)$/m)?.[1];
if (!agentVersion) throw new Error("Test manifest must pin a bare OMA Agent version.");
writeFileSync(join(work, "versions/0.1.0.yaml"), manifest);
writeFileSync(join(work, "versions/0.1.1.yaml"), manifest);
for (const [name, script] of Object.entries({
  gh: 'printf "HTTP/2.0 %s\n" "$RELEASE_STATUS"; [[ $RELEASE_STATUS == 200 ]]',
  curl: 'url=${@: -1}; printf "%s\n" "$url" >> "$CALLS"; [[ -z $MISSING || $url != *"$MISSING" ]]',
  git: '[[ $MISSING != agent-tag ]] || exit 2; printf "%s\n" "$4" >> "$CALLS"; printf "%s\t%s\n" 1111111111111111111111111111111111111111 "$3" 2222222222222222222222222222222222222222 "$4"',
  docker: '[[ "$*" == "manifest inspect "* && $MISSING != camofox ]]',
})) writeFileSync(join(bin, name), `#!/bin/bash\n${script}\n`, { mode: 0o755 });
afterAll(() => rmSync(work, { recursive: true, force: true }));

test("the internal stack installer does not accept component arguments", () => {
  const helper = fileURLToPath(new URL("../../oma-cli/scripts/install-stack.sh", import.meta.url));
  const result = Bun.spawnSync(["bash", helper, "omactl"]);
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("Installs the entire pinned release");
});

function check(ref = "v0.1.0", status = "404", missing = "") {
  const output = join(work, "output");
  const calls = join(work, "calls");
  writeFileSync(output, "");
  writeFileSync(calls, "");
  const p = Bun.spawnSync(["bash", gate], { cwd: work, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`,
    GITHUB_OUTPUT: output, GITHUB_REF_NAME: ref, GITHUB_REPOSITORY: "openmarketing-agency/openmarketing.agency", RELEASE_STATUS: status, MISSING: missing, CALLS: calls } });
  return { code: p.exitCode, error: p.stderr.toString(), output: readFileSync(output, "utf8"), calls: readFileSync(calls, "utf8") };
}

test("preflight accepts the exact release tag even with another console version", () => {
  const result = check();
  expect(result.code).toBe(0);
  expect(result.output).not.toContain("cli_version=");
  expect(result.output).toContain("console_version=0.9.0\n");
  expect(result.calls).toContain("/omactl/releases/download/v0.1.0/omactl-linux-x64.tar.gz");
  expect(result.calls).toContain(`refs/tags/v${agentVersion}\n`);
  expect(result.calls).toContain("2222222222222222222222222222222222222222/scripts/install.sh");
});

test("preflight fails for a mismatched tag, duplicate release, or unavailable release API", () => {
  for (const [ref, status, message] of [
    ["v0.1.1", "404", "must match"], ["v0.1.2", "404", "No release manifest versions/0.1.2.yaml"],
    ["v0.1.0", "200", "already exists"], ["v0.1.0", "403", "HTTP 403"],
  ]) {
    const result = check(ref, status);
    expect(result.code).toBe(1);
    expect(result.error).toContain(message);
    expect(result.output).toBe("");
    expect(result.calls).toBe("");
  }
});

test("preflight blocks publication when any one of the required assets is unavailable", () => {
  for (const [missing, message] of [
    ["omactl-linux-x64.tar.gz", "omactl-linux-x64.tar.gz is not available"], ["SHA256SUMS", "SHA256SUMS is not available"],
    ["agent-tag", "release tag"], ["scripts/install.sh", "scripts/install.sh is not available"], ["camofox", "Camofox image"],
  ]) {
    const result = check("v0.1.0", "404", missing);
    expect(result.code).toBe(1);
    expect(result.error).toContain(message);
    expect(result.output).toBe("");
  }
});
