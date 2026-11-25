import { readFileSync } from "node:fs";
import { join } from "node:path";

export const components = ["oma-agent", "omactl", "oma-console", "camofox"] as const;
export type Component = typeof components[number];
export type Pins = Record<Component, string>;

export function parseManifest(manifest: string): { version: string; pins: Pins } {
  function read(key: string, pattern: RegExp): string {
    const matches = [...manifest.matchAll(new RegExp(`^${key}:[ \\t]*([^ \\t#\\r\\n]+)[ \\t]*(?:#.*)?\\r?$`, "gm"))];
    if (matches.length !== 1 || !pattern.test(matches[0][1])) throw new Error(`Invalid or missing ${key} in versions.yaml.`);
    return matches[0][1];
  }
  const version = /^\d+\.\d+\.\d+$/;
  return { version: read("version", version), pins: {
    "oma-agent": read("oma-agent", version), omactl: read("omactl", version),
    "oma-console": read("oma-console", version), camofox: read("camofox_image", /^[a-z0-9][a-z0-9./_-]+@sha256:[a-f0-9]{64}$/),
  } };
}

export const readManifest = (bundle: string) => parseManifest(readFileSync(join(bundle, "versions.yaml"), "utf8"));
export const releaseVersion = (bundle: string) => readManifest(bundle).version;
