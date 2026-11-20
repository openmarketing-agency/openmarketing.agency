/** Stores toolkit selections for specialists and the local workspace. */

import { getDb } from "@/lib/db";

import { ErrorCode, apiError } from "../common/api-error";
import type { ToolAssignment } from "@/lib/agent-connections";

const SPECIALISTS = new Set(["researcher", "writer", "humanizer", "verifier", "publisher"]);
const TOOLKIT_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/;

export function listAssignments(userId: string): ToolAssignment[] {
  return getDb().prepare(`
    SELECT playbook_id, agent_id, toolkit_slug FROM tool_assignments
    WHERE user_id = ? ORDER BY playbook_id, agent_id, toolkit_slug
  `).all(userId) as unknown as ToolAssignment[];
}

export function saveAssignment(userId: string, playbookId: string, agentId: string, toolkitSlug: string, assigned: boolean): void {
  const knownScope = (playbookId === "seo" && SPECIALISTS.has(agentId))
    || (playbookId === "workspace" && agentId === "connections");
  if (!knownScope || !TOOLKIT_SLUG_PATTERN.test(toolkitSlug)) {
    throw apiError(422, ErrorCode.INVALID_TOOL_ASSIGNMENT);
  }

  const db = getDb();
  if (assigned) {
    db.prepare(`
      INSERT INTO tool_assignments (user_id, playbook_id, agent_id, toolkit_slug) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, playbook_id, agent_id, toolkit_slug) DO NOTHING
    `).run(userId, playbookId, agentId, toolkitSlug);
  } else {
    db.prepare(`
      DELETE FROM tool_assignments WHERE user_id = ? AND playbook_id = ? AND agent_id = ? AND toolkit_slug = ?
    `).run(userId, playbookId, agentId, toolkitSlug);
  }
}
