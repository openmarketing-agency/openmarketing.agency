/** Reads activity for the configured agent and the signed-in account’s saved onboarding run. */

import type { AgentActivity } from "@/lib/agent-activity";
import { AgentChatError, getAgentActivityCounts, getAgentRunProgress, streamAgentRunActivity } from "./agent-chat";
import { readProjectSetup } from "./project-setup";

async function readCounts(): Promise<AgentActivity["gateway"]> {
  try {
    return await getAgentActivityCounts();
  } catch (error) {
    if (error instanceof AgentChatError) return null;
    throw error;
  }
}

async function readSetupProgress(userId: string): Promise<AgentActivity["setup"]> {
  const project = readProjectSetup(userId);
  if (project?.setup.status !== "done") return null;
  const handle = project.delivery?.runHandle;
  if (!handle) return { status: "not_sent" };

  try {
    return await getAgentRunProgress(userId, handle);
  } catch (error) {
    if (!(error instanceof AgentChatError)) throw error;
    return { status: error.status === 404 ? "unavailable" : "connection_lost" };
  }
}

export async function readDashboardAgentActivity(userId: string): Promise<AgentActivity> {
  const [gateway, setup] = await Promise.all([readCounts(), readSetupProgress(userId)]);
  return { gateway, setup };
}

/** Resolve the saved account-owned setup run on the server before opening its event stream. */
export async function streamDashboardAgentActivity(userId: string, signal: AbortSignal) {
  const project = readProjectSetup(userId);
  const handle = project?.setup.status === "done" ? project.delivery?.runHandle : undefined;
  if (!handle) return null;
  try {
    return await streamAgentRunActivity(userId, handle, signal);
  } catch (error) {
    if (error instanceof AgentChatError) return null;
    throw error;
  }
}
