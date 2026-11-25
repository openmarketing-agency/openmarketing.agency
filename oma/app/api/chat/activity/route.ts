/** Read an account-owned Hermes session or stream an account-bound run. */
import { getSessionUser } from "@/lib/dal";
import { AgentChatError, streamAgentRunActivity } from "@/lib/server/agent-chat";
import { readChatSession } from "@/lib/server/chat-history";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Sign in to view chat activity." }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const handle = params.get("run");
  try {
    if (handle) {
      const body = await streamAgentRunActivity(user.id, handle, request.signal, "default", "chat");
      return new Response(body, { headers: { ...headers, "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no" } });
    }
    return Response.json(await readChatSession(user.id, params.get("thread"), params.get("campaign") ?? undefined), { headers });
  } catch (error) {
    if (error instanceof AgentChatError) {
      // Stop EventSource retries for an unavailable, expired, or unowned run; snapshots still work.
      if (handle && [401, 403, 404].includes(error.status)) return new Response(null, { status: 204, headers });
      return Response.json({ error: error.message }, { status: error.status, headers });
    }
    throw error;
  }
}
