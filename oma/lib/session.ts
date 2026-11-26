import "server-only";

import { cookies } from "next/headers";

import type { SessionToken } from "@/lib/backend";
import { ACCESS_COOKIE, LEGACY_REFRESH_COOKIE, accessCookieOptions } from "@/lib/cookies";

/**
 * Session cookie handling.
 *
 * Calling `set`/`delete` is only legal in a Server Function or Route Handler, which
 * is why this is imported by Server Actions and `proxy.ts` and never by a page.
 */

export async function setToken(token: SessionToken): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ACCESS_COOKIE, token.access_token, accessCookieOptions(token.expires_in));
  cookieStore.delete(LEGACY_REFRESH_COOKIE);
}

export async function clearToken(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ACCESS_COOKIE);
  cookieStore.delete(LEGACY_REFRESH_COOKIE);
}

export async function getAccessToken(): Promise<string | null> {
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}
