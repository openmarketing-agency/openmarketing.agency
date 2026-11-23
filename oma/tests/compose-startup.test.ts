/** Smoke-test the container banner using a controllable readiness response. */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("Compose startup hides internal addresses and prints the banner after readiness", () => {
  const script = fileURLToPath(new URL("../scripts/compose-startup.cjs", import.meta.url));
  const result = spawnSync(process.execPath, ["-e", `
    const keepOpen = setTimeout(() => process.exit(1), 3000);
    let attempts = 0;
    globalThis.fetch = async () => {
      if (++attempts === 1) return { ok: false };
      console.log("Database is ready");
      clearTimeout(keepOpen);
      return { ok: true };
    };
    require(process.argv[1]);
    console.log("\\x1b[35m▲ Next.js 16.4.6\\x1b[0m");
    console.log("\\x1b[35m- Local: http://localhost:3000\\x1b[0m");
    console.log("- Network: http://0.0.0.0:3000");
    console.log("✓ Ready in 0ms");
    console.log("✓ Running next.config took 1ms");
    console.warn("Startup warning");
  `, script], {
    encoding: "utf8",
    timeout: 4000,
    env: { ...process.env, OMA_SECRET_KEY: "test-key-for-compose-banner", OMA_APP_URL: "https://oma.example.test", OMA_FRONTEND_PORT: "13000" },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Startup warning/);
  assert.doesNotMatch(result.stdout, /Local:|Network:/);
  assert.match(result.stdout, /Next\.js 16\.4\.6/);
  assert.match(result.stdout, /Ready in 0ms/);
  assert.match(result.stdout, /Running next\.config took 1ms/);
  assert.match(result.stdout, /Database is ready[\s\S]+Open Marketing Agency[\s\S]+https:\/\/oma\.example\.test/);
  assert.match(result.stdout, /Host port\s+13000/);
  assert.match(result.stdout, /Apache License 2\.0/);
  assert.match(result.stdout.trimEnd(), /Made with ♥ by oma team$/);
});

test("Next dev permits the configured console hostname and specific bind IP", () => {
  const config = fileURLToPath(new URL("../next.config.ts", import.meta.url));
  const readOrigins = (appUrl: string, bindAddress: string) => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "-e", `
      console.log(JSON.stringify(require(process.argv[1]).default.allowedDevOrigins));
    `, config], {
      encoding: "utf8",
      env: { ...process.env, OMA_APP_URL: appUrl, OMA_BIND_ADDRESS: bindAddress },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };

  assert.deepEqual(readOrigins("http://localhost:3000", "192.168.1.86"), ["localhost", "192.168.1.86"]);
  assert.deepEqual(readOrigins("https://oma.example.test:8443", "0.0.0.0"), ["oma.example.test"]);
  assert.deepEqual(readOrigins("https://*.example.test", "::"), []);
});
