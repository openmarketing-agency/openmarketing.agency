"use server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireUser, requireAccessToken } from "@/lib/dal";
import {
  appOrigin,
  connectionSnapshot,
  toolConnections,
  toolCatalog,
} from "@/lib/composio";
import { disconnectCampaign, queueCampaign } from "@/lib/server/marketing/state";
import {
  connectionScope,
  playbookToolSlugs,
  WORKSPACE_SCOPE,
  type AgentConnectionScope,
} from "@/lib/agent-connections";
import { listToolAssignments, saveToolAssignment } from "@/lib/backend";
import {
  hostedMcpConnection,
  type HostedMcpConnection,
} from "@/lib/mcp-client-config";
import { accessCookieOptions } from "@/lib/cookies";
import {
  CONNECTION_COOKIE,
  CONNECTION_CALLBACK_PATH,
  CONNECTION_ATTEMPT_MAX_AGE,
} from "@/lib/connection-attempt";
import { type CatalogQuery, toolkitSlug } from "@/lib/tool-catalog";
import { ToolConnectionConfigurationError } from "@/lib/tool-connection-service";

export async function refreshConnectionsAction() {
  const user = await requireUser();
  return connectionSnapshot(user.id);
}
export async function searchToolCatalogAction(query: CatalogQuery) {
  await requireUser();
  try {
    return { page: await (await toolCatalog()).list(query) };
  } catch {
    return { error: "We couldn’t load the tool catalog. Try again." };
  }
}
export async function toolCategoriesAction() {
  await requireUser();
  try {
    return { categories: await (await toolCatalog()).categories() };
  } catch {
    return {
      error: "Categories couldn’t be loaded. You can still search for tools.",
    };
  }
}
export async function assignToolAction(
  slug: string,
  scope: AgentConnectionScope,
  assigned: boolean,
) {
  const user = await requireUser();
  try {
    connectionScope(user.id, scope);
    const tool = await (await toolCatalog()).get(slug);
    const result = await saveToolAssignment(
      await requireAccessToken(),
      scope.playbookId,
      scope.agentId,
      slug,
      assigned,
    );
    if (!result.ok) return { error: result.error.message };
    return { tool };
  } catch {
    return { error: "We couldn’t update this tool selection. Try again." };
  }
}
export async function connectToolAction(
  toolId: string,
  scope: AgentConnectionScope = WORKSPACE_SCOPE,
): Promise<{ url?: string; connected?: boolean; error?: string }> {
  const user = await requireUser();
  try {
    const context = connectionScope(user.id, scope);
    const slug = toolkitSlug(toolId);
    const tool = await (await toolCatalog()).get(slug);
    const nonce = randomBytes(32).toString("hex");
    const callbackUrl = new URL(CONNECTION_CALLBACK_PATH, appOrigin());
    callbackUrl.searchParams.set("state", nonce);
    const result = await (await toolConnections()).connect(
      user.id,
      slug,
      callbackUrl.toString(),
    );
    // Save selection after a successful link creation; consent may still be pending.
    if (scope.playbookId !== "workspace" || tool.noAuth) {
      const saved = await saveToolAssignment(
        await requireAccessToken(),
        scope.playbookId,
        scope.agentId,
        slug,
        true,
      );
      if (!saved.ok) return { error: saved.error.message };
    }
    if (result.connected) {
      queueCampaign(user.id, slug);
      return { connected: true };
    }
    const attempt = {
      userId: user.id,
      ownerId: user.id,
      playbookId: scope.playbookId,
      agentId: scope.agentId,
      toolId: slug,
      authConfigId: result.authConfigId,
      accountId: result.accountId,
      nonce,
      returnTo: context.returnTo,
      createdAt: Date.now(),
    };
    (await cookies()).set(CONNECTION_COOKIE, JSON.stringify(attempt), {
      ...accessCookieOptions(CONNECTION_ATTEMPT_MAX_AGE),
      path: CONNECTION_CALLBACK_PATH,
    });
    return { url: result.url };
  } catch (error) {
    return {
      error:
        error instanceof ToolConnectionConfigurationError
          ? error.message
          : "We couldn’t start the connection. Please try again.",
    };
  }
}
export async function disconnectToolAction(slug: string) {
  const user = await requireUser();
  try {
    const tool = await (await toolCatalog()).get(slug);
    if (tool.noAuth) {
      const token = await requireAccessToken();
      const saved = await listToolAssignments(token);
      if (!saved.ok) return { error: saved.error.message };
      const results = await Promise.all(
        saved.data
          .filter((item) => item.toolkit_slug === slug)
          .map((item) =>
            saveToolAssignment(
              token,
              item.playbook_id,
              item.agent_id,
              slug,
              false,
            ),
          ),
      );
      if (results.some((result) => !result.ok))
        return {
          error:
            "We couldn’t remove all selections for this tool. Refresh and try again.",
        };
    } else await (await toolConnections()).disconnect(user.id, slug);
    disconnectCampaign(user.id, slug);
    return { snapshot: await connectionSnapshot(user.id) };
  } catch {
    return { error: "We couldn’t disconnect this tool. Please try again." };
  }
}
export async function generateMcpAction(
  playbookId: string,
): Promise<{ connection?: HostedMcpConnection; error?: string }> {
  const user = await requireUser();
  try {
    const saved = await listToolAssignments(await requireAccessToken());
    if (!saved.ok) return { error: saved.error.message };
    const slugs = playbookToolSlugs(playbookId, saved.data);
    const session = await (await toolConnections()).mcpSession(user.id, slugs);
    return { connection: hostedMcpConnection(session.mcp) };
  } catch (error) {
    return {
      error:
        error instanceof Error &&
        /^(Assign at least|Connect or remove)/.test(error.message)
          ? error.message
          : "We couldn’t generate your playbook MCP URL. Check your connections and try again.",
    };
  }
}
