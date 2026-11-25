import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { parseManifest } from "../src/release";
import { availableVersions, expectedChecksum, latestRelease, newerVersion, releaseByVersion, releaseManifest } from "../src/update";

const version = "0.1.0";
const asset = `oma-setup-v${version}-linux-amd64.tar.gz`;
const manifest = readFileSync(new URL("./versions.yaml", import.meta.url), "utf8");
const respond = (body: unknown, status = 200) => (() => Promise.resolve(Response.json(body, { status }))) as unknown as typeof fetch;

test("the stack manifest needs no CLI version and the console version can differ", () => {
  const pins = parseManifest(manifest.replace(/^oma-console: .+$/m, "oma-console: 0.2.0"));
  expect(pins.version).toBe(version);
  expect(pins).not.toHaveProperty("cliVersion");
  expect(pins.pins["oma-console"]).toBe("0.2.0");
  expect(() => parseManifest(`${manifest}\nversion: 0.1.1\n`)).toThrow("version");
});

test("manifest pins use bare versions for omactl and oma-agent", () => {
  const { pins } = parseManifest(manifest);
  expect(pins.omactl).toBe("0.1.0");
  expect(pins["oma-agent"]).toBe("0.1.28");
  expect(() => parseManifest(manifest.replace(/^omactl: .+$/m, "omactl: v0.1.0"))).toThrow("omactl");
  expect(() => parseManifest(manifest.replace(/^oma-agent: .+$/m, "oma-agent: v0.1.28"))).toThrow("oma-agent");
});

const publicBase = "https://releases.example.test/oma";
const stackIndex = `${publicBase}/versions/index.json`;
const cliIndex = `${publicBase}/oma-cli/versions/index.json`;

test("R2 discovery uses separate HTTPS indexes and selects the newest numeric version", async () => {
  const urls: string[] = [];
  const request = (async (url: string) => {
    urls.push(url);
    return Response.json({ versions: url === cliIndex ? ["1.0.0"] : ["0.9.0", "0.10.0", "0.9.0", "0.1.0"] });
  }) as unknown as typeof fetch;
  expect(await availableVersions(request, "stack", publicBase)).toEqual(["0.10.0", "0.9.0", "0.1.0"]);
  expect(await latestRelease(request, "stack", publicBase)).toEqual({ version: "0.10.0", asset: "oma-setup-v0.10.0-linux-amd64.tar.gz" });
  expect(await latestRelease(request, "cli", publicBase)).toEqual({ version: "1.0.0", asset: "oma-cli-v1.0.0-linux-amd64.tar.gz" });
  expect(urls).toEqual([stackIndex, stackIndex, cliIndex]);
});

test("empty R2 indexes are distinct from malformed, missing, or inaccessible indexes", async () => {
  expect(await latestRelease(respond({ versions: [] }), "stack", publicBase)).toBeNull();
  await expect(availableVersions(respond({}, 403), "stack", publicBase)).rejects.toThrow("HTTP 403");
  await expect(availableVersions(respond({}, 404), "stack", publicBase)).rejects.toThrow("HTTP 404");
  await expect(availableVersions(respond({ versions: ["v0.1.0"] }), "stack", publicBase)).rejects.toThrow("Invalid R2 version index");
  await expect(availableVersions(respond({ versions: [] }), "stack", "http://insecure.example")).rejects.toThrow("HTTPS");
});

test("exact release selection requires the requested version to be in R2", async () => {
  const request = (async (url: string) => {
    expect(url).toBe(stackIndex);
    return Response.json({ versions: [version, "0.2.0"] });
  }) as unknown as typeof fetch;
  expect(await releaseByVersion(version, request, "stack", publicBase)).toEqual({ version, asset });
  await expect(releaseByVersion(`v${version}`, request, "stack", publicBase)).rejects.toThrow("X.Y.Z");
  await expect(releaseByVersion("0.1.1", request, "stack", publicBase)).rejects.toThrow("not listed in R2");
});

test("reject mismatched release manifests and ambiguous SHA-256 entries", async () => {
  const line = `${"a".repeat(64)}  ${asset}`;
  expect(expectedChecksum(line + "\n", asset)).toBe("a".repeat(64));
  expect(() => expectedChecksum(`${line}\n${line}`, asset)).toThrow("exactly one");
  expect(() => expectedChecksum(line, "other.tar.gz")).toThrow("exactly one");
  const fetchWrongVersion = (async (url: string) => {
    expect(url).toBe(`${publicBase}/versions/${version}.yaml`);
    return new Response(manifest.replace(/^version: .+$/m, "version: 0.2.0"));
  }) as unknown as typeof fetch;
  await expect(releaseManifest({ version, asset }, fetchWrongVersion, publicBase)).rejects.toThrow("does not match");
});

test("version comparison is numeric and never marks a downgrade as newer", () => {
  expect(newerVersion("0.10.0", "0.9.0")).toBe(true);
  expect(newerVersion("0.9.0", "0.10.0")).toBe(false);
  expect(newerVersion(version, version)).toBe(false);
});
