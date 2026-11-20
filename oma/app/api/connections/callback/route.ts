import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/dal";
import { appOrigin, SEARCH_CONSOLE, toolConnections } from "@/lib/composio";
import { queueCampaign } from "@/lib/server/marketing/state";
import { accessCookieOptions } from "@/lib/cookies";
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
      if (result === "connected" && attempt.toolId === SEARCH_CONSOLE) queueCampaign(user.id);
    } catch {
      result = "failed";
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
