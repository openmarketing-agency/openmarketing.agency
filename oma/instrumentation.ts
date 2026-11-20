export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.OMA_HERMES_GATEWAY_URL) {
    const { startCampaignWorker } = await import("./lib/server/marketing/worker");
    startCampaignWorker();
  }
}
