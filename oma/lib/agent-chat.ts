/** Describes the chat states and controls shared by the agent client and the console. */

import type { ChatToolCall } from "./agent-activity";

export const maxChatMessageLength = 16_000;

export type AgentStatus = { ready: true } | { ready: false; message: string };

export type AgentPrompt = {
  id: string;
  generation: number;
} & (
  | { kind: "clarify"; question: string; choices: string[]; multiSelect: boolean }
  | { kind: "approval"; description: string; command: string }
);

export type ActiveAgentRun = {
  status: "running";
  phase: "queued" | "running" | "waiting_for_answer" | "waiting_for_approval" | "stopping";
  prompt?: AgentPrompt;
  tool?: string;
  updatedAt?: string;
};

export type AgentRun =
  | ActiveAgentRun
  | { status: "completed"; answer: string; pendingSteer?: string }
  | { status: "failed"; pendingSteer?: string };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "notification";
  text: string;
};

export type ChatMessagePage = { messages: ChatMessage[]; nextOffset: number | null };
export type ChatTranscript = ChatMessagePage & { recordedTools?: ChatToolCall[] };

export type ChatHistory = {
  chats: Array<{ id: string; title: string }>;
  active?: ChatTranscript & { id: string; isProjectSetup?: boolean; handle?: string | null };
  error?: string;
};
