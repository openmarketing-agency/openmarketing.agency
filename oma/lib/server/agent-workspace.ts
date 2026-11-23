/** Validates and transports console requests to oma-agent's private workspace socket. */

import { request } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { campaignPlanChatSchema, campaignPlanResponseSchema, campaignPlanSchema } from "../campaign-plan";
import { validToolkitSlug } from "../tool-catalog";
import type { LegacyToolSelections } from "./legacy-tool-selections";

export const workspaceId = z.string().max(64).regex(/^[a-z0-9]+(?:[-_][a-z0-9]+|__[a-z0-9]+)*$/);
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const strings = z.array(z.string());
const stringMap = z.record(z.string(), z.string());
const record = z.object({ id: workspaceId, name: z.string(), description: z.string() });
const discovery = z.object({
  label: z.string(), status: z.enum(["not_checked", "not_found", "verified"]),
  url: z.string(), feedUrl: z.string(), signupUrl: z.string(),
});
const documentId = z.string().regex(/^[a-f0-9]{16}$/);
const logoId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const document = z.object({ id: documentId, title: z.string(), path: z.string() });
const brand = record.extend({
  revision, knowledge: z.string(), knowledgeHtml: z.string().optional(), knowledgeFile: z.string().optional(), knowledgeRevision: revision.optional(),
  palette: stringMap, logos: stringMap, assets: z.record(z.string(), strings),
  channels: z.array(discovery).optional(),
  launches: z.array(discovery).optional(),
  signals: z.array(z.object({
    label: z.string(), status: z.enum(["observed", "not_checked", "not_detected"]), signal: z.string(),
  })).optional(),
  repositories: z.array(z.object({ label: z.string(), url: z.string(), commit: z.string() })).optional(),
  competitors: z.array(z.object({ label: z.string(), url: z.string(), sources: strings })).optional(),
  designSource: z.string().optional(),
  documents: z.array(document).max(64).optional(),
});
const playbook = record.extend({ revision, brandId: z.string(), strategy: z.string(), strategyHtml: z.string().optional() });
export const campaignMode = z.enum(["approve", "control", "yolo"]);
export type CampaignMode = z.infer<typeof campaignMode>;
const campaignConfiguration = z.object({
  revision, provider: z.string(), modelId: z.string(), baseUrl: z.string(),
  hasModelKey: z.boolean(), mode: campaignMode.optional(),
});
const campaign = record.extend({
  playbookId: z.string(), version: z.string(), orchestrator: z.string(), agentIds: strings,
  goals: strings, plans: strings, board: z.string(),
  integrationConfigInvalid: z.boolean().optional(),
  requiredIntegrations: z.array(z.object({
    id: workspaceId, name: z.string(), slug: z.string().refine(validToolkitSlug).nullable(),
  })).optional(),
  installationState: z.string().optional(), model: z.string().optional(),
  lifecycleState: z.string().optional(),
  configuration: campaignConfiguration.optional(),
});
const agent = record.extend({
  campaignId: z.string(), toolsets: strings, skills: strings.optional(), model: z.string().optional(),
  jobs: z.array(z.object({
    name: z.string(), schedule: z.string(), timezone: z.string().optional(), repeat: z.number().int().positive().optional(),
  })),
});
const reasoningEffort = z.enum(["", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
const standaloneSelection = z.object({
  provider: z.string(), modelId: z.string(), baseUrl: z.string(), reasoningEffort: reasoningEffort.default(""),
});
const standaloneModels = z.object({ revision, default: standaloneSelection, maintenance: standaloneSelection });
export type StandaloneModels = z.infer<typeof standaloneModels>;
export type StandaloneModelResult = { models?: StandaloneModels; error?: string };

const inventory = z.object({
  brands: z.array(brand), playbooks: z.array(playbook), campaigns: z.array(campaign), agents: z.array(agent),
  skipped: z.number().int().nonnegative(),
  standaloneModels: standaloneModels.optional(),
});

export type AgentWorkspace = z.infer<typeof inventory>;
export type SavedBrand = z.infer<typeof brand>;
const documentBody = z.object({ content: z.string(), html: z.string().optional() });
const brandDocument = document.extend(documentBody.shape);
const logoResponse = z.object({
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  content: z.base64().max(360_000),
});
export type SavedBrandDocument = z.infer<typeof brandDocument>;
export type WorkspaceEdit = "brands" | "playbooks" | "brand-knowledge";
export type SavedPlaybook = z.infer<typeof playbook>;
export type CampaignConfiguration = z.infer<typeof campaignConfiguration>;
export type SavedCampaign = z.infer<typeof campaign>;
export type RequiredIntegration = NonNullable<SavedCampaign["requiredIntegrations"]>[number];
export type SavedAgent = z.infer<typeof agent>;

export const brandUpdate = z.object({
  revision,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(4000),
  knowledge_base: z.string().max(48_000).optional(),
});
export const knowledgeUpdate = z.object({ revision, knowledge_base: z.string().max(48_000) });
export const playbookUpdate = z.object({ revision, strategy: z.string().max(48_000) });

export class WorkspaceRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const unavailable = () => new WorkspaceRequestError(503, "Couldn’t reach the agent workspace. Check that oma-agent is running.");

/** Call a trusted workspace endpoint over the private Unix socket. */
export async function workspaceRequest(path: string, body?: object, method = body ? "PUT" : "GET"): Promise<unknown> {
  const socketPath = process.env.OMA_WORKSPACE_SOCKET;
  if (!socketPath) throw unavailable();
  const payload = body ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const req = request({
      socketPath, path, method,
      signal: AbortSignal.timeout(path.endsWith("/deploy") ? 130_000 : method === "POST" || path.endsWith("/lifecycle") ? 70_000 : 6_000),
      headers: payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : undefined,
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 16 * 1024 * 1024) {
          req.destroy(unavailable());
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", () => reject(unavailable()));
      response.on("end", () => {
        try {
          const result: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const status = response.statusCode ?? 503;
          if (status === 200) {
            resolve(result);
            return;
          }
          const parsed = z.object({ message: z.string() }).safeParse(result);
          reject(new WorkspaceRequestError(status, parsed.success ? parsed.data.message : "The agent workspace request failed."));
        } catch {
          reject(unavailable());
        }
      });
    });
    req.on("error", () => reject(unavailable()));
    req.end(payload);
  });
}

const toolSelectionsPath = "/workspace/tool-selections";
const toolkit = z.string().refine(validToolkitSlug);
const toolSelections = z.object({
  workspace: z.array(toolkit),
  campaigns: z.record(workspaceId, z.array(toolkit)),
});
export type WorkspaceToolSelections = z.infer<typeof toolSelections>;

function parseToolSelections(result: unknown): WorkspaceToolSelections {
  const parsed = toolSelections.safeParse(result);
  if (!parsed.success) throw new WorkspaceRequestError(502, "The agent workspace returned invalid tool selections.");
  return parsed.data;
}

export async function readWorkspaceToolSelections(): Promise<WorkspaceToolSelections> {
  return parseToolSelections(await workspaceRequest(toolSelectionsPath));
}

export async function writeWorkspaceToolSelection(campaignId: string | null, slug: string, selected: boolean) {
  if ((campaignId !== null && !workspaceId.safeParse(campaignId).success) || !validToolkitSlug(slug)) {
    throw new WorkspaceRequestError(422, "Choose a saved campaign and a supported toolkit.");
  }
  return parseToolSelections(await workspaceRequest(toolSelectionsPath, { campaignId, slug, selected }));
}

export async function importWorkspaceToolSelections(data: LegacyToolSelections): Promise<void> {
  const result = z.object({ migrationId: revision }).safeParse(await workspaceRequest(toolSelectionsPath + "/import", data, "POST"));
  if (!result.success || result.data.migrationId !== data.migrationId) {
    throw new WorkspaceRequestError(502, "The agent workspace did not confirm the tool selection import.");
  }
}

/** Read uncached workspace data. A console without the bundled agent has no socket. */
export async function loadAgentWorkspace(): Promise<{ records?: AgentWorkspace; error?: string }> {
  if (!process.env.OMA_WORKSPACE_SOCKET) return {};
  try {
    const result = inventory.safeParse(await workspaceRequest("/workspace"));
    return result.success ? { records: result.data } : { error: "The agent workspace returned invalid records." };
  } catch (error) {
    if (error instanceof WorkspaceRequestError) return { error: error.message };
    throw error;
  }
}

const campaignKanban = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ready"), counts: z.record(z.string(), z.number().int().nonnegative()) }),
  z.object({ state: z.enum(["unconfigured", "missing", "ambiguous", "unavailable"]) }),
]);

export type CampaignKanbanStatus = z.infer<typeof campaignKanban>;

/** Read task counts using the campaign’s current saved board, independently of the workspace inventory. */
export async function readCampaignKanbanStatus(campaign: Pick<SavedCampaign, "id" | "board">): Promise<CampaignKanbanStatus> {
  if (!campaign.board.trim()) return { state: "unconfigured" };
  if (!workspaceId.safeParse(campaign.id).success) return { state: "unavailable" };
  try {
    const result = campaignKanban.safeParse(await workspaceRequest("/workspace/campaigns/" + campaign.id + "/kanban"));
    return result.success ? result.data : { state: "unavailable" };
  } catch (error) {
    if (error instanceof WorkspaceRequestError) return { state: "unavailable" };
    throw error;
  }
}

export async function loadBrandDocument(id: string, docId: string) {
  if (!workspaceId.safeParse(id).success || !documentId.safeParse(docId).success) {
    return { error: "This brand document was not found." };
  }
  try {
    const parsed = brandDocument.safeParse(await workspaceRequest("/workspace/brands/" + id + "/documents/" + docId));
    return parsed.success ? { document: parsed.data } : { error: "The agent workspace returned an invalid document." };
  } catch (error) {
    if (error instanceof WorkspaceRequestError) return { error: error.message };
    throw error;
  }
}

export async function loadAgentProfile(id: string) {
  if (!workspaceId.safeParse(id).success) return { error: "This agent profile was not found." };
  try {
    const parsed = documentBody.safeParse(await workspaceRequest("/workspace/agents/" + id + "/profile"));
    return parsed.success ? { profile: parsed.data } : { error: "The agent workspace returned an invalid profile." };
  } catch (error) {
    if (error instanceof WorkspaceRequestError) return error.status === 404 ? {} : { error: error.message };
    throw error;
  }
}

export async function loadBrandLogo(id: string, logo: string) {
  if (!workspaceId.safeParse(id).success || !logoId.safeParse(logo).success) return;
  try {
    const parsed = logoResponse.safeParse(await workspaceRequest("/workspace/brands/" + id + "/logos/" + logo));
    return parsed.success ? parsed.data : undefined;
  } catch (error) {
    if (error instanceof WorkspaceRequestError && [404, 422].includes(error.status)) return;
    throw error;
  }
}

export async function saveWorkspaceRecord(collection: WorkspaceEdit, id: string, update: object) {
  if (!workspaceId.safeParse(id).success) throw new WorkspaceRequestError(404, "This workspace record was not found.");
  const path = collection === "brand-knowledge" ? "brands/" + id + "/knowledge" : collection + "/" + id;
  await workspaceRequest("/workspace/" + path, update);
}

const campaignPlanUpdate = campaignPlanSchema.extend({ revision });

/** Save only the reviewed fields using the revision the user opened. */
export async function saveCampaignPlan(id: string, input: unknown) {
  const parsed = campaignPlanUpdate.safeParse(input);
  if (!workspaceId.safeParse(id).success || !parsed.success) {
    throw new WorkspaceRequestError(422, "Enter a campaign name and check the plan’s field lengths.");
  }
  const result = await workspaceRequest("/workspace/campaigns/" + id + "/plan", parsed.data);
  const saved = z.object({ revision }).safeParse(result);
  if (!saved.success) throw new WorkspaceRequestError(502, "Couldn’t confirm the saved campaign plan. Refresh to check it.");
  return saved.data;
}

/** Ask for a draft revision without giving the model a write or deploy operation. */
export async function previewCampaignPlan(id: string, input: unknown) {
  const parsed = campaignPlanChatSchema.safeParse(input);
  if (!workspaceId.safeParse(id).success || !parsed.success) {
    throw new WorkspaceRequestError(422, "Check the draft and enter a shorter message.");
  }
  const result = await workspaceRequest("/workspace/campaigns/" + id + "/plan-chat", parsed.data, "POST");
  const reply = campaignPlanResponseSchema.safeParse(result);
  if (!reply.success) throw new WorkspaceRequestError(502, "oma-agent returned an unreadable suggestion. Try again.");
  return reply.data;
}

const requiredModelBaseUrl = z.string().max(2048).refine((value) => {
  const url = URL.parse(value);
  return url?.protocol === "https:" && !url.username && !url.password && !/[?#\s\\]/.test(value);
});
const modelBaseUrl = z.union([z.literal(""), requiredModelBaseUrl]);
const hostedComposioUrl = z.string().max(2048).regex(/^(?:https:\/\/backend\.composio\.dev\/tool_router\/(?:v3\/)?[A-Za-z0-9_-]+\/mcp\/?)?$/);
const keyValue = z.string().max(4096).regex(/^[\x20-\x7e]*$/);
const modelProvider = z.string().trim().max(80).regex(/^(?:[A-Za-z0-9_.-]+(?:[:@][A-Za-z0-9_.-]+)?)?$/);
const modelIdentifier = z.string().trim().max(200).regex(/^[^\s$]*$/);

const standaloneModelUpdate = z.object({
  revision,
  provider: modelProvider.transform((value) => value.toLowerCase()).refine(Boolean),
  modelId: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/),
  baseUrl: requiredModelBaseUrl,
  modelKey: keyValue.transform((value) => value.trim()).default(""),
  reasoningEffort,
});
const standaloneIds = ["default", "maintenance"] as const;
const standaloneRevisions = z.object({ revisions: z.object({ default: revision, maintenance: revision }) });
const agentSync = z.object({ id: z.enum(standaloneIds), revision });

/** Save the shared model, pass the key only to the two sync calls, and confirm both profiles. */
export async function saveStandaloneModel(input: unknown, { requireKey = false } = {}): Promise<StandaloneModelResult> {
  const parsed = standaloneModelUpdate.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues.some(({ path }) => path[0] === "baseUrl")
      ? "Enter a valid HTTPS provider base URL."
      : "Check the provider, model ID, reasoning effort, and API key." };
  }
  const { modelKey, ...settings } = parsed.data;
  if (requireKey && !modelKey) return { error: "Enter your provider API key to set up both agents." };
  try {
    const { revisions } = standaloneRevisions.parse(await workspaceRequest("/workspace/agents/model", {
      ...settings, ...(modelKey ? { setModelKey: true } : {}),
    }, "POST"));
    for (const id of standaloneIds) {
      const result = agentSync.parse(await workspaceRequest("/workspace/agents/" + id + "/sync", {
        revision: revisions[id],
        ...(modelKey ? { env: { HERMES_MODEL_API_KEY: modelKey } } : {}),
      }, "POST"));
      if (result.id !== id || result.revision !== revisions[id]) {
        throw new WorkspaceRequestError(502, "Couldn’t confirm both agent syncs. Reload their settings and retry.");
      }
    }
    const workspace = await loadAgentWorkspace();
    const models = workspace.records?.standaloneModels;
    const { provider, modelId, baseUrl, reasoningEffort } = settings;
    if (!models || standaloneIds.some((id) =>
      models[id].provider !== provider || models[id].modelId !== modelId || models[id].baseUrl !== baseUrl
      || models[id].reasoningEffort !== reasoningEffort)) {
      return { models, error: "Couldn’t confirm the saved settings on both agents. Reload their settings and retry." };
    }
    return { models };
  } catch (error) {
    const { records } = await loadAgentWorkspace();
    return {
      models: records?.standaloneModels,
      error: error instanceof WorkspaceRequestError ? error.message
        : "Couldn’t confirm both agent syncs. Reload their settings and retry.",
    };
  }
}

const campaignUpdate = z.object({
  revision,
  provider: modelProvider,
  modelId: modelIdentifier,
  baseUrl: modelBaseUrl,
  modelKey: keyValue.transform((value) => value.trim()),
}).refine((input) =>
  (!(input.provider || input.baseUrl || input.modelKey) || input.modelId) && (!input.modelKey || input.baseUrl),
);

export type CampaignConfigurationResult = {
  configuration?: CampaignConfiguration;
  error?: string;
  synced?: boolean;
  deployed?: boolean;
  state?: "paused" | "pausing" | "resumed";
};

/** Save publishing mode and sync its revision without passing credentials. */
export async function saveCampaignMode(id: string, input: unknown) {
  const parsed = z.object({ revision, mode: campaignMode }).safeParse(input);
  if (!workspaceId.safeParse(id).success || !parsed.success) {
    throw new WorkspaceRequestError(422, "Choose an available campaign mode.");
  }
  const workspace = await loadAgentWorkspace();
  if (workspace.error) throw new WorkspaceRequestError(503, workspace.error);
  const campaign = workspace.records?.campaigns.find((item) => item.id === id);
  if (!campaign?.configuration) throw new WorkspaceRequestError(404, "Campaign settings were not found.");
  if (campaign.configuration.revision !== parsed.data.revision) {
    throw new WorkspaceRequestError(409, "This campaign changed. Reload its settings and try again.");
  }

  const stopped = await pauseCampaignForSync(id, campaign.lifecycleState, parsed.data.revision);
  let synced: CampaignConfiguration;
  try {
    const result = campaignConfiguration.parse(await workspaceRequest("/workspace/campaigns/" + id + "/mode", {
      mode: parsed.data.mode, revision: stopped.revision,
    }));
    if (result.mode !== parsed.data.mode) throw new Error("Unexpected mode");
    synced = campaignConfiguration.parse(await workspaceRequest(
      "/workspace/campaigns/" + id + "/sync", { revision: result.revision }, "POST",
    ));
    if (synced.mode !== parsed.data.mode) throw new Error("Unexpected synced mode");
  } catch {
    throw new WorkspaceRequestError(502, stopped.resume
      ? "Campaign stopped, but the mode change and sync could not be confirmed. Reload settings before retrying."
      : "Couldn’t confirm the mode change and sync. Reload settings before retrying.");
  }
  if (stopped.resume) await resumeCampaignAfterSync(id, synced.revision);
  return parsed.data.mode;
}

const campaignLifecycle = z.object({
  id: workspaceId, state: z.enum(["paused", "pausing", "resumed"]), revision, missingIntegrations: z.array(workspaceId),
});

export async function setCampaignLifecycle(id: string, state: "paused" | "resumed", expectedRevision?: string) {
  if (!workspaceId.safeParse(id).success) throw new WorkspaceRequestError(404, "Campaign not found.");
  const result = campaignLifecycle.safeParse(await workspaceRequest("/workspace/campaigns/" + id + "/lifecycle", {
    state, ...(expectedRevision ? { revision: expectedRevision } : {}),
  }));
  if (!result.success || result.data.id !== id) {
    throw new WorkspaceRequestError(502, "Couldn’t confirm the campaign state. Reload its status before retrying.");
  }
  return result.data;
}

async function pauseCampaignForSync(id: string, state: string | undefined, currentRevision: string) {
  if (state !== "resumed" && state !== "pausing") return { revision: currentRevision, resume: false };
  const deadline = Date.now() + 25_000;
  let lifecycle = await setCampaignLifecycle(id, "paused", currentRevision);
  while (lifecycle.state === "pausing" && Date.now() < deadline) {
    await delay(400);
    lifecycle = await setCampaignLifecycle(id, "paused", lifecycle.revision);
  }
  if (lifecycle.state !== "paused") {
    throw new WorkspaceRequestError(409, "The campaign is still stopping. Wait until it is stopped and retry.");
  }
  return { revision: lifecycle.revision, resume: state === "resumed" };
}

async function resumeCampaignAfterSync(id: string, currentRevision: string) {
  let lifecycle;
  try {
    lifecycle = await setCampaignLifecycle(id, "resumed", currentRevision);
  } catch {
    throw new WorkspaceRequestError(502, "Campaign synced, but restarting could not be confirmed. Reload its status.");
  }
  if (lifecycle.state !== "resumed") {
    throw new WorkspaceRequestError(412, lifecycle.missingIntegrations.length
      ? "Campaign synced and is stopped. Check the required integrations before restarting."
      : "Campaign synced and is still stopped. Check the saved campaign settings before restarting.");
  }
  return lifecycle.revision;
}

/** Generate the MCP URL after validating the edit, then save the YAML and sync the campaign’s keys. */
export async function saveCampaignConfiguration(
  id: string,
  input: unknown,
  generateMcpUrl: (required: RequiredIntegration[]) => Promise<{ url: string } | { error: string }>,
  deploy = false,
): Promise<CampaignConfigurationResult> {
  const parsed = campaignUpdate.safeParse(input);
  if (!workspaceId.safeParse(id).success || !parsed.success) {
    return { error: "Check the model fields and use HTTPS for the model base URL." };
  }
  const { modelKey, ...settings } = parsed.data;
  const workspace = await loadAgentWorkspace();
  if (workspace.error) return { error: workspace.error };
  const campaign = workspace.records?.campaigns.find((item) => item.id === id);
  const current = campaign?.configuration;
  if (!current) return { error: "Couldn’t load this campaign’s settings. Check that oma-agent is running." };
  if (current.revision !== settings.revision) return { error: "This campaign changed. Reload its settings and try again." };

  if (campaign?.integrationConfigInvalid) {
    return { error: "Use a list of unique campaign integration IDs such as discord or facebook in config.yaml." };
  }
  const required = campaign?.requiredIntegrations ?? [];
  const mcp = await generateMcpUrl(required);
  if ("error" in mcp) return { error: mcp.error };
  const url = hostedComposioUrl.safeParse(mcp.url);
  if (!url.success) return { error: "Composio returned a URL that can’t be synced to this campaign." };
  const composioUrl = url.data;
  const composioKey = composioUrl ? process.env.COMPOSIO_API_KEY?.trim() : undefined;
  if (composioUrl && (!composioKey || !keyValue.safeParse(composioKey).success)) {
    return { error: "Set COMPOSIO_API_KEY in OMA’s environment to sync a Composio MCP connection." };
  }
  const path = "/workspace/campaigns/" + id;
  let stopped;
  try {
    stopped = await pauseCampaignForSync(id, campaign?.lifecycleState, settings.revision);
  } catch (error) {
    return { error: error instanceof WorkspaceRequestError ? error.message : "Couldn’t stop the campaign before syncing." };
  }
  let saved: CampaignConfiguration;
  try {
    saved = campaignConfiguration.parse(await workspaceRequest(path + "/config", {
      ...settings, revision: stopped.revision, composioUrl, setModelKey: Boolean(modelKey),
    }));
  } catch (error) {
    const message = error instanceof WorkspaceRequestError && [404, 409, 422].includes(error.status)
      ? error.message : "Couldn’t save the campaign settings. Check that oma-agent is running.";
    return stopped.resume
      ? { configuration: { ...current, revision: stopped.revision }, error: "Campaign stopped. " + message }
      : { error: message };
  }
  const env = {
    ...(modelKey ? { HERMES_MODEL_API_KEY: modelKey } : {}),
    ...(composioKey ? { COMPOSIO_API_KEY: composioKey } : {}),
  };
  try {
    saved = campaignConfiguration.parse(await workspaceRequest(path + "/sync", {
      revision: saved.revision, env, ...(deploy ? { prepareDeployment: true } : {}),
    }, "POST"));
  } catch (error) {
    const recovery = error instanceof WorkspaceRequestError && error.status === 412
      ? "Check that the campaign has a board and its profiles are linked to it."
      : modelKey ? "Reload campaign settings and re-enter the new model API key before retrying."
      : "Reload campaign settings and try again.";
    return {
      configuration: saved,
      error: (stopped.resume ? "Campaign stopped. " : "") + "Settings were saved, but oma-agent could not sync the campaign. " + recovery,
    };
  }
  if (!deploy) {
    if (!stopped.resume) return { configuration: saved, synced: true };
    try {
      const latest = await resumeCampaignAfterSync(id, saved.revision);
      return { configuration: { ...saved, revision: latest }, synced: true, state: "resumed" };
    } catch (error) {
      return { configuration: saved, error: error instanceof WorkspaceRequestError
        ? error.message : "Campaign synced, but restarting could not be confirmed." };
    }
  }
  try {
    saved = campaignConfiguration.parse(await workspaceRequest(path + "/deploy", { revision: saved.revision, env }, "POST"));
  } catch (error) {
    const detail = error instanceof WorkspaceRequestError && error.status === 412
      ? " Check the saved agent records and board before retrying." : " Reload its settings and try again.";
    return { configuration: saved, error: "Campaign settings passed sync, but deployment could not be confirmed." + detail };
  }
  try {
    const lifecycle = await setCampaignLifecycle(id, "resumed", saved.revision);
    const configuration = { ...saved, revision: lifecycle.revision };
    if (lifecycle.state !== "resumed") {
      const missing = lifecycle.missingIntegrations.map((key) => required.find((tool) => tool.id === key)?.name ?? key);
      return {
        configuration, deployed: true, state: lifecycle.state,
        error: missing.length ? "Campaign deployed. The agent couldn’t verify these required integrations: " + missing.join(", ") + "."
          : "Campaign deployed. Wait for it to finish stopping, then retry.",
      };
    }
    return { configuration, synced: true, deployed: true, state: lifecycle.state };
  } catch {
    return { configuration: saved, deployed: true, error: "Campaign deployed, but starting it could not be confirmed. Reload its status and retry." };
  }
}
