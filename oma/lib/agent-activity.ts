/** Describes the live gateway counts and saved onboarding run state shown on the dashboard. */

export type AgentRunProgress = {
  status: "queued" | "running" | "waiting_for_answer" | "waiting_for_approval" | "stopping"
    | "completed" | "failed" | "cancelled" | "unknown";
  tool?: string;
  updatedAt?: string;
  message?: string;
  outputTokens?: number;
  reasoningTokens?: number;
};

export type AgentActivity = {
  gateway: { activeRuns: number; activeAgents: number } | null;
  setup: AgentRunProgress | { status: "not_sent" | "unavailable" | "connection_lost" } | null;
};

export type AgentActivityUpdate = {
  phase: "writing" | "update";
  message?: string;
};
