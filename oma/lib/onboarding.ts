/** Shares the setup transcript and the current step with the onboarding screen. */

import type { AgentPrompt } from "./agent-chat";

export const maxSetupAnswerLength = 1000;

export function isOnboardingDocumentRequest(headers: Headers) {
  return headers.get("sec-fetch-dest") === "document" && headers.get("sec-fetch-mode") === "navigate"
    && !headers.has("sec-purpose");
}

export type SetupQuestion = Extract<AgentPrompt, { kind: "clarify" }>;
export type SetupExchange = { question: string; answer: string };

export type OnboardingView = {
  history: SetupExchange[];
  step:
    | { status: "intro" | "closed" }
    | { status: "running"; question?: SetupQuestion }
    | { status: "failed" | "ready"; message: string };
};
