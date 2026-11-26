/**
 * Cookie names and options for the OMA session.
 *
 * Deliberately free of `next/headers` imports so that `proxy.ts` can share these
 * constants: the proxy runs before rendering and must not pull in request APIs.
 *
 * The OMA backend issues a Bearer-token API, so no token is ever exposed to
 * JavaScript. The long-lived access token lives in an httpOnly cookie and the browser only ever talks
 * to this Next.js app, which attaches the access token on the server.
 */

export const ACCESS_COOKIE = "oma_access";
/** Set by earlier versions that renewed sessions with refresh tokens; cleared on sight. */
export const LEGACY_REFRESH_COOKIE = "oma_refresh";

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
