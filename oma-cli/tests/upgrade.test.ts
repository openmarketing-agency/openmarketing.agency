import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimeFiles, withStackBundle } from "../src/update";

const work = mkdtempSync(join(tmpdir(), "oma-upgrade-fixture-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));
const version = "0.1.1";
const name = `oma-setup-v${version}-linux-amd64`;
const asset = `${name}.tar.gz`;
const bundle = join(work, name, "setup");
const bin = join(work, "bin");
mkdirSync(bundle, { recursive: true });
mkdirSync(bin);
writeFileSync(join(bundle, "versions.yaml"), readFileSync(new URL("./versions.yaml", import.meta.url), "utf8").replace(/^version: .*$/m, `version: ${version}`));
for (const file of runtimeFiles) writeFileSync(join(bundle, file), "# fixture\n");

const archive = join(work, asset);
const packed = Bun.spawnSync(["tar", "-czf", archive, "-C", work, name]);
if (packed.exitCode !== 0) throw new Error(packed.stderr.toString());
writeFileSync(join(bin, "curl"), `#!/bin/bash\nset -euo pipefail\nurl=\${@: -3:1}\n[[ $url == https://github.com/openmarketing-agency/openmarketing.agency/releases/download/v${version}/* ]]\ncp "$FIXTURE/\${url##*/}" "\${@: -1}"\n`, { mode: 0o755 });

test("install and upgrade reject component targets before touching the host", () => {
  const cli = new URL("../src/cli.ts", import.meta.url).pathname;
  for (const command of ["install", "upgrade"]) {
    for (const component of ["oma-agent", "omactl", "oma-console", "camofox"]) {
      const result = Bun.spawnSync([process.execPath, cli, command, component]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain(`oma ${command} applies the entire release`);
    }
  }

});

test("versions supports --output and keeps progress separate from JSON", () => {
  const cli = new URL("../src/cli.ts", import.meta.url).pathname;
  const preload = join(work, "catalog-fixture.ts");
  writeFileSync(preload, `globalThis.fetch = async (url) => {
    if (url !== "https://r2.example.test/versions/index.json") throw new Error("wrong discovery origin");
    return Response.json({ versions: ["${version}"] });
  };\n`);
  for (const flags of [["--output", "json"], ["--output=json"]]) {
    const result = Bun.spawnSync([process.execPath, "--preload", preload, cli, "versions", ...flags], {
      env: { ...process.env, OMA_R2_PUBLIC_URL: "https://r2.example.test" },
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual([version]);
    expect(result.stderr.toString()).toContain("Checking published OMA releases");
  }
  const legacy = Bun.spawnSync([process.execPath, cli, "versions", "--json"]);
  expect(legacy.exitCode).toBe(1);
  expect(legacy.stderr.toString()).toContain("--output");
});

test("upgrade verifies the archive before installing the whole release", async () => {
  const previous = { PATH: process.env.PATH, FIXTURE: process.env.FIXTURE };
  Object.assign(process.env, { PATH: `${bin}:${previous.PATH}`, FIXTURE: work });
  let applied = false;
  const apply = (path: string) => {
    applied = true;
    expect(readFileSync(join(path, "install.sh"), "utf8")).toBe("# fixture\n");
    expect(readFileSync(join(path, "versions.yaml"), "utf8")).toContain(`version: ${version}`);
    expect(existsSync(join(path, "oma"))).toBe(false);
  };
  try {
    writeFileSync(join(work, "SHA256SUMS"), `${"0".repeat(64)}  ${asset}\n`);
    await expect(withStackBundle({ version, asset }, apply)).rejects.toThrow("SHA-256 mismatch");
    expect(applied).toBe(false);
    const real = createHash("sha256").update(readFileSync(archive)).digest("hex");
    writeFileSync(join(work, "SHA256SUMS"), `${real}  ${asset}\n`);
    await withStackBundle({ version, asset }, apply);
    expect(applied).toBe(true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
