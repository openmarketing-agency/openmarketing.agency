/** Reads activity for the configured agent and the signed-in account’s saved onboarding run. */

import type { AgentActivity } from "@/lib/agent-activity";
import { AgentChatError, getAgentActivityCounts, getAgentRunProgress } from "./agent-chat";
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
