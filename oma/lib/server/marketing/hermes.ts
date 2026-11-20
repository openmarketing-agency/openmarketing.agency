import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Clarification, Stage } from "./state";

type Profile = "oma-onboarding" | `oma-seo-${Stage}`;
export type Run = { run_id: string; status: string; output?: string; pending_controls?: Clarification[] };

export class HermesUnavailable extends Error {}
export class HermesRunError extends Error {
  constructor(readonly status: number) { super("Hermes could not complete this request."); }
}

export function hermesConfigured() {
  return Boolean(process.env.OMA_HERMES_GATEWAY_URL && process.env.OMA_HERMES_SEED_FILE);
}

async function request<T>(profile: Profile, path: string, body?: object, idempotencyKey?: string): Promise<T> {
  if (!hermesConfigured()) throw new HermesUnavailable("Start the full OMA stack to use Hermes.");
  let response: Response;
  try {
    const origin = new URL(process.env.OMA_HERMES_GATEWAY_URL!);
    const seed = await readFile(process.env.OMA_HERMES_SEED_FILE!, "utf8");
    if (!seed) throw new Error("The runtime key has not been created.");
    const key = createHmac("sha256", seed).update(profile).digest("hex");
    response = await fetch(new URL(`/p/${profile}/v1/runs${path}`, origin), {
      method: body ? "POST" : "GET",
      cache: "no-store",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body && { "Content-Type": "application/json" }),
        ...(idempotencyKey && { "Idempotency-Key": idempotencyKey }),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new HermesUnavailable("Hermes is unavailable. Try again shortly.");
  }
  if (!response.ok) throw new HermesRunError(response.status);
  return response.json() as Promise<T>;
}

export function startRun(profile: Profile, key: string, input: string, session?: string, instructions?: string) {
  return request<Run>(profile, "", { input, session_id: session, instructions }, key);
}

export function getRun(profile: Profile, id: string) {
  return request<Run>(profile, `/${encodeURIComponent(id)}`);
}

export function answerRun(profile: Profile, id: string, prompt: Clarification, answer: string) {
  return request(profile, `/${encodeURIComponent(id)}/clarify`, {
    request_id: prompt.prompt_id, execution_generation: prompt.execution_generation, answer,
  });
}

export function terminalRun(status: string) {
  return ["completed", "failed", "cancelled", "interrupted", "unknown"].includes(status);
}
