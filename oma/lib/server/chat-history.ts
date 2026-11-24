/** Lists and reads account-scoped transcripts from oma-agent's native Hermes session store. */

import { createHash } from "node:crypto";
import { z } from "zod";

import { type ChatHistory, type ChatMessagePage } from "../agent-chat";
import { getDb } from "../db";
import { AgentChatError, readAgentSessionApi, scopedAgentSessionId, startAgentRun } from "./agent-chat";
import { workspaceId } from "./agent-workspace";

const id = z.uuid();
const newTurn = z.object({ threadId: id, turnId: id, message: z.string(), campaignId: workspaceId.optional() });
const offsetValue = z.number().int().min(0).max(1_000_000);
const sessions = z.object({
  data: z.array(z.object({ id: z.string(), _lineage_root_id: z.string().nullish(), title: z.string().nullish(), preview: z.string().nullish() })),
  has_more: z.boolean().optional(),
});
const transcript = z.object({
  data: z.array(z.object({
    id: z.union([z.number(), z.string()]),
    session_id: z.string().optional().catch(undefined),
    role: z.string(),
    content: z.string().nullish().catch(undefined),
    display_content: z.string().nullish().catch(undefined),
    display_kind: z.string().nullish().catch(undefined),
    tool_calls: z.array(z.unknown()).nullable().optional().catch(undefined),
  })),
});
const messagePageSize = 80;
const sessionPageSize = 200;

function sessionPrefix(userId: string, campaignId?: string) {
  // The session namespace stays stable when the console signing key is rotated.
  const scope = createHash("sha256").update(JSON.stringify([userId, campaignId ?? null])).digest("hex").slice(0, 32);
  return "oma_" + scope + "_";
}

/** Read only ownership links from the retired console schema. Hermes supplies all transcript content. */
function legacySessions(userId: string, campaignId?: string) {
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'chat_threads'").get()) return [];
  const rows = db.prepare("SELECT id, session_id FROM chat_threads WHERE user_id = ? AND campaign_id IS ?")
    .all(userId, campaignId ?? null) as { id: string; session_id: string }[];
  return rows.filter((row) => id.safeParse(row.id).success && id.safeParse(row.session_id).success);
}

function resolveSessionId(userId: string, threadId: string, campaignId?: string) {
  return legacySessions(userId, campaignId).find((row) => row.id === threadId)?.session_id
    ?? sessionPrefix(userId, campaignId) + threadId.toLowerCase();
}

export async function sendNativeChatTurn(userId: string, input: unknown) {
  const parsed = newTurn.safeParse(input);
  if (!parsed.success) throw new AgentChatError(422, "Enter a valid chat message and try again.");
  const { threadId, turnId, message, campaignId } = parsed.data;
  return startAgentRun(userId, {
    sessionId: resolveSessionId(userId, threadId, campaignId), turnId, message, campaignId,
  }, "default");
}

async function readTranscript(sessionId: string, offset: number, campaignId?: string): Promise<ChatMessagePage> {
  let response;
  try {
    response = await readAgentSessionApi("/" + sessionId + "/messages?order=latest&include_compacted=true&limit="
      + messagePageSize + "&offset=" + offset);
  } catch (error) {
    if (error instanceof AgentChatError && error.status === 404 && offset === 0) {
      return { messages: [], nextOffset: null };
    }
    throw error;
  }
  const { payload, redact } = response;
  const parsed = transcript.safeParse(payload);
  if (!parsed.success) throw new AgentChatError(502, "oma-agent returned an invalid chat transcript.");
  const campaignSuffix = campaignId ? "\n\nCampaign ID: " + campaignId : "";
  const messages: ChatMessagePage["messages"] = [];
  for (const row of parsed.data.data) {
    if ((row.role !== "user" && row.role !== "assistant") || typeof row.content !== "string"
      || row.display_kind === "hidden" || row.display_kind === "commentary" || row.tool_calls?.length) continue;
    const content = row.role === "user" && row.display_kind === "steer" ? row.display_content ?? row.content : row.content;
    const text = row.role === "user" && campaignSuffix && content.endsWith(campaignSuffix)
      ? content.slice(0, -campaignSuffix.length) : content;
    if (text.trim()) messages.push({ id: (row.session_id ?? sessionId) + ":" + row.id, role: row.role, text: redact(text) });
  }
  return { messages, nextOffset: parsed.data.data.length === messagePageSize ? offset + messagePageSize : null };
}

export async function loadOlderChatMessages(userId: string, threadId: unknown, offset: unknown, campaignId?: string) {
  const input = z.object({ threadId: id, offset: offsetValue, campaignId: workspaceId.optional() }).safeParse({ threadId, offset, campaignId });
  if (!input.success) throw new AgentChatError(422, "Invalid chat history request.");
  return readTranscript(resolveSessionId(userId, input.data.threadId, campaignId), input.data.offset, campaignId);
}

export async function loadChatHistory(userId: string, campaignId?: string, selected?: string | string[]): Promise<ChatHistory> {
  const chats: ChatHistory["chats"] = [];
  try {
    const prefix = sessionPrefix(userId, campaignId);
    const known = new Map(legacySessions(userId, campaignId).map((row) => [row.session_id, row.id]));
    const seen = new Set<string>();
    for (let offset = 0; offset <= 1_000_000; offset += sessionPageSize) {
      const { payload, redact } = await readAgentSessionApi("?source=api_server&limit=" + sessionPageSize + "&offset=" + offset);
      const page = sessions.safeParse(payload);
      if (!page.success) throw new AgentChatError(502, "oma-agent returned an invalid list of conversations.");
      for (const row of page.data.data) {
        const root = row._lineage_root_id ?? row.id;
        const threadId = known.get(root) ?? known.get(row.id) ?? (root.startsWith(prefix) ? scopedAgentSessionId.exec(root)?.[1] : undefined);
        if (!threadId || !id.safeParse(threadId).success || seen.has(threadId)) continue;
        seen.add(threadId);
        const label = (row.title || row.preview || "Conversation").replace(/\s+/g, " ").trim();
        chats.push({ id: threadId, title: redact(label).slice(0, 80) || "Conversation" });
      }
      if (!page.data.data.length || !(page.data.has_more ?? page.data.data.length >= sessionPageSize)) break;
    }

    const requested = id.safeParse(selected);
    const active = selected === "new" ? undefined : requested.success ? requested.data : chats[0]?.id;
    return active ? { chats, active: { id: active, ...await readTranscript(resolveSessionId(userId, active, campaignId), 0, campaignId) } }
      : { chats };
  } catch (error) {
    if (!(error instanceof AgentChatError)) throw error;
    return { chats, error: "Couldn’t load conversation history from oma-agent. " + error.message };
  }
}
