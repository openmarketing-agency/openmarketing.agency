/** Turns saved agent profile IDs such as `seo__content_writer` into readable names. */

export function agentRole(id: string) {
  return id.split("__").at(-1) || id;
}

export function agentDisplayName(agent: { id: string; name: string }) {
  if (agent.name && agent.name !== agent.id) return agent.name;
  return agentRole(agent.id).split(/[-_]+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ") || agent.id;
}

export function agentInitials(name: string) {
  const [first = "?", second] = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  return (second ? first[0] + second[0] : first.slice(0, 2)).toUpperCase();
}
