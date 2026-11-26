/** Identifies a saved document the default agent can design: brand knowledge, playbook strategy, or a research file. */

export type DocumentTarget = { kind: "brand" | "playbook" | "research"; id: string; documentId?: string };
