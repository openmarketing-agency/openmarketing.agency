/** Load the installation signing key and show the application URL after SQLite is ready. */

/* eslint-disable @typescript-eslint/no-require-imports -- Node preloads this CommonJS file before the standalone server. */
const { randomBytes, randomUUID } = require("node:crypto");
const { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { stripVTControlCharacters } = require("node:util");

function ensureSigningKey() {
  if (process.env.OMA_SECRET_KEY?.trim()) return;
  const directory = process.env.OMA_DATA_DIR || "data";
  const keyFile = join(directory, ".signing-key");
  mkdirSync(directory, { mode: 0o700, recursive: true });
  try {
    process.env.OMA_SECRET_KEY = readFileSync(keyFile, "utf8");
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const temporary = join(directory, `.signing-key-${randomUUID()}`);
  writeFileSync(temporary, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
  try {
    // A concurrent startup can only see a complete key, and the first one wins.
    linkSync(temporary, keyFile);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  } finally {
    unlinkSync(temporary);
  }
  process.env.OMA_SECRET_KEY = readFileSync(keyFile, "utf8");
}

ensureSigningKey();

const log = console.log;
const nextAddressLine = /^- (?:Local|Network):\s+https?:\/\/\S+:\d+$/;

// Hide the container addresses and print the public application endpoint when ready.
console.log = (...args) => {
  const [message] = args;
  if (typeof message !== "string" || !nextAddressLine.test(stripVTControlCharacters(message))) {
    log(...args);
  }
};

async function showBannerWhenReady() {
  const { PORT = "3000", OMA_APP_URL, OMA_FRONTEND_PORT } = process.env;
  // Compose keeps checking health if startup takes longer than the banner window.
  const deadline = Date.now() + 90_000;
  let ready = false;
  while (!ready && Date.now() < deadline) {
    ready = await fetch(`http://127.0.0.1:${PORT}/health/ready`, {
      method: "HEAD",
      signal: AbortSignal.timeout(1000),
    }).then((response) => response.ok, () => false);
    if (!ready) await delay(500, undefined, { ref: false });
  }

  console.log = log;
  if (!ready) return;

  log([
    "",
    "  ╭───────────────────────────────╮",
    "  │     Open Marketing Agency     │",
    "  ╰───────────────────────────────╯",
    `  Web console  ${OMA_APP_URL}`,
    `  Host port    ${OMA_FRONTEND_PORT}`,
    "  Apache License 2.0",
    "  Made with ♥ by oma team",
    "",
  ].join("\n"));
}

void showBannerWhenReady();
