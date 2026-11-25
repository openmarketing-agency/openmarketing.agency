/** Describes the live gateway counts and saved onboarding run state shown in workspace chat. */

import type { AgentPrompt } from "./agent-chat";

export type AgentRunProgress = {
  status: "queued" | "running" | "waiting_for_answer" | "waiting_for_approval" | "stopping"
    | "completed" | "failed" | "cancelled" | "unknown";
  tool?: string;
  updatedAt?: string;
  message?: string;
  failureReason?: string;
  prompt?: AgentPrompt;
  outputTokens?: number;
  reasoningTokens?: number;
};

export type AgentActivity = {
  gateway: { activeRuns: number; activeAgents: number } | null;
  setup: AgentRunProgress | { status: "not_sent" | "unavailable" | "connection_lost" } | null;
};

export type AgentActivityUpdate = { seq?: number } & (
  | { phase: "writing" | "update"; message?: string }
  | { phase: "delegation"; message?: never; child: { id: string; status: "started" | "completed" | "failed" | "stopped"; label?: string } }
);
