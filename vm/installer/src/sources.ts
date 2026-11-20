import { exists, parseSpec } from "./playbook";
import { join, resolve } from "node:path";

// A bare ID resolves to the repository's campaigns/ directory. In the VM
// build the same sources are staged at the legacy path recorded by the registry.
const checkoutCampaigns = resolve(import.meta.dir, "..", "..", "..", "campaigns");
const bundledCampaigns = resolve(import.meta.dir, "..", "..", "playbooks");

export async function withPlaybookSources<T>(
  spec: string, skillsDir: string | undefined,
  use: (resolvedSpec: string, resolvedSkillsDir?: string) => Promise<T>,
): Promise<T> {
  const { version } = parseSpec(spec);
  const name = version === undefined ? spec : spec.slice(0, spec.lastIndexOf(":"));
  let path = name;
  if (/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) {
    const root = await exists(checkoutCampaigns) ? checkoutCampaigns : bundledCampaigns;
    path = join(root, name);
    if (!await exists(path)) throw new Error(`Campaign ${name} was not found (expected ${path}); use a bundled campaign ID or a local directory path`);
  }
  return use(version === undefined ? path : `${path}:${version}`, skillsDir);
}
