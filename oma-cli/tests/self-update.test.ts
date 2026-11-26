import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { version } from "../package.json";
import { replaceCli } from "../src/self-update";

const next = "1.0.0";
const name = `oma-cli-v${next}-linux-amd64`;
const asset = `${name}.tar.gz`;

test("CLI status, versions, and updates work without stack metadata", () => {
  const work = mkdtempSync(join(tmpdir(), "oma-cli-catalog-"));
  try {
    const preload = join(work, "fetch.ts");
    writeFileSync(preload, `globalThis.fetch = async (url) => {
      if (url !== "https://r2.example.test/oma-cli/versions/index.json") throw new Error("wrong channel");
      return Response.json({ versions: ["${next}"] });
    };`);
    for (const [cmd, expected] of [["status", { version }], ["versions", [next]],
      ["updates", { installed: version, latest: next, available: true }]] as const) {
      const cli = new URL("../src/cli.ts", import.meta.url).pathname;
      const run = Bun.spawnSync([process.execPath, "--preload", preload, cli, "cli", cmd, "--output", "json"], {
        cwd: work, env: { ...process.env, OMA_R2_PUBLIC_URL: "https://r2.example.test" },
      });
      expect(run.exitCode).toBe(0);
      if (cmd === "status") expect(JSON.parse(run.stdout.toString())).toMatchObject(expected);
      else expect(JSON.parse(run.stdout.toString())).toEqual(expected);
    }
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test("CLI replacement verifies the archive and binary version before changing only the executable", async () => {
  const work = mkdtempSync(join(tmpdir(), "oma-cli-replacement-"));
  const previous = { PATH: process.env.PATH, FIXTURE: process.env.FIXTURE };
  try {
    const bin = join(work, "bin"), archive = join(work, asset), binary = join(work, "oma");
    const payload = join(work, name);
    mkdirSync(bin);
    mkdirSync(payload);
    writeFileSync(binary, "original", { mode: 0o755 });
    writeFileSync(join(work, "versions.yaml"), "stack state");
    writeFileSync(join(bin, "curl"), '#!/bin/bash\nset -eu\nurl=${@: -3:1}\nprintf "%s\\n" "$url" >> "$FIXTURE/requests"\ncp "$FIXTURE/${url##*/}" "${@: -1}"\n', { mode: 0o755 });
    Object.assign(process.env, { PATH: `${bin}:${previous.PATH}`, FIXTURE: work });
    const pack = (value: string) => {
      writeFileSync(join(payload, "oma"), `#!/bin/sh\nprintf '%s\\n' '${value}'\n`, { mode: 0o755 });
      expect(Bun.spawnSync(["tar", "-czf", archive, "-C", work, name]).exitCode).toBe(0);
      writeFileSync(join(work, "SHA256SUMS"), `${createHash("sha256").update(readFileSync(archive)).digest("hex")}  ${asset}\n`);
    };
    pack("0.0.0");
    const release = { version: next, asset };
    await expect(replaceCli(release, binary)).rejects.toThrow("version does not match");
    expect(readFileSync(binary, "utf8")).toBe("original");
    pack(next);
    const sums = join(work, "SHA256SUMS");
    const good = readFileSync(sums);
    writeFileSync(sums, `${"0".repeat(64)}  ${asset}\n`);
    await expect(replaceCli(release, binary)).rejects.toThrow("SHA-256 mismatch");
    expect(readFileSync(binary, "utf8")).toBe("original");
    writeFileSync(sums, good);
    await replaceCli(release, binary);
    expect(Bun.spawnSync([binary, "--version"]).stdout.toString().trim()).toBe(next);
    expect(readFileSync(join(work, "versions.yaml"), "utf8")).toBe("stack state");
    const base = `https://github.com/openmarketing-agency/openmarketing.agency/releases/download/oma-cli-v${next}`;
    expect([...new Set(readFileSync(join(work, "requests"), "utf8").trim().split("\n"))]).toEqual([`${base}/${asset}`, `${base}/SHA256SUMS`]);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(work, { recursive: true, force: true });
  }
});
