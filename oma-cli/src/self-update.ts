import { chmodSync, lstatSync, mkdtempSync, realpathSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { run } from "./docker";
import { extract, withVerifiedArchive, type Latest } from "./update";

export const cliPath = "/usr/local/bin/oma";

export function requireManagedCli(): string {
  if (process.platform !== "linux" || process.arch !== "x64" || process.getuid?.() !== 0) {
    throw new Error("CLI upgrades require root on x86-64 Linux. Run sudo oma cli upgrade.");
  }
  if (realpathSync(process.execPath) !== cliPath) throw new Error(`Install the CLI at ${cliPath} before using self-upgrade.`);
  for (const path of ["/usr", "/usr/local", "/usr/local/bin", cliPath]) {
    const st = lstatSync(path);
    if (st.uid !== 0 || (st.mode & 0o022) !== 0 || (path === cliPath ? !st.isFile() : !st.isDirectory())) {
      throw new Error(`${path} must be root-owned, not a symlink, and not writable by group or others.`);
    }
  }
  return cliPath;
}

export async function replaceCli(release: Latest, destination: string): Promise<void> {
  await withVerifiedArchive(release, "cli", (archive) => {
    // Stage on the destination filesystem so rename is atomic and leaves the old CLI intact on failure.
    const stage = mkdtempSync(join(dirname(destination), ".oma-upgrade-"));
    try {
      const executable = join(stage, "oma");
      extract(archive, `${release.asset.slice(0, -7)}/oma`, executable);
      chmodSync(executable, 0o755);
      if (run(executable, ["--version"], true).trim() !== release.version) {
        throw new Error("Downloaded CLI version does not match the published release tag.");
      }
      console.error(`==> Replacing ${destination}`);
      renameSync(executable, destination);
    } finally { rmSync(stage, { recursive: true, force: true }); }
  });
}
