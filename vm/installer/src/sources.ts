import { exists, parseSpec } from "./playbook";
import { join, resolve } from "node:path";

// Playbooks and skills ship with this checkout: a bare playbook ID resolves to
// ./playbooks/<id>, and each playbook's skill dependencies come from the sibling
// ./skills tree resolved by loadPlaybook. There is no remote source, source URL,
// environment setting or download step.
export const playbooksRoot = resolve(import.meta.dir, "..", "..", "playbooks");

export async function withPlaybookSources<T>(
  spec: string, skillsDir: string | undefined,
  use: (resolvedSpec: string, resolvedSkillsDir?: string) => Promise<T>,
): Promise<T> {
  const { version } = parseSpec(spec);
  const name = version === undefined ? spec : spec.slice(0, spec.lastIndexOf(":"));
  let path = name;
  if (/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) {
    path = join(playbooksRoot, name);
    if (!await exists(path)) throw new Error(`Playbook ${name} is not in this checkout (expected ${path}); use a playbook ID from playbooks/ or a local directory path`);
  }
  return use(version === undefined ? path : `${path}:${version}`, skillsDir);
}
