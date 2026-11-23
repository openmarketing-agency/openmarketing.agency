/** Tracks whether this account has finished the initial model sync for both built-in agents. */

import "server-only";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";

export function needsAgentSetup(userId: string) {
  return Boolean(process.env.OMA_WORKSPACE_SOCKET)
    && getDb().prepare("SELECT agent_setup_complete FROM users WHERE id = ?").get(userId)?.agent_setup_complete !== 1;
}

export function requireAgentSetup(userId: string) {
  if (needsAgentSetup(userId)) redirect("/agent-setup");
}

export function completeAgentSetup(userId: string) {
  getDb().prepare("UPDATE users SET agent_setup_complete = 1 WHERE id = ?").run(userId);
}
