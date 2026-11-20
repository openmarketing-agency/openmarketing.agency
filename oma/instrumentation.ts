export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startCampaignWorker } = await import("./lib/server/marketing/worker");
    startCampaignWorker();
  }
}
