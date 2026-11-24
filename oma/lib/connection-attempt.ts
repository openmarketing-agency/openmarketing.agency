import { connectionScope } from "./agent-connections.ts";
import { findCampaign } from "./campaigns.ts";
import { validToolkitSlug } from "./tool-catalog.ts";
import type { ConnectionAttempt } from "./tool-connection-service.ts";
export const CONNECTION_COOKIE = "oma_tool_connection";
export const CONNECTION_CALLBACK_PATH = "/api/connections/callback";
export const CONNECTION_ATTEMPT_MAX_AGE = 600;

export function connectionReturnTo(campaignId?: string): string {
  if (!campaignId) return "/connections";
  if (!findCampaign(campaignId)) throw new Error("Unknown campaign.");
  return `/campaigns/${campaignId}`;
}
export function readConnectionAttempt(
  raw: string | undefined,
  userId: string,
  nonce: string | null,
  deferred: boolean,
  now = Date.now(),
): ConnectionAttempt | null {
  if (!raw || raw.length > 4096) return null;
  try {
    const attempt = JSON.parse(raw) as ConnectionAttempt;
    if (
      (attempt.ownerId ?? attempt.userId) !== userId ||
      !validToolkitSlug(attempt.toolId) ||
      typeof attempt.accountId !== "string" ||
      !attempt.accountId ||
      typeof attempt.authConfigId !== "string" ||
      !attempt.authConfigId ||
      typeof attempt.nonce !== "string" ||
      attempt.nonce.length < 32 ||
      !Number.isFinite(attempt.createdAt) ||
      now < attempt.createdAt ||
      now - attempt.createdAt >= CONNECTION_ATTEMPT_MAX_AGE * 1000
    )
      return null;
    if (!deferred && nonce !== attempt.nonce) return null;
    if (attempt.playbookId || attempt.agentId) {
      const context = connectionScope(userId, {
        playbookId: attempt.playbookId ?? "",
        agentId: attempt.agentId ?? "",
      });
      // A connection started before the rename can still have the old path in its cookie.
      const legacyReturnTo = context.returnTo.replace(/^\/campaigns\//, "/playbooks/");
      if (
        attempt.userId !== context.connectionUserId ||
        (attempt.returnTo !== context.returnTo && attempt.returnTo !== legacyReturnTo)
      )
        return null;
      return { ...attempt, returnTo: context.returnTo };
    } else if (attempt.userId !== userId || attempt.returnTo !== "/connections")
      return null;
    return attempt;
  } catch {
    return null;
  }
}
export function connectionFeedback(
  value: string | string[] | undefined,
): string | undefined {
  const messages: Record<string, string> = {
    connected:
      "Your connection status has been updated. Current tool access is shown below.",
    "connected-sync-failed":
      "Tool connected. Review the required tools and save them again to retry syncing.",
    pending:
      "Authorization is still pending. Finish signing in, then refresh the connections.",
    failed:
      "The connection could not be completed. Try connecting the tool again.",
    expired: "The connection attempt expired. Start a new connection.",
  };
  return typeof value === "string" ? messages[value] : undefined;
}
