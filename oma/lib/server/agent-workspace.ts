/** Validates and transports console requests to oma-agent's private workspace socket. */

import { request } from "node:http";
import { z } from "zod";
import { campaignPlanChatSchema, campaignPlanResponseSchema, campaignPlanSchema } from "../campaign-plan";

export const workspaceId = z.string().max(64).regex(/^[a-z0-9]+(?:[-_][a-z0-9]+|__[a-z0-9]+)*$/);
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const publicationCampaignId = z.string().max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const campaignMode = z.enum(["yolo", "approve", "control"]);
const publicationId = z.string().regex(/^[a-f0-9]{32}$/);
export const publicationRevision = z.number().int().positive();
const publication = z.object({
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
  campaign_id: publicationCampaignId, mode: campaignMode, publications: z.array(publication), next_cursor: z.number().int().positive().nullable(),
});
export type CampaignPublication = z.infer<typeof publication>;
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
const campaignConfiguration = z.object({
  revision, provider: z.string(), modelId: z.string(), baseUrl: z.string(),
  hasModelKey: z.boolean(), usesEnvironmentKey: z.boolean().optional(),
});
const campaign = record.extend({
  playbookId: z.string(), version: z.string(), orchestrator: z.string(), agentIds: strings,
  goals: strings, plans: strings, board: z.string(),
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
const standaloneModels = z.object({ revision, default: z.string(), maintenance: z.string() });
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

async function workspaceRequest(path: string, body?: object, method = body ? "PUT" : "GET"): Promise<unknown> {
  const socketPath = process.env.OMA_WORKSPACE_SOCKET;
  if (!socketPath) throw unavailable();
  const payload = body ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const req = request({
      socketPath, path, method,
      signal: AbortSignal.timeout(path.endsWith("/deploy") ? 130_000 : method === "POST" ? 70_000 : 6_000),
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

const modelBaseUrl = z.union([z.literal(""), z.string().max(2048).refine((value) => {
  const url = URL.parse(value);
  return url?.protocol === "https:" && !url.username && !url.password && !/[?#\s\\]/.test(value);
})]);
const hostedComposioUrl = z.string().max(2048).regex(/^(?:https:\/\/backend\.composio\.dev\/tool_router\/(?:v3\/)?[A-Za-z0-9_-]+\/mcp\/?)?$/);
const keyValue = z.string().max(4096).regex(/^[\x20-\x7e]*$/);
const modelProvider = z.string().trim().max(80).regex(/^(?:[A-Za-z0-9_.-]+(?:[:@][A-Za-z0-9_.-]+)?)?$/);
const modelIdentifier = z.string().trim().max(200).regex(/^[^\s$]*$/);

const standaloneModelUpdate = z.object({
  revision,
  modelId: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/),
});

export async function saveStandaloneModel(input: unknown): Promise<StandaloneModelResult> {
  const parsed = standaloneModelUpdate.safeParse(input);
  if (!parsed.success) return { error: "Enter a valid model ID for both agents." };
  try {
    const result = standaloneModels.safeParse(await workspaceRequest("/workspace/agents/model", parsed.data, "POST"));
    if (!result.success || result.data.default !== parsed.data.modelId || result.data.maintenance !== parsed.data.modelId) {
      return { error: "Could not confirm the model on both agents. Reload the page to check their settings." };
    }
    return { models: result.data };
  } catch (error) {
    if (error instanceof WorkspaceRequestError) return { error: error.message };
    throw error;
  }
}

export type CampaignModelDefaults = { provider: string; modelId: string; baseUrl: string; hasApiKey: boolean };

/** Read defaults from the server environment. The model key stays on the server. */
export function loadCampaignModelDefaults(): CampaignModelDefaults {
  const baseUrl = modelBaseUrl.safeParse(process.env.OMA_HERMES_BASE_URL?.trim() ?? "").data ?? "";
  const modelId = modelIdentifier.safeParse(process.env.OMA_HERMES_MODEL ?? "").data ?? "";
  const provider = modelProvider.safeParse(process.env.OMA_HERMES_PROVIDER ?? "").data
    || (baseUrl ? "custom" : modelId ? "openrouter" : "");
  const key = process.env.OMA_HERMES_API_KEY?.trim();
  return { provider, modelId, baseUrl, hasApiKey: Boolean(baseUrl && key && keyValue.safeParse(key).success) };
}

const campaignUpdate = z.object({
  revision,
  provider: modelProvider,
  modelId: modelIdentifier,
  baseUrl: modelBaseUrl,
  modelKey: keyValue.transform((value) => value.trim()),
  useEnvironmentKey: z.literal("true").optional(),
}).refine((input) =>
  (!(input.provider || input.baseUrl || input.modelKey) || input.modelId) && (!input.modelKey || input.baseUrl),
);

export type CampaignConfigurationResult = {
  configuration?: CampaignConfiguration;
  error?: string;
  synced?: boolean;
};

/** Generate the MCP URL after validating the edit, then save the YAML and sync the campaign’s keys. */
export async function saveCampaignConfiguration(
  id: string,
  input: unknown,
  generateMcpUrl: () => Promise<{ url: string } | { error: string }>,
  deploy = false,
): Promise<CampaignConfigurationResult> {
  const parsed = campaignUpdate.safeParse(input);
  if (!workspaceId.safeParse(id).success || !parsed.success) {
    return { error: "Check the model fields and use HTTPS for the model base URL." };
  }
  const { modelKey, useEnvironmentKey, ...settings } = parsed.data;
  let environmentKey: string | undefined;
  if (useEnvironmentKey && !modelKey) {
    const defaults = loadCampaignModelDefaults();
    if (!defaults.hasApiKey || settings.baseUrl !== defaults.baseUrl || settings.provider !== defaults.provider) {
      return { error: "Use the configured provider and base URL to sync the .env key, or enter a campaign key." };
    }
    environmentKey = process.env.OMA_HERMES_API_KEY?.trim();
  }
  const workspace = await loadAgentWorkspace();
  if (workspace.error) return { error: workspace.error };
  const current = workspace.records?.campaigns.find((item) => item.id === id)?.configuration;
  if (!current) return { error: "Couldn’t load this campaign’s settings. Check that oma-agent is running." };
  if (current.revision !== settings.revision) return { error: "This campaign changed. Reload its settings and try again." };

  const mcp = await generateMcpUrl();
  if ("error" in mcp) return { error: mcp.error };
  const url = hostedComposioUrl.safeParse(mcp.url);
  if (!url.success) return { error: "Composio returned a URL that can’t be synced to this campaign." };
  const composioUrl = url.data;
  const composioKey = composioUrl ? process.env.COMPOSIO_API_KEY?.trim() : undefined;
  if (composioUrl && (!composioKey || !keyValue.safeParse(composioKey).success)) {
    return { error: "Set COMPOSIO_API_KEY in OMA’s environment to sync a Composio MCP connection." };
  }
  const path = "/workspace/campaigns/" + id;
  let saved: CampaignConfiguration;
  try {
    saved = campaignConfiguration.parse(await workspaceRequest(path + "/config", {
      ...settings, composioUrl, setModelKey: Boolean(modelKey || environmentKey),
      ...(environmentKey ? { useEnvironmentKey: true } : {}),
    }));
  } catch (error) {
    if (error instanceof WorkspaceRequestError && [404, 409, 422].includes(error.status)) return { error: error.message };
    return { error: "Couldn’t save the campaign settings. Check that oma-agent is running." };
  }
  try {
    const updated = campaignConfiguration.parse(await workspaceRequest(path + (deploy ? "/deploy" : "/sync"), {
      revision: saved.revision,
      env: {
        ...(modelKey ? { HERMES_MODEL_API_KEY: modelKey } : {}),
        ...(environmentKey ? { OMA_HERMES_API_KEY: environmentKey } : {}),
        ...(composioKey ? { COMPOSIO_API_KEY: composioKey } : {}),
      },
    }, "POST"));
    return { configuration: updated, synced: true };
  } catch (error) {
    let recovery = "Reload campaign settings and try again.";
    if (deploy && error instanceof WorkspaceRequestError && [404, 409, 412, 422].includes(error.status)) {
      return { configuration: saved, error: error.message };
    }
    if (error instanceof WorkspaceRequestError && error.status === 412) {
      recovery = "Check that the campaign has a board and its profiles are linked to it.";
    } else if (modelKey) {
      recovery = "Reload campaign settings and re-enter the new model API key before retrying.";
    }
    const operation = deploy ? "deploy" : "sync";
    return { configuration: saved, error: "Settings were saved, but oma-agent could not " + operation + " the campaign. " + recovery };
  }
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
  const result = publication.safeParse(await workspaceRequest(`${path}/${item}/approve`, { revision, approver }, "POST"));
  if (!result.success || result.data.id !== item || result.data.revision !== revision) {
    throw new WorkspaceRequestError(502, "The agent workspace returned an invalid approval.");
  }
  return result.data;
}
