import { NextResponse, type NextRequest } from "next/server";

import { me } from "@/lib/backend";
import { ACCESS_COOKIE, LEGACY_REFRESH_COOKIE } from "@/lib/cookies";
import { isExpiring } from "@/lib/jwt";

/**
 * Renamed from `middleware.ts` in Next.js 16.
 *
 * Performs **optimistic redirects** for protected and auth-only pages. Sessions are a
 * single long-lived access token, so there is nothing to renew here: an expired token
 * means signing in again.
 *
 * This is *not* the authorization boundary. `lib/dal.ts` re-checks every protected
 * read against the API, per the Next.js guidance that proxy checks are optimistic
 * only.
 */

/**
 * Everything not listed here is treated as protected, so a new page cannot leak by
 * being forgotten: adding one without touching this file keeps it private. (A
 * hardcoded list of *protected* prefixes fails the other way — a new page is public
 * until someone remembers to add it, and a redirect thrown inside a streamed
 * Suspense boundary has already sent a 200 to the browser.)
 */
const PUBLIC_PATHS = new Set([
  "/",
  "/login",
  "/register",
]);

/** Signed-in visitors get bounced from these to the dashboard. */
const AUTH_PAGES = ["/login", "/register"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  // The bearer API, probes, and Swagger have their own authorization rules.
  if (pathname.startsWith("/api/v1/") || pathname === "/api/v1" ||
      pathname === "/health" || pathname === "/health/ready" ||
      pathname === "/docs" || pathname.startsWith("/docs/") ||
      pathname === "/openapi.json" || pathname === "/openapi.yaml") {
    return NextResponse.next();
  }

  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  let authenticated = Boolean(accessToken && !isExpiring(accessToken));
  // An expired cookie, or one the API rejects (signed out elsewhere, password changed), is dead.
  let sessionDropped = Boolean(accessToken) && !authenticated;

  const onAuthPage = AUTH_PAGES.includes(pathname);
  if (onAuthPage && authenticated && accessToken) {
    // An unexpired cookie can belong to a revoked session.
    // Confirm it before redirecting back to a page whose DAL would reject it.
    const current = await me(accessToken);
    authenticated = current.ok;
    if (!current.ok && current.error.status === 401) sessionDropped = true;
  }

  let response: NextResponse;
  if (onAuthPage && authenticated) {
    response = NextResponse.redirect(new URL("/dashboard", request.url));
  } else if (!authenticated && !isPublic(pathname) && pathname !== "/api/agent/activity") {
    // The activity endpoint returns its own JSON 401 after checking the session.
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    response = NextResponse.redirect(loginUrl);
  } else {
    response = NextResponse.next();
  }

  if (sessionDropped) response.cookies.delete(ACCESS_COOKIE);
  if (request.cookies.has(LEGACY_REFRESH_COOKIE)) response.cookies.delete(LEGACY_REFRESH_COOKIE);
  return response;
}

export const config = {
  matcher: [
    // Everything except Next.js internals and static files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
