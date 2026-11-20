import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CampaignProfile } from "@/lib/marketing-playbook";
import type { Clarification } from "./state";

type Profile = "oma-onboarding" | CampaignProfile;
export type Run = { run_id: string; status: string; output?: string; pending_controls?: Clarification[] };

export class HermesUnavailable extends Error {}
export class HermesRunError extends Error {
  constructor(readonly status: number) { super("Hermes could not complete this request."); }
}

export function hermesConfigured() {
  return Boolean(process.env.OMA_CAMPAIGN_GATEWAY_URL && process.env.OMA_CAMPAIGN_KEY_DIR);
}

async function request<T>(profile: Profile, path: string, body?: object, idempotencyKey?: string): Promise<T> {
  if (!hermesConfigured()) throw new HermesUnavailable("Start the full OMA stack to use Hermes.");
  let response: Response;
  try {
    const origin = new URL(process.env.OMA_CAMPAIGN_GATEWAY_URL!);
    const key = (await readFile(join(process.env.OMA_CAMPAIGN_KEY_DIR!, `${profile}.key`), "utf8")).trim();
    if (!/^[0-9a-f]{64}$/.test(key)) throw new Error("The runtime key is invalid.");
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
  if (!response.ok) {
    await response.body?.cancel();
    throw new HermesRunError(response.status);
  }
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
