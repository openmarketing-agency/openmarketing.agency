/** Validates and transports console requests to oma-agent's private workspace socket. */

import { request } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { validToolkitSlug } from "../tool-catalog";
import type { LegacyToolSelections } from "./legacy-tool-selections";

export const workspaceId = z.string().max(64).regex(/^[a-z0-9]+(?:[-_][a-z0-9]+|__[a-z0-9]+)*$/);
const revision = z.string().regex(/^[a-f0-9]{64}$/);
export const campaignMode = z.enum(["approve", "control", "yolo"]);
const publicationCampaignId = z.string().max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const publicationId = z.string().regex(/^[a-f0-9]{32}$/);
export const publicationRevision = z.number().int().positive();
export const nativeCampaignPublication = z.object({
  id: publicationId, revision: publicationRevision,
  status: z.enum(["pending_approval", "approved", "publishing", "published", "failed"]),
  platform: z.string(), kind: z.enum(["post", "reply"]),
  account: z.object({ id: z.string(), name: z.string().optional(), handle: z.string().optional(), avatar_url: z.string().optional() }),
  content: z.object({ text: z.string(), media: z.array(z.object({
    asset_id: z.string(), kind: z.enum(["image", "video", "document"]), url: z.string().optional(), alt_text: z.string().optional(),
  })).optional() }),
  target: z.object({ id: z.string(), url: z.string().optional(), author_name: z.string().optional(),
    author_handle: z.string().optional(), author_avatar_url: z.string().optional(), text: z.string().optional() }).optional(),
  approval: z.object({ revision: publicationRevision, source: z.enum(["human", "automatic"]), by: z.string().nullable(), at: z.string() }).nullable(),
  result: z.object({ provider_id: z.string(), url: z.string().optional(), published_at: z.string() })
    .or(z.object({ error: z.string() })).nullable(),
  task_id: z.string().nullable(), created_at: z.string(), updated_at: z.string(),
});
const publicationsPage = z.object({
  campaign_id: publicationCampaignId, mode: campaignMode, publications: z.array(nativeCampaignPublication), next_cursor: z.number().int().positive().nullable(),
});
export type CampaignPublication = z.infer<typeof nativeCampaignPublication>;
const strings = z.array(z.string());
const stringMap = z.record(z.string(), z.string());
const record = z.object({ id: workspaceId, name: z.string(), description: z.string() });
const discovery = z.object({
  label: z.string(), status: z.enum(["not_checked", "not_found", "verified"]),
  url: z.string(), feedUrl: z.string(), signupUrl: z.string(),
});
const documentId = z.string().regex(/^[a-f0-9]{16}$/);
const logoId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const assetId = z.string().regex(/^[a-f0-9]{32}$/);
const assetMediaType = z.enum([
  "image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/svg+xml",
  "font/woff", "font/woff2", "font/ttf", "font/otf", "application/octet-stream",
]);
const brandAsset = z.object({
  id: assetId, category: z.enum(["screenshots", "logos", "fonts", "illustrations", "icons", "backgrounds", "images"]),
  label: z.string(), file: z.string(), sourceUrl: z.string(), mediaType: assetMediaType,
});
export type BrandAsset = z.infer<typeof brandAsset>;
const document = z.object({ id: documentId, title: z.string(), path: z.string() });
const brand = record.extend({
  revision, knowledge: z.string(), knowledgeFile: z.string().optional(), knowledgeRevision: revision.optional(),
  palette: stringMap, logos: stringMap, assets: z.record(z.string(), strings),
  assetFiles: z.array(brandAsset).optional(),
  channels: z.array(discovery).optional(),
  launches: z.array(discovery).optional(),
  signals: z.array(z.object({
    label: z.string(), status: z.enum(["observed", "not_checked", "not_detected"]), signal: z.string(), evidence: z.string().optional(),
  })).optional(),
  repositories: z.array(z.object({ label: z.string(), url: z.string(), commit: z.string(), notes: z.string().optional() })).optional(),
  competitors: z.array(z.object({ id: workspaceId.optional(), label: z.string(), url: z.string(), sources: strings, report: z.string().optional() })).optional(),
  designSource: z.string().optional(),
  internalDocumentation: z.object({ index: z.string(), mode: z.enum(["summarized", "mirrored"]) }).optional(),
  documents: z.array(document).max(64).optional(),
});
const playbook = record.extend({ revision, brandId: z.string(), strategy: z.string() });
export type CampaignMode = z.infer<typeof campaignMode>;
const campaignConfiguration = z.object({
  revision, provider: z.string(), modelId: z.string(), baseUrl: z.string(),
  hasModelKey: z.boolean(), mode: campaignMode.optional(),
});
const campaignIntegration = z.object({ id: workspaceId, name: z.string(), slug: z.string().refine(validToolkitSlug).nullable() });
const manualCampaignIntegration = z.object({ id: publicationCampaignId, name: z.string(), url: z.string() });
const campaign = record.extend({
  playbookId: z.string(), version: z.string(), orchestrator: z.string(), agentIds: strings,
  goals: strings, plans: strings, board: z.string(),
  integrationConfigInvalid: z.boolean().optional(),
  requiredIntegrations: z.array(campaignIntegration).optional(),
  manualIntegrations: z.array(manualCampaignIntegration).optional(),
  installationState: z.string().optional(), model: z.string().optional(),
  lifecycleState: z.string().optional(), mode: campaignMode.optional(),
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
const documentBody = z.object({ content: z.string() });
const brandDocument = document.extend(documentBody.shape);
const logoResponse = z.object({
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  content: z.base64().max(360_000),
});
const assetResponse = z.object({
  filename: z.string().min(1).max(512), mediaType: assetMediaType,
  content: z.base64().max(4 * Math.ceil(10 * 1024 * 1024 / 3)),
});
export type SavedBrandDocument = z.infer<typeof brandDocument>;
export type WorkspaceEdit = "brands" | "playbooks" | "brand-knowledge";
export type SavedPlaybook = z.infer<typeof playbook>;
export type CampaignConfiguration = z.infer<typeof campaignConfiguration>;
export type SavedCampaign = z.infer<typeof campaign>;
export type RequiredIntegration = NonNullable<SavedCampaign["requiredIntegrations"]>[number];
export type ManualCampaignIntegration = z.infer<typeof manualCampaignIntegration>;
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
export async function workspaceRequest(
  path: string, body?: object, method = body ? "PUT" : "GET", headers?: Record<string, string>,
): Promise<unknown> {
  const socketPath = process.env.OMA_WORKSPACE_SOCKET;
  if (!socketPath) throw unavailable();
  const payload = body ? JSON.stringify(body) : undefined;
  const timeout = path.endsWith("/deploy") ? 130_000 : path.endsWith("/documents/layout") ? 100_000 : method === "POST" || path.endsWith("/lifecycle") ? 70_000
    : path.endsWith("/custom-mcp") ? 15_000 : 6_000;
  return new Promise((resolve, reject) => {
    const req = request({
      socketPath, path, method,
      signal: AbortSignal.timeout(timeout),
      headers: { ...headers, ...(payload && { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }) },
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
          if (status === 200 || status === 202) {
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

export async function loadBrandAsset(id: string, asset: string) {
  if (!workspaceId.safeParse(id).success || !assetId.safeParse(asset).success) return;
  try {
    const parsed = assetResponse.safeParse(await workspaceRequest("/workspace/brands/" + id + "/assets/" + asset));
    if (!parsed.success) throw new WorkspaceRequestError(502, "The agent workspace returned an invalid asset.");
    return parsed.data;
  } catch (error) {
    if (error instanceof WorkspaceRequestError && error.status === 404) return;
    throw error;
  }
}

export async function saveWorkspaceRecord(collection: WorkspaceEdit, id: string, update: object) {
  if (!workspaceId.safeParse(id).success) throw new WorkspaceRequestError(404, "This workspace record was not found.");
  const path = collection === "brand-knowledge" ? "brands/" + id + "/knowledge" : collection + "/" + id;
  await workspaceRequest("/workspace/" + path, update);
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
      if (result.id !== id) {
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

type GenerateCampaignMcp = (required: RequiredIntegration[]) => Promise<{ url: string } | { error: string }>;

export type CampaignConfigurationResult = {
  mcpToolCount?: number;
  staged?: boolean;
  configuration?: CampaignConfiguration;
  error?: string;
  synced?: boolean;
  deployed?: boolean;
  state?: "paused" | "pausing" | "resumed";
};

const pendingCampaignEdits = new Map<string, Promise<void>>();

async function withCampaignEdit<T>(id: string, edit: () => Promise<T>) {
  const before = pendingCampaignEdits.get(id) ?? Promise.resolve();
  let release!: () => void;
  const complete = new Promise<void>((resolve) => { release = resolve; });
  const queued = before.then(() => complete);
  pendingCampaignEdits.set(id, queued);
  await before;
  try {
    return await edit();
  } finally {
    release();
    if (pendingCampaignEdits.get(id) === queued) pendingCampaignEdits.delete(id);
  }
}

async function editableCampaign(id: string, expectedRevision?: string) {
  if (!workspaceId.safeParse(id).success) throw new WorkspaceRequestError(404, "Campaign not found.");
  const workspace = await loadAgentWorkspace();
  if (workspace.error) throw new WorkspaceRequestError(503, workspace.error);
  const campaign = workspace.records?.campaigns.find((item) => item.id === id);
  if (!campaign?.configuration) throw new WorkspaceRequestError(404, "Campaign settings were not found.");
  if (expectedRevision && campaign.configuration.revision !== expectedRevision) {
    throw new WorkspaceRequestError(409, "This campaign changed. Reload it and try again.");
  }
  return { campaign, configuration: campaign.configuration };
}

/** The VM owns the live MCP check and the subsequent revision-guarded save. */
export async function saveCampaignCustomMcp(id: string, input: unknown): Promise<CampaignConfigurationResult> {
  const parsed = z.object({ revision, integrationId: publicationCampaignId, url: z.string().trim().min(1).max(2048) }).safeParse(input);
  if (!workspaceId.safeParse(id).success || !parsed.success) {
    throw new WorkspaceRequestError(422, "Reload the campaign and enter an HTTPS MCP endpoint.");
  }
  const { toolCount } = z.object({ toolCount: z.number().int().positive() }).parse(await workspaceRequest(
    "/workspace/campaigns/" + id + "/custom-mcp", parsed.data,
  ));
  return { mcpToolCount: toolCount };
}

async function syncCampaignRecord(
  id: string, expectedRevision: string, write?: (revision: string) => Promise<string>, expectedMode?: CampaignMode,
): Promise<CampaignConfigurationResult & { configuration: CampaignConfiguration }> {
  const { campaign, configuration } = await editableCampaign(id, expectedRevision);
  const stopped = await pauseCampaignForSync(id, campaign.lifecycleState, configuration.revision);
  let synced: CampaignConfiguration;
  try {
    const latest = write ? await write(stopped.revision) : stopped.revision;
    synced = campaignConfiguration.parse(await workspaceRequest(
      "/workspace/campaigns/" + id + "/sync", { revision: latest }, "POST",
    ));
    if (expectedMode && synced.mode !== expectedMode) throw new Error("Unexpected synced mode");
  } catch {
    throw new WorkspaceRequestError(502, stopped.resume
      ? "Campaign stopped. The changes could not be confirmed. Review them and retry syncing before resuming."
      : "Couldn’t confirm the campaign changes. Review the saved record and retry syncing.");
  }
  if (stopped.resume) {
    return { configuration: { ...synced, revision: await resumeCampaignAfterSync(id, synced.revision) },
      synced: true, state: "resumed" as const };
  }
  return campaign.installationState === "" || campaign.installationState === "draft"
    ? { configuration: synced, staged: true }
    : { configuration: synced, synced: true, state: "paused" as const };
}

/** Save publishing mode and sync its revision without passing credentials. */
export async function saveCampaignMode(id: string, input: unknown) {
  const parsed = z.object({ revision, mode: campaignMode }).safeParse(input);
  if (!workspaceId.safeParse(id).success || !parsed.success) {
    throw new WorkspaceRequestError(422, "Choose an available campaign mode.");
  }
  return withCampaignEdit(id, async () => {
    await syncCampaignRecord(id, parsed.data.revision, async (currentRevision) => {
      const saved = campaignConfiguration.parse(await workspaceRequest("/workspace/campaigns/" + id + "/mode", {
        mode: parsed.data.mode, revision: currentRevision,
      }));
      if (saved.mode !== parsed.data.mode) throw new Error("Unexpected saved mode");
      return saved.revision;
    }, parsed.data.mode);
    return parsed.data.mode;
  });
}

const campaignPlan = z.object({
  revision,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(4000),
  goals: z.array(z.string().trim().min(1).max(2000)).max(32),
  plans: z.array(z.string().trim().min(1).max(2000)).max(32),
});

export async function saveCampaignPlan(id: string, input: unknown): Promise<CampaignConfigurationResult> {
  const parsed = campaignPlan.safeParse(input);
  if (!workspaceId.safeParse(id).success || !parsed.success) {
    throw new WorkspaceRequestError(422, "Check the plan fields. Use up to 32 goals and 32 steps.");
  }
  return withCampaignEdit(id, () => syncCampaignRecord(id, parsed.data.revision, async (currentRevision) => {
    const saved = z.object({ revision }).parse(await workspaceRequest("/workspace/campaigns/" + id + "/plan", {
      ...parsed.data, revision: currentRevision,
    }));
    return saved.revision;
  }));
}

const campaignLifecycle = z.object({
  id: workspaceId, state: z.enum(["paused", "pausing", "resumed"]), revision,
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
    throw new WorkspaceRequestError(412, "Campaign synced and is still stopped. Check the saved campaign settings before restarting.");
  }
  return lifecycle.revision;
}

/** Generate the MCP URL after validating the edit, then save the YAML and sync the campaign’s keys. */
export async function saveCampaignConfiguration(
  id: string, input: unknown, generateMcpUrl: GenerateCampaignMcp, start = false,
): Promise<CampaignConfigurationResult> {
  if (!workspaceId.safeParse(id).success) return { error: "Campaign not found." };
  return withCampaignEdit(id, () => applyCampaignConfiguration(id, input, generateMcpUrl, { start }));
}

async function applyCampaignConfiguration(
  id: string, input: unknown, generateMcpUrl: GenerateCampaignMcp,
  { start = false, prepareDraft = false }: { start?: boolean; prepareDraft?: boolean } = {},
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
  if (!campaign || !current) return { error: "Couldn’t load this campaign’s settings. Check that oma-agent is running." };
  if (current.revision !== settings.revision) return { error: "This campaign changed. Reload its settings and try again." };

  const install = start && campaign.installationState !== "installed";
  if (start && campaign.lifecycleState === "resumed") {
    return { configuration: current, state: "resumed" };
  }
  const stageForFirstStart = prepareDraft &&
    (campaign.installationState === "" || campaign.installationState === "draft");
  if (campaign.integrationConfigInvalid) {
    return { error: "Use a list of unique campaign integration IDs such as discord or facebook in config.yaml." };
  }
  const missingManual = campaign.manualIntegrations?.filter(({ url }) => !url) ?? [];
  if (missingManual.length) {
    return { error: "Set up custom MCP in Tools for: " + missingManual.map(({ name }) => name).join(", ") + "." };
  }
  const mcp = await generateMcpUrl(campaign.requiredIntegrations ?? []);
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
      revision: saved.revision, env, ...(install || stageForFirstStart ? { prepareDeployment: true } : {}),
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
  if (!start) {
    if (stageForFirstStart) return { configuration: saved, staged: true };
    if (!stopped.resume) return { configuration: saved, synced: true };
    try {
      const latest = await resumeCampaignAfterSync(id, saved.revision);
      return { configuration: { ...saved, revision: latest }, synced: true, state: "resumed" };
    } catch (error) {
      return { configuration: saved, error: error instanceof WorkspaceRequestError
        ? error.message : "Campaign synced, but restarting could not be confirmed." };
    }
  }
  if (install) {
    try {
      saved = campaignConfiguration.parse(await workspaceRequest(path + "/deploy", { revision: saved.revision, env }, "POST"));
    } catch (error) {
      const detail = error instanceof WorkspaceRequestError && error.status === 412
        ? " Check the saved agent records and board before retrying." : " Reload its settings and try again.";
      return { configuration: saved, error: "Campaign settings passed sync, but deployment could not be confirmed." + detail };
    }
  }
  try {
    const lifecycle = await setCampaignLifecycle(id, "resumed", saved.revision);
    const configuration = { ...saved, revision: lifecycle.revision };
    const deployed = install ? { deployed: true } : {};
    if (lifecycle.state !== "resumed") {
      return {
        configuration, ...deployed, state: lifecycle.state,
        error: lifecycle.state === "pausing" ? "Wait for the campaign to finish stopping, then retry."
          : "The campaign is still paused. Check its run settings before retrying.",
      };
    }
    return { configuration, ...deployed, synced: true, state: lifecycle.state };
  } catch (error) {
    const detail = error instanceof WorkspaceRequestError && [409, 412].includes(error.status) ? " " + error.message : "";
    return { configuration: saved, ...(install ? { deployed: true } : {}),
      error: "Couldn’t start the campaign." + (detail || " Reload its status and retry.") };
  }
}

function savedModelInput(configuration: CampaignConfiguration) {
  return { revision: configuration.revision, provider: configuration.provider, modelId: configuration.modelId,
    baseUrl: configuration.baseUrl, modelKey: "" };
}

/** Regenerate campaign MCP from the saved integration IDs, keeping the campaign lifecycle and model selection. */
export async function syncCampaignTools(id: string, expectedRevision: unknown, generateMcp: GenerateCampaignMcp) {
  const parsed = revision.safeParse(expectedRevision);
  if (!workspaceId.safeParse(id).success || !parsed.success) {
    throw new WorkspaceRequestError(422, "Reload the campaign to sync its latest tools.");
  }
  return withCampaignEdit(id, async () => {
    const { configuration } = await editableCampaign(id, parsed.data);
    return applyCampaignConfiguration(id, savedModelInput(configuration), generateMcp, { prepareDraft: true });
  });
}

export async function changeCampaignRunState(id: string, input: unknown, generateMcp: GenerateCampaignMcp) {
  const parsed = z.object({ revision, state: z.enum(["paused", "resumed"]) }).safeParse(input);
  if (!workspaceId.safeParse(id).success || !parsed.success) {
    throw new WorkspaceRequestError(422, "Choose whether to pause or start the campaign.");
  }
  return withCampaignEdit(id, async (): Promise<CampaignConfigurationResult> => {
    const { campaign, configuration } = await editableCampaign(id, parsed.data.revision);
    if (parsed.data.state === "resumed") {
      if (campaign.lifecycleState === "pausing") throw new WorkspaceRequestError(409, "Wait for the campaign to finish stopping.");
      return applyCampaignConfiguration(id, savedModelInput(configuration), generateMcp, { start: true });
    }
    if (campaign.installationState !== "installed" && campaign.lifecycleState !== "resumed") {
      throw new WorkspaceRequestError(409, "Start the campaign before pausing it.");
    }
    const stopped = await pauseCampaignForSync(id, campaign.lifecycleState, configuration.revision);
    return { state: "paused", configuration: { ...configuration, revision: stopped.revision } };
  });
}

export async function syncCampaignAgents(id: string, expectedRevision: unknown) {
  const parsed = revision.safeParse(expectedRevision);
  if (!workspaceId.safeParse(id).success || !parsed.success) throw new WorkspaceRequestError(422, "Reload the campaign to sync its latest revision.");
  return withCampaignEdit(id, () => syncCampaignRecord(id, parsed.data));
}

export async function refreshCampaignToolConnection(id: string, slug: string, generateMcp: GenerateCampaignMcp) {
  if (!workspaceId.safeParse(id).success || !validToolkitSlug(slug)) return undefined;
  return withCampaignEdit(id, async () => {
    const { campaign, configuration } = await editableCampaign(id);
    if (!campaign.requiredIntegrations?.some((tool) => tool.slug === slug) ||
        campaign.installationState !== "installed") return undefined;
    return applyCampaignConfiguration(id, savedModelInput(configuration), generateMcp);
  });
}

const campaignChanges = z.object({ revision, integrations: revision });
export type CampaignChanges = z.infer<typeof campaignChanges>;

export async function readCampaignChanges(id: string): Promise<CampaignChanges | undefined> {
  if (!workspaceId.safeParse(id).success) return undefined;
  try {
    return campaignChanges.parse(await workspaceRequest("/workspace/campaigns/" + id + "/changes"));
  } catch {
    return undefined;
  }
}

/** Sync authored records when a chat turn changed them, and regenerate MCP only when tool IDs changed. */
export async function syncCampaignChatChanges(
  id: string, previous: unknown, generateMcp: GenerateCampaignMcp,
): Promise<CampaignConfigurationResult | undefined> {
  const before = campaignChanges.safeParse(previous);
  if (!workspaceId.safeParse(id).success || !before.success) return undefined;
  return withCampaignEdit(id, async () => {
    const after = await readCampaignChanges(id);
    if (!after) return { error: "Couldn’t check campaign changes. Open Agents to sync the saved records." };
    if (before.data.revision === after.revision) return undefined;
    const { campaign, configuration } = await editableCampaign(id);
    if (before.data.integrations !== after.integrations && campaign.installationState === "installed") {
      const result = await applyCampaignConfiguration(id, savedModelInput(configuration), generateMcp);
      if (result.error && !result.configuration && campaign.lifecycleState === "resumed") {
        // Chat already changed the tool list, so stop the previously synced runtime if it cannot apply the edit.
        try {
          await pauseCampaignForSync(id, campaign.lifecycleState, configuration.revision);
          return { error: "Campaign stopped. " + result.error };
        } catch {
          return { error: result.error + " Stopping the campaign could not be confirmed. Check its status." };
        }
      }
      return result;
    }
    return syncCampaignRecord(id, configuration.revision);
  });
}

function publicationsPath(id: string) {
  if (!publicationCampaignId.safeParse(id).success) throw new WorkspaceRequestError(404, "This campaign was not found.");
  return `/workspace/campaigns/${id}/publications`;
}

export async function listWorkspacePublications(id: string, before?: number) {
  const path = publicationsPath(id);
  const cursor = before === undefined ? "" : `?before=${publicationRevision.parse(before)}`;
  const result = publicationsPage.safeParse(await workspaceRequest(path + cursor));
  if (!result.success || result.data.campaign_id !== id) {
    throw new WorkspaceRequestError(502, "The agent workspace returned invalid publications.");
  }
  return result.data;
}

export async function approveWorkspacePublication(id: string, item: string, revision: number, approver: string) {
  const path = publicationsPath(id);
  if (!publicationId.safeParse(item).success) throw new WorkspaceRequestError(404, "Publication not found.");
  const result = nativeCampaignPublication.safeParse(await workspaceRequest(`${path}/${item}/approve`, { revision, approver }, "POST"));
  if (!result.success || result.data.id !== item || result.data.revision !== revision) {
    throw new WorkspaceRequestError(502, "The agent workspace returned an invalid approval.");
  }
  return result.data;
}
