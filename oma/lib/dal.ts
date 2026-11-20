import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { me, type ApiUser } from "@/lib/backend";
import { ACCESS_COOKIE } from "@/lib/cookies";

/**
 * Data Access Layer.
 *
 * Every authorization decision goes through here and is settled by the backend, not
 * by the cookie contents: an access token that the API rejects means "not signed in",
 * no matter what it claims. `proxy.ts` only performs optimistic redirects.
 *
 * `cache()` deduplicates these calls within a single render pass, so the header, the
 * page and any nested component share one backend request.
 */

/** The signed-in user, or null. Never redirects, so public pages can use it. */
export const getSessionUser = cache(async (): Promise<ApiUser | null> => {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return null;

  // JWT verification reads the clock and must run on the incoming request.
  await connection();
  const result = await me(token);
  return result.ok ? result.data : null;
});

/** The signed-in user, redirecting to the login page when there is none. */
export const requireUser = cache(async (): Promise<ApiUser> => {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
});

/** The signed-in user's token, for calls that must run as them. */
export const requireAccessToken = cache(async (): Promise<string> => {
  await requireUser();
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");
  return token;
});
