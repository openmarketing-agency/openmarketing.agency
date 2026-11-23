/** Describes the chat states and controls shared by the agent client and the console. */

export const maxChatMessageLength = 16_000;

export type AgentStatus = { ready: true } | { ready: false; message: string };

export type AgentPrompt = {
  id: string;
  generation: number;
} & (
  | { kind: "clarify"; question: string; choices: string[]; multiSelect: boolean }
  | { kind: "approval"; description: string; command: string }
);

export type AgentRun =
  | { status: "running"; prompt?: AgentPrompt }
  | { status: "completed"; answer: string }
  | { status: "failed" };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type ChatMessagePage = { messages: ChatMessage[]; nextOffset: number | null };

export type ChatHistory = {
  chats: Array<{ id: string; title: string }>;
  active?: ChatMessagePage & { id: string };
  error?: string;
};
