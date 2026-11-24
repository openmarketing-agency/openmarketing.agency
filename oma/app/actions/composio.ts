"use server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/dal";
import {
  appOrigin,
  connectionSnapshot,
  toolConnections,
  toolCatalog,
} from "@/lib/composio";
import {
  connectionScope,
  isWorkspaceScope,
  WORKSPACE_SCOPE,
  type ToolConnectionScope,
} from "@/lib/agent-connections";
import { changeToolSelection, readSelectedToolSlugs, selectionError } from "@/lib/tool-workspace";
import { accessCookieOptions } from "@/lib/cookies";
import {
  CONNECTION_COOKIE,
  CONNECTION_CALLBACK_PATH,
  CONNECTION_ATTEMPT_MAX_AGE,
} from "@/lib/connection-attempt";
import { type CatalogQuery, toolkitSlug } from "@/lib/tool-catalog";
import { ToolConnectionConfigurationError } from "@/lib/tool-connection-service";
import { loadAgentWorkspace, WorkspaceRequestError } from "@/lib/server/agent-workspace";

export async function refreshConnectionsAction(scope: ToolConnectionScope = WORKSPACE_SCOPE) {
  const user = await requireUser();
  connectionScope(user.id, scope);
  const [snapshot, selections] = await Promise.all([
    connectionSnapshot(user.id),
    (isWorkspaceScope(scope) ? readSelectedToolSlugs() : Promise.resolve(undefined)).then(
      (selected) => ({ selected, error: undefined }),
      (error: unknown) => ({ selected: undefined, error: selectionError(error) }),
    ),
  ]);
  return { snapshot, ...selections };
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
export async function connectToolAction(
  toolId: string,
  scope: ToolConnectionScope = WORKSPACE_SCOPE,
): Promise<{ url?: string; connected?: boolean; error?: string }> {
  const user = await requireUser();
  try {
    const context = connectionScope(user.id, scope);
    const campaignId = isWorkspaceScope(scope) ? null : scope.playbookId;
    const slug = toolkitSlug(toolId);
    if (campaignId !== null) {
      const { records, error } = await loadAgentWorkspace();
      if (error) return { error };
      const campaign = records?.campaigns.find((item) => item.id === campaignId);
      if (!campaign) return { error: "Campaign not found." };
      if (!campaign.requiredIntegrations?.some((required) => required.slug === slug)) {
        return { error: "This toolkit is not configured for the campaign." };
      }
    }
    const tool = await (await toolCatalog()).get(slug);
    const nonce = randomBytes(32).toString("hex");
    const callbackUrl = new URL(CONNECTION_CALLBACK_PATH, appOrigin());
    callbackUrl.searchParams.set("state", nonce);
    const result = await (await toolConnections()).connect(
      user.id,
      slug,
      callbackUrl.toString(),
    );
    if (campaignId === null && tool.noAuth) {
      try {
        await changeToolSelection(slug, true);
      } catch (error) {
        return { error: selectionError(error) };
      }
    }
    if (result.connected) return { connected: true };
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
    if (!tool.noAuth) await (await toolConnections()).disconnect(user.id, slug);
    const selected = tool.noAuth ? await changeToolSelection(slug, false) : undefined;
    return { snapshot: await connectionSnapshot(user.id), selected };
  } catch (error) {
    return { error: error instanceof WorkspaceRequestError
      ? selectionError(error) : "We couldn’t disconnect this tool. Please try again." };
  }
}
