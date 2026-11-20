import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { me, refreshTokens, type TokenPair } from "@/lib/backend";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessCookieOptions,
  cookieHeaderWith,
  refreshCookieOptions,
} from "@/lib/cookies";
import { isExpiring } from "@/lib/jwt";

/**
 * Renamed from `middleware.ts` in Next.js 16.
 *
 * Two jobs, both explicit:
 *
 * 1. **Renew the access token.** Access tokens live 15 minutes, so before a request
 *    is rendered this exchanges an expired one for a fresh pair (the backend rotates
 *    the refresh token on every use). Refreshing here is what lets Server Components
 *    simply read a valid token from the cookie; Server Components cannot set cookies.
 * 2. **Optimistic redirects** for protected and auth-only pages.
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
  "/api/connections/callback",
]);

/** Signed-in visitors get bounced from these to the dashboard. */
const AUTH_PAGES = ["/login", "/register"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

const pendingRefreshes = new Map<string, ReturnType<typeof refreshTokens>>();

function refreshBrowserSession(refreshToken: string) {
  // Parallel renders may present the same cookies before the first response reaches
  // the browser. Coalesce only overlapping Proxy requests, leaving bearer API replay
  // detection in the identity service independent.
  const key = createHash("sha256").update(refreshToken).digest("base64url");
  const existing = pendingRefreshes.get(key);
  if (existing) return existing;

  const refresh = refreshTokens(refreshToken).finally(() => pendingRefreshes.delete(key));
  pendingRefreshes.set(key, refresh);
  return refresh;
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
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

  let authenticated = Boolean(accessToken && !isExpiring(accessToken));
  let renewed: TokenPair | null = null;
  // A refresh token that the API rejects is dead: revoked, replayed or expired.
  let sessionDropped = false;

  if (!authenticated && refreshToken) {
    const result = await refreshBrowserSession(refreshToken);
    if (result.ok) {
      renewed = result.data;
      authenticated = true;
    } else {
      sessionDropped = result.error.status === 401;
    }
  }

  const onAuthPage = AUTH_PAGES.includes(pathname);
  if (onAuthPage && authenticated && !renewed && accessToken) {
    // An unexpired cookie can belong to a revoked session.
    // Confirm it before redirecting back to a page whose DAL would reject it.
    const current = await me(accessToken);
    authenticated = current.ok;
    if (!current.ok && current.error.status === 401) sessionDropped = true;
  }

  let response: NextResponse;

  if (onAuthPage && authenticated) {
    response = NextResponse.redirect(new URL("/dashboard", request.url));
  } else if (!isPublic(pathname) && !authenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    response = NextResponse.redirect(loginUrl);
  } else if (renewed) {
    // Hand the fresh tokens to this same render, not just to the browser.
    const headers = new Headers(request.headers);
    headers.set(
      "cookie",
      cookieHeaderWith(request.cookies.getAll(), {
        [ACCESS_COOKIE]: renewed.access_token,
        [REFRESH_COOKIE]: renewed.refresh_token,
      }),
    );
    response = NextResponse.next({ request: { headers } });
  } else {
    response = NextResponse.next();
  }

  if (renewed) {
    response.cookies.set(
      ACCESS_COOKIE,
      renewed.access_token,
      accessCookieOptions(renewed.expires_in),
    );
    response.cookies.set(
      REFRESH_COOKIE,
      renewed.refresh_token,
      refreshCookieOptions(),
    );
  } else if (sessionDropped) {
    response.cookies.delete(ACCESS_COOKIE);
    response.cookies.delete(REFRESH_COOKIE);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except Next.js internals and static files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
