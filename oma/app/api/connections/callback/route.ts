import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/dal";
import { appOrigin, toolConnections } from "@/lib/composio";
import { accessCookieOptions } from "@/lib/cookies";
import { refreshCampaignToolConnection } from "@/lib/server/agent-workspace";
import { generateCampaignMcpUrl } from "@/lib/tool-workspace";
import {
  CONNECTION_COOKIE,
  CONNECTION_CALLBACK_PATH,
  readConnectionAttempt,
} from "@/lib/connection-attempt";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", appOrigin()));
  const jar = await cookies();
  const sessionUri = request.nextUrl.searchParams.get("session_uri");
  const attempt = readConnectionAttempt(
    jar.get(CONNECTION_COOKIE)?.value,
    user.id,
    request.nextUrl.searchParams.get("state"),
    Boolean(sessionUri),
  );
  let result = "expired";
  if (attempt) {
    try {
      result = await (await toolConnections()).complete(
        attempt.userId,
        attempt,
        sessionUri ?? undefined,
      );
    } catch {
      result = "failed";
    }
  }
  if (result === "connected" && attempt?.playbookId && attempt.returnTo.startsWith("/campaigns/")) {
    try {
      const sync = await refreshCampaignToolConnection(attempt.playbookId, attempt.toolId,
        (required) => generateCampaignMcpUrl(user.id, required));
      if (sync?.error) result = "connected-sync-failed";
    } catch {
      result = "connected-sync-failed";
    } finally {
      revalidatePath("/campaigns/" + attempt.playbookId);
      revalidatePath("/dashboard");
    }
  }
  const target = new URL(attempt?.returnTo ?? "/connections", appOrigin());
  target.searchParams.set("connection_result", result);
  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.cookies.set(CONNECTION_COOKIE, "", {
    ...accessCookieOptions(0),
    path: CONNECTION_CALLBACK_PATH,
  });
  return response;
}
