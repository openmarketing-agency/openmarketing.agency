import "server-only";
import { searchConsoleAccount, searchConsoleEvidence } from "@/lib/composio";
import { ToolConnectionConfigurationError } from "@/lib/tool-connection-service";
import { advanceCampaign } from "./campaign";
import { getRun, HermesUnavailable, hermesConfigured, startRun } from "./hermes";
import { campaignIsClaimed, claimCampaign, commitCampaign } from "./state";

const scope = globalThis as typeof globalThis & { omaCampaignTimer?: ReturnType<typeof setInterval> };
let ticking = false;

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const work = claimCampaign(Date.now());
    if (!work) return;
    const { userId, token, campaign } = work;
    try {
      const next = await advanceCampaign(campaign, {
        account: () => searchConsoleAccount(userId),
        evidence: (account, property) => searchConsoleEvidence(userId, account, property),
        start: startRun, get: getRun,
        stillRunning: () => campaignIsClaimed(userId, token),
      });
      commitCampaign(userId, token, next.campaign, Date.now() + next.delay);
    } catch (error) {
      const retry = error instanceof HermesUnavailable;
      const notice = error instanceof ToolConnectionConfigurationError
        ? error.message
        : retry ? "Waiting for Hermes to become available." : "The campaign could not finish this cycle. It will retry automatically.";
      commitCampaign(userId, token, { ...campaign, status: "error", notice, work: retry ? campaign.work : undefined },
        Date.now() + (retry ? 30_000 : 10 * 60_000));
    }
  } catch {
    // SQLite may be busy at startup. The next tick can claim the same durable work.
    console.warn("Could not reconcile OMA campaigns.");
  } finally {
    ticking = false;
  }
}

export function startCampaignWorker() {
  if (scope.omaCampaignTimer || !hermesConfigured()) return;
  scope.omaCampaignTimer = setInterval(() => void tick(), 5_000);
  scope.omaCampaignTimer.unref();
}
