/**
 * Cookie names and options for the OMA session.
 *
 * Deliberately free of `next/headers` imports so that `proxy.ts` can share these
 * constants: the proxy runs before rendering and must not pull in request APIs.
 *
 * The OMA backend issues a Bearer-token API, so no token is ever exposed to
 * JavaScript. Both tokens live in httpOnly cookies and the browser only ever talks
 * to this Next.js app, which attaches the access token on the server.
 */

export const ACCESS_COOKIE = "oma_access";
export const REFRESH_COOKIE = "oma_refresh";

/** Matches the backend's default refresh-token lifetime. */
const REFRESH_MAX_AGE = Number(process.env.OMA_REFRESH_COOKIE_MAX_AGE ?? 2_592_000);

/**
 * `OMA_COOKIE_SECURE` overrides the default. Locally, `next dev` is not production
 * so cookies are not `Secure`; when serving a production build over plain http
 * (`next start` on localhost) set `OMA_COOKIE_SECURE=false` or the browser will drop
 * the session cookies.
 */
function secureCookies(): boolean {
  const override = process.env.OMA_COOKIE_SECURE;
  if (override === "true") return true;
  if (override === "false") return false;
  return process.env.NODE_ENV === "production";
}

type CookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
  maxAge: number;
};

export function accessCookieOptions(maxAgeSeconds: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: secureCookies(),
    maxAge: maxAgeSeconds,
  };
}

export function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: secureCookies(),
    maxAge: REFRESH_MAX_AGE,
  };
}

/**
 * Rebuilds the `cookie` request header with new token values, so a render that
 * follows a proxy-side refresh sees the fresh tokens rather than the stale ones.
 */
export function cookieHeaderWith(
  cookies: { name: string; value: string }[],
  updates: Record<string, string>,
): string {
  const parts = cookies
    .filter((cookie) => !(cookie.name in updates))
    .map((cookie) => `${cookie.name}=${cookie.value}`);
  for (const [name, value] of Object.entries(updates)) {
    parts.push(`${name}=${value}`);
  }
  return parts.join("; ");
}
