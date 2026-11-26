import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, createReadStream, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./docker";
import { parseManifest, releaseVersion } from "./release";

const repository = "openmarketing-agency/openmarketing.agency";
export const stableVersion = /^\d+\.\d+\.\d+$/;
const setupAsset = (tag: string) => `oma-setup-${tag}-linux-amd64.tar.gz`;
declare const OMA_BUILD_R2_PUBLIC_URL: string;

export type Latest = { version: string; asset: string };
const cliAsset = (tag: string) => `oma-cli-${tag}-linux-amd64.tar.gz`;
type Channel = "stack" | "cli";
const channel = (kind: Channel) => kind === "stack"
  ? { tagPrefix: "v", asset: setupAsset, index: "versions/index.json" }
  : { tagPrefix: "oma-cli-v", asset: cliAsset, index: "oma-cli/versions/index.json" };

export function r2Url(key: string, base = (typeof OMA_BUILD_R2_PUBLIC_URL !== "undefined" && OMA_BUILD_R2_PUBLIC_URL) || process.env.OMA_R2_PUBLIC_URL): string {
  if (!base) throw new Error("Set OMA_R2_PUBLIC_URL to the public OMA R2 HTTPS base URL.");
  let url: URL;
  try { url = new URL(base); } catch { throw new Error("OMA_R2_PUBLIC_URL must be a valid HTTPS base URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("OMA_R2_PUBLIC_URL must be an HTTPS base URL without credentials, a query, or a fragment.");
  }
  return `${url.href.replace(/\/+$/, "")}/${key}`;
}

export function newerVersion(latest: string, installed: string): boolean {
  const a = latest.split(".").map(Number);
  const b = installed.split(".").map(Number);
  for (let n = 0; n < 3; n++) if (a[n] !== b[n]) return a[n] > b[n];
  return false;
}

export async function latestRelease(request: typeof fetch = fetch, kind: Channel = "stack", base?: string): Promise<Latest | null> {
  const [version] = await availableVersions(request, kind, base);
  return version === undefined ? null : { version, asset: channel(kind).asset(`v${version}`) };
}

export async function availableVersions(request: typeof fetch = fetch, kind: Channel = "stack", base?: string): Promise<string[]> {
  const { index } = channel(kind);
  const response = await request(r2Url(index, base), { redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Could not read R2 version index ${index} (HTTP ${response.status}).`);
  const body: { versions?: unknown } | null = await response.json().catch(() => null);
  const versions = body?.versions;
  if (!Array.isArray(versions) || !versions.every((version): version is string => typeof version === "string" && stableVersion.test(version))) {
    throw new Error(`Invalid R2 version index ${index}.`);
  }
  return [...new Set(versions)].sort((a, b) => newerVersion(a, b) ? -1 : newerVersion(b, a) ? 1 : 0);
}

export async function releaseByVersion(version: string, request: typeof fetch = fetch, kind: Channel = "stack", base?: string): Promise<Latest> {
  const product = kind === "stack" ? "OMA" : "oma-cli";
  if (!stableVersion.test(version)) throw new Error("Use a release version in X.Y.Z format, without a v prefix.");
  if (!(await availableVersions(request, kind, base)).includes(version)) {
    throw new Error(`${product} ${version} is not listed in R2. Run ${kind === "stack" ? "oma versions" : "oma cli versions"} to list available releases.`);
  }
  return { version, asset: channel(kind).asset(`v${version}`) };
}

export async function releaseManifest(release: Latest, request: typeof fetch = fetch, base?: string) {
  if (!stableVersion.test(release.version)) throw new Error("Invalid OMA release version.");
  const response = await request(r2Url(`versions/${release.version}.yaml`, base), {
    redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Could not read the release component pins (HTTP ${response.status}).`);
  const manifest = parseManifest(await response.text());
  if (manifest.version !== release.version) throw new Error("Published versions.yaml does not match the release tag.");
  return manifest;
}

export function expectedChecksum(checksums: string, asset: string): string {
  const entries = checksums.split(/\r?\n/).map((line) => /^([a-f0-9]{64}) [ *](.+)$/.exec(line));
  const matches = entries.filter((entry) => entry?.[2] === asset);
  if (matches.length !== 1) throw new Error(`SHA256SUMS must contain exactly one checksum for ${asset}.`);
  return matches[0]![1];
}

export function extract(archive: string, member: string, path: string): void {
  // Stream named members to files we opened, never extract archive-supplied paths as root.
  const fd = openSync(path, "wx", 0o600);
  try {
    const result = spawnSync("tar", ["-xOzf", archive, "--", member], { stdio: ["ignore", fd, "inherit"] });
    if (result.error || result.status !== 0) throw new Error(`Could not extract ${member}.`);
  } finally { closeSync(fd); }
}

export async function withVerifiedArchive(release: Latest, kind: "stack" | "cli", use: (archive: string, work: string) => void): Promise<void> {
  const { tagPrefix, asset } = channel(kind);
  if (!/^\d+\.\d+\.\d+$/.test(release.version) || release.asset !== asset(`v${release.version}`)) throw new Error("Invalid release asset.");
  const work = mkdtempSync(join(tmpdir(), "oma-release-"));
  try {
    const archive = join(work, release.asset);
    const sums = join(work, "SHA256SUMS");
    const url = `https://github.com/${repository}/releases/download/${tagPrefix}${release.version}`;
    console.error(`==> Downloading ${release.asset}`);
    for (const [asset, path] of [[release.asset, archive], ["SHA256SUMS", sums]]) {
      run("curl", ["--proto", "=https", "--proto-redir", "=https", "-fsSL", "--retry", "2", "--max-time", "180", `${url}/${asset}`, "-o", path]);
    }
    console.error(`==> Verifying ${release.asset}`);
    const expected = expectedChecksum(readFileSync(sums, "utf8"), release.asset);
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(archive)) digest.update(chunk);
    if (digest.digest("hex") !== expected) throw new Error(`SHA-256 mismatch for ${release.asset}; nothing was installed.`);
    use(archive, work);
  } finally { rmSync(work, { recursive: true, force: true }); }
}

export const runtimeFiles = ["install.sh", "workspace.py", "campaign_activity.py", "custom_mcp.py", "sync_standalone.py"];

export async function withStackBundle(release: Latest, apply: (bundle: string) => void): Promise<void> {
  return withVerifiedArchive(release, "stack", (archive, work) => {
    const bundle = join(work, "setup");
    mkdirSync(bundle, { mode: 0o700 });
    const prefix = `${release.asset.replace(/\.tar\.gz$/, "")}/setup`;
    for (const file of ["versions.yaml", ...runtimeFiles]) extract(archive, `${prefix}/${file}`, join(bundle, file));
    if (releaseVersion(bundle) !== release.version) throw new Error("Downloaded installer version does not match the published release tag.");
    apply(bundle);
  });
}
