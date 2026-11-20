import "server-only";

import { cookies } from "next/headers";

import type { TokenPair } from "@/lib/backend";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessCookieOptions,
  refreshCookieOptions,
} from "@/lib/cookies";

/**
 * Session cookie handling.
 *
 * Calling `set`/`delete` is only legal in a Server Function or Route Handler, which
 * is why this is imported by Server Actions and `proxy.ts` and never by a page.
 */

export async function setTokens(tokens: TokenPair): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ACCESS_COOKIE, tokens.access_token, accessCookieOptions(tokens.expires_in));
  cookieStore.set(REFRESH_COOKIE, tokens.refresh_token, refreshCookieOptions());
}

export async function clearTokens(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ACCESS_COOKIE);
  cookieStore.delete(REFRESH_COOKIE);
}

export async function getAccessToken(): Promise<string | null> {
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}

export async function getRefreshToken(): Promise<string | null> {
  return (await cookies()).get(REFRESH_COOKIE)?.value ?? null;
}
