import { randomUUID } from "node:crypto";
import { getDb, writeTransaction } from "@/lib/db";
import { campaignSources, type Brief, type DraftBrief, type Source, type SourceKey } from "@/lib/marketing-playbook";
export type Message = { role: "user" | "assistant"; text: string };
export type Clarification = { kind: "clarify"; prompt_id: string; execution_generation: number; question: string; choices: string[] };
export type PendingTurn = { id: string; text: string; kind: "chat" | "finalize"; runId?: string };
export type Onboarding = {
  session: string;
  messages: Message[];
  pending?: PendingTurn;
  draft?: { id: string; brief: DraftBrief };
  error?: string;
};
type StepOutput = { role: string; text: string };
export type Work = {
  id: string;
  accounts: string[];
  evidence: string[];
  outputs: StepOutput[];
  runId?: string;
};
export type Campaign = {
  brief: Brief;
  status: "waiting" | "running" | "active" | "paused" | "error";
  work?: Work;
  report?: { outputs: StepOutput[]; sources: Source[]; finishedAt: number };
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

export function beginTurn(userId: string, text: string, kind: PendingTurn["kind"]) {
  const db = getDb();
  return writeTransaction(db, () => {
    const current = workspace(userId);
    if (current.campaign) throw new Error("This workspace is already set up.");
    const onboarding = current.onboarding ?? { session: randomUUID(), messages: [] };
    if (onboarding.pending) throw new Error("Finish the current turn first.");
    if (onboarding.messages.length >= 60 && kind === "chat") throw new Error("Generate your playbook to finish this conversation.");
    if (kind === "finalize" && !onboarding.messages.some((message) => message.role === "user")) {
      throw new Error("Tell Hermes about your business before generating a playbook.");
    }
    const updated: Onboarding = {
      ...onboarding, draft: undefined, error: undefined, pending: { id: randomUUID(), text, kind },
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

export function finishTurn(userId: string, pending: PendingTurn, result: { message?: string; brief?: DraftBrief; error?: string }) {
  const db = getDb();
  writeTransaction(db, () => {
    const { onboarding } = workspace(userId);
    if (onboarding?.pending?.id !== pending.id) return;
    const updated: Onboarding = {
      ...onboarding, pending: undefined, error: result.error,
      draft: result.brief ? { id: pending.id, brief: result.brief } : onboarding.draft,
      messages: result.message ? [...onboarding.messages, { role: "assistant", text: result.message }] : onboarding.messages,
    };
    db.prepare("UPDATE marketing_workspaces SET onboarding = ? WHERE user_id = ?")
      .run(JSON.stringify(updated), userId);
  });
}

function approvedSources(keys: SourceKey[], resources: unknown): Source[] {
  if (!resources || typeof resources !== "object" || Array.isArray(resources)) throw new Error("Invalid campaign sources.");
  return keys.map((toolkit) => {
    const spec = campaignSources[toolkit];
    const resource = spec.resource.safeParse(Object.hasOwn(resources, toolkit) ? Reflect.get(resources, toolkit) : undefined);
    if (!resource.success) throw new Error(`Enter a valid ${spec.resourceLabel}, such as ${spec.example}.`);
    return { toolkit, resource: resource.data };
  });
}

export function activateCampaign(userId: string, draftId: string, resources: unknown): OnboardingView {
  const db = getDb();
  return writeTransaction(db, () => {
    const current = workspace(userId);
    const draft = current.onboarding?.draft;
    if (current.campaign || current.onboarding?.pending || !draft || draft.id !== draftId) {
      return { ...current, requestError: "Review your latest playbook before activating." };
    }
    let sources: Source[];
    try {
      sources = approvedSources(draft.brief.playbook.sources, resources);
    } catch (error) {
      return { ...current, requestError: (error as Error).message };
    }
    const campaign: Campaign = { brief: { ...draft.brief, playbook: { ...draft.brief.playbook, sources } }, status: "waiting" };
    db.prepare(`
      UPDATE marketing_workspaces SET campaign = ?, next_at = ?, onboarding = json_remove(onboarding, '$.draft')
      WHERE user_id = ?
    `).run(JSON.stringify(campaign), Date.now(), userId);
    return workspace(userId);
  });
}

export function queueCampaign(userId: string, toolkit: string) {
  getDb().prepare(`
    UPDATE marketing_workspaces SET next_at = ?, lease_until = 0, lease_token = NULL
    WHERE user_id = ? AND json_extract(campaign, '$.status') IN ('waiting', 'error')
      AND EXISTS (SELECT 1 FROM json_each(campaign, '$.brief.playbook.sources')
        WHERE json_extract(value, '$.toolkit') = ?)
  `).run(Date.now(), userId, toolkit);
}

export function disconnectCampaign(userId: string, toolkit: string) {
  getDb().prepare(`
    UPDATE marketing_workspaces
    SET campaign = json_remove(json_set(campaign, '$.status', 'waiting'), '$.work', '$.notice'),
      next_at = ?, lease_until = 0, lease_token = NULL
    WHERE user_id = ? AND campaign IS NOT NULL AND json_extract(campaign, '$.status') != 'paused'
      AND EXISTS (SELECT 1 FROM json_each(campaign, '$.brief.playbook.sources')
        WHERE json_extract(value, '$.toolkit') = ?)
  `).run(Date.now(), userId, toolkit);
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

export function changeCampaignSources(userId: string, resources: unknown): OnboardingView {
  const db = getDb();
  return writeTransaction(db, () => {
    const current = workspace(userId);
    const campaign = current.campaign;
    if (!campaign) return current;
    let sources: Source[];
    try {
      sources = approvedSources(campaign.brief.playbook.sources.map(({ toolkit }) => toolkit), resources);
    } catch (error) {
      return { ...current, requestError: (error as Error).message };
    }
    if (sources.every((source, index) => source.resource === campaign.brief.playbook.sources[index].resource)) return current;
    const paused = campaign.status === "paused";
    campaign.brief.playbook.sources = sources;
    campaign.status = paused ? "paused" : "waiting";
    delete campaign.work;
    delete campaign.notice;
    db.prepare(`
      UPDATE marketing_workspaces SET campaign = ?, next_at = ?, lease_until = 0, lease_token = NULL
      WHERE user_id = ?
    `).run(JSON.stringify(campaign), paused ? null : Date.now(), userId);
    return workspace(userId);
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
