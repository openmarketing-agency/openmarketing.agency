import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb, writeTransaction } from "@/lib/db";

export const propertySchema = z.string().trim().max(500).refine((value) => {
  if (/^sc-domain:[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(value)) return true;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      && !url.search && !url.hash && value.endsWith("/");
  } catch {
    return false;
  }
}, "Use a Search Console property such as sc-domain:example.com or https://example.com/.");

const note = z.string().trim().min(1).max(2000);
export const briefSchema = z.object({
  brand: z.object({ name: note, audience: note, voice: note, assets: z.array(note).max(12) }),
  knowledge: z.array(note).min(1).max(12),
  playbook: z.object({ title: note, goal: note, property: propertySchema, approach: note }),
});

export type Brief = z.infer<typeof briefSchema>;
export type Message = { role: "user" | "assistant"; text: string };
export type Clarification = { kind: "clarify"; prompt_id: string; execution_generation: number; question: string; choices: string[] };
export type PendingTurn = { id: string; text: string; kind: "chat" | "finalize"; runId?: string; property?: string };
export type Onboarding = { session: string; messages: Message[]; pending?: PendingTurn; error?: string };
export type Stage = "researcher" | "writer" | "verifier";
export type Work = {
  id: string;
  stage: Stage;
  account: string;
  evidence: string;
  runId?: string;
  research?: string;
  draft?: string;
};
export type Campaign = {
  brief: Brief;
  status: "waiting" | "running" | "active" | "paused" | "error";
  work?: Work;
  report?: { draft: string; review: string; property: string; finishedAt: number };
  notice?: string;
};
export type OnboardingView = {
  onboarding?: Onboarding;
  campaign?: Campaign;
  question?: Clarification;
  requestError?: string;
};

type Row = { user_id: string; onboarding: string; campaign: string | null };

function decode(row?: Row) {
  return {
    onboarding: row ? JSON.parse(row.onboarding) as Onboarding : undefined,
    campaign: row?.campaign ? JSON.parse(row.campaign) as Campaign : undefined,
  };
}

export function workspace(userId: string) {
  const row = getDb().prepare("SELECT * FROM marketing_workspaces WHERE user_id = ?").get(userId);
  return decode(row as Row | undefined);
}

export function beginTurn(userId: string, text: string, kind: PendingTurn["kind"], property?: string) {
  const db = getDb();
  return writeTransaction(db, () => {
    const current = workspace(userId);
    if (current.campaign) throw new Error("This workspace is already set up.");
    const onboarding = current.onboarding ?? { session: randomUUID(), messages: [] };
    if (onboarding.pending) throw new Error("Finish the current turn first.");
    if (onboarding.messages.length >= 60 && kind === "chat") throw new Error("Save your setup to finish this conversation.");
    if (kind === "finalize" && !onboarding.messages.some((message) => message.role === "user")) {
      throw new Error("Tell Hermes about your business before saving.");
    }
    const updated: Onboarding = {
      ...onboarding, error: undefined, pending: { id: randomUUID(), text, kind, property },
      messages: kind === "chat" ? [...onboarding.messages, { role: "user", text }] : onboarding.messages,
    };
    db.prepare(`
      INSERT INTO marketing_workspaces (user_id, onboarding) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET onboarding = excluded.onboarding
    `).run(userId, JSON.stringify(updated));
    return updated;
  });
}

export function storeRunId(userId: string, pendingId: string, runId: string) {
  getDb().prepare(`
    UPDATE marketing_workspaces SET onboarding = json_set(onboarding, '$.pending.runId', ?)
    WHERE user_id = ? AND json_extract(onboarding, '$.pending.id') = ?
      AND json_extract(onboarding, '$.pending.runId') IS NULL
  `).run(runId, userId, pendingId);
}

export function finishTurn(userId: string, pending: PendingTurn, result: { message?: string; brief?: Brief; error?: string }) {
  const db = getDb();
  writeTransaction(db, () => {
    const { onboarding } = workspace(userId);
    if (onboarding?.pending?.id !== pending.id) return;
    const updated: Onboarding = {
      ...onboarding, pending: undefined, error: result.error,
      messages: result.message ? [...onboarding.messages, { role: "assistant", text: result.message }] : onboarding.messages,
    };
    db.prepare("UPDATE marketing_workspaces SET onboarding = ? WHERE user_id = ?")
      .run(JSON.stringify(updated), userId);
    if (result.brief) {
      db.prepare("UPDATE marketing_workspaces SET campaign = ?, next_at = ? WHERE user_id = ? AND campaign IS NULL")
        .run(JSON.stringify({ brief: result.brief, status: "waiting" }), Date.now(), userId);
    }
  });
}

export function queueCampaign(userId: string) {
  getDb().prepare(`
    UPDATE marketing_workspaces SET next_at = ?, lease_until = 0, lease_token = NULL
    WHERE user_id = ? AND json_extract(campaign, '$.status') IN ('waiting', 'error')
  `).run(Date.now(), userId);
}

export function disconnectCampaign(userId: string) {
  getDb().prepare(`
    UPDATE marketing_workspaces
    SET campaign = json_remove(json_set(campaign, '$.status', 'waiting', '$.notice',
      'Connect Google Search Console to resume this campaign.'), '$.work'),
      next_at = ?, lease_until = 0, lease_token = NULL
    WHERE user_id = ? AND campaign IS NOT NULL AND json_extract(campaign, '$.status') != 'paused'
  `).run(Date.now(), userId);
}

export function setPaused(userId: string, paused: boolean) {
  const db = getDb();
  writeTransaction(db, () => {
    const { campaign } = workspace(userId);
    if (!campaign || (campaign.status === "paused") === paused) return;
    const updated: Campaign = { ...campaign, status: paused ? "paused" : "waiting", notice: undefined };
    // Discard an unfinished report. A newly authorized cycle gets new run IDs.
    delete updated.work;
    db.prepare(`
      UPDATE marketing_workspaces SET campaign = ?, next_at = ?, lease_until = 0, lease_token = NULL
      WHERE user_id = ?
    `).run(JSON.stringify(updated), paused ? null : Date.now(), userId);
  });
}

export function changeCampaignProperty(userId: string, property: string) {
  const db = getDb();
  writeTransaction(db, () => {
    const { campaign } = workspace(userId);
    if (!campaign || campaign.brief.playbook.property === property) return;
    const paused = campaign.status === "paused";
    campaign.brief.playbook.property = property;
    campaign.status = paused ? "paused" : "waiting";
    delete campaign.work;
    delete campaign.notice;
    db.prepare(`
      UPDATE marketing_workspaces SET campaign = ?, next_at = ?, lease_until = 0, lease_token = NULL
      WHERE user_id = ?
    `).run(JSON.stringify(campaign), paused ? null : Date.now(), userId);
  });
}

export function claimCampaign(now: number) {
  const token = randomUUID();
  const row = getDb().prepare(`
    UPDATE marketing_workspaces SET lease_token = ?, lease_until = ?
    WHERE user_id = (
      SELECT user_id FROM marketing_workspaces
      WHERE next_at <= ? AND lease_until <= ? ORDER BY next_at LIMIT 1
    )
    RETURNING user_id, campaign
  `).get(token, now + 120_000, now, now);
  if (!row) return;
  return { userId: row.user_id as string, token, campaign: JSON.parse(row.campaign as string) as Campaign };
}

export function commitCampaign(userId: string, token: string, campaign: Campaign, nextAt: number) {
  getDb().prepare(`
    UPDATE marketing_workspaces SET campaign = ?, next_at = ?, lease_token = NULL, lease_until = 0
    WHERE user_id = ? AND lease_token = ?
  `).run(JSON.stringify(campaign), nextAt, userId, token);
}

export function campaignIsClaimed(userId: string, token: string) {
  return !!getDb().prepare("SELECT 1 FROM marketing_workspaces WHERE user_id = ? AND lease_token = ?")
    .get(userId, token);
}
