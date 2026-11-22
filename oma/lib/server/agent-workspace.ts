/** Validates and transports console requests to oma-agent's private workspace socket. */

import { request } from "node:http";
import { z } from "zod";

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
const campaign = record.extend({
  playbookId: z.string(), version: z.string(), orchestrator: z.string(), agentIds: strings,
  goals: strings, plans: strings, board: z.string(),
  installationState: z.string().optional(), model: z.string().optional(),
});
const agent = record.extend({
  campaignId: z.string(), toolsets: strings, skills: strings.optional(), model: z.string().optional(),
  jobs: z.array(z.object({
    name: z.string(), schedule: z.string(), timezone: z.string().optional(), repeat: z.number().int().positive().optional(),
  })),
});
const inventory = z.object({
  brands: z.array(brand), playbooks: z.array(playbook), campaigns: z.array(campaign), agents: z.array(agent),
  skipped: z.number().int().nonnegative(),
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

async function workspaceRequest(path: string, body?: object): Promise<unknown> {
  const socketPath = process.env.OMA_WORKSPACE_SOCKET;
  if (!socketPath) throw unavailable();
  const payload = body ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const req = request({
      socketPath, path, method: payload ? "PUT" : "GET",
      signal: AbortSignal.timeout(6_000),
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
