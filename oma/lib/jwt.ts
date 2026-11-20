/**
 * Unverified JWT payload reading.
 *
 * The payload is only read for an *optimistic* expiry check, exactly like the
 * cookie-only checks Next.js documents for `proxy.ts`. The backend remains the only
 * component that verifies a signature, so nothing here is a security decision.
 */

export type JwtPayload = {
  sub?: string;
  exp?: number;
  aud?: string[] | string;
  jti?: string;
};

export function decodeJwtPayload(token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload: unknown = JSON.parse(json);
    return typeof payload === "object" && payload !== null ? (payload as JwtPayload) : null;
  } catch {
    return null;
  }
}

/**
 * True when the token is missing an `exp`, is malformed, or expires within `skew`.
 * The skew keeps a token that is about to expire from being sent on a request that
 * would then fail.
 */
export function isExpiring(token: string, skewSeconds = 20): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return true;
  return payload.exp * 1000 - skewSeconds * 1000 <= Date.now();
}

export function expiresAt(token: string): Date | null {
  const payload = decodeJwtPayload(token);
  return payload?.exp ? new Date(payload.exp * 1000) : null;
}
