/** Issues and verifies signed access and refresh JWTs with separate audiences and keys. */

import jwt from "jsonwebtoken";

import { isUuid } from "../common/uuid";
import type { Settings } from "../settings";

const ACCESS_AUDIENCE = "fastapi-users:auth";
const REFRESH_AUDIENCE = "oma:refresh";
const REFRESH_TYPE = "refresh";

function sessionVersionClaim(value: unknown): number | null {
  // Tokens issued before account approval belong to the original session version.
  if (value === undefined) return 0;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function signAccessToken(userId: string, settings: Settings, sessionVersion = 0): string {
  return jwt.sign({ sub: userId, aud: [ACCESS_AUDIENCE], session_version: sessionVersion }, settings.secretKey, {
    algorithm: "HS256",
    expiresIn: settings.accessTokenLifetimeSeconds,
    noTimestamp: true,
  });
}

export function signRefreshToken(userId: string, jti: string, settings: Settings, sessionVersion: number): string {
  return jwt.sign(
    { sub: userId, jti, type: REFRESH_TYPE, aud: [REFRESH_AUDIENCE], session_version: sessionVersion },
    settings.refreshSecretKey,
    {
      algorithm: "HS256",
      expiresIn: settings.refreshTokenLifetimeSeconds,
      noTimestamp: true,
    },
  );
}

export function readAccessToken(token: string, settings: Settings): { sub: string; sessionVersion: number } | null {
  try {
    const payload = jwt.verify(token, settings.secretKey, {
      algorithms: ["HS256"],
      audience: ACCESS_AUDIENCE,
    });
    if (typeof payload === "string" || typeof payload.sub !== "string" || !isUuid(payload.sub)) return null;
    const sessionVersion = sessionVersionClaim(payload.session_version);
    if (sessionVersion === null) return null;
    return { sub: payload.sub, sessionVersion };
  } catch {
    return null;
  }
}

/** Returns a verified subject and token ID suitable for the refresh-token lookup. */
export function readRefreshToken(
  token: string,
  settings: Settings,
): { sub: string; jti: string; sessionVersion: number } | null {
  try {
    const payload = jwt.verify(token, settings.refreshSecretKey, {
      algorithms: ["HS256"],
      audience: REFRESH_AUDIENCE,
    });
    if (
      typeof payload === "string" ||
      payload.type !== REFRESH_TYPE ||
      typeof payload.sub !== "string" ||
      !isUuid(payload.sub) ||
      typeof payload.jti !== "string" ||
      !isUuid(payload.jti)
    ) {
      return null;
    }
    const sessionVersion = sessionVersionClaim(payload.session_version);
    if (sessionVersion === null) return null;
    return { sub: payload.sub, jti: payload.jti, sessionVersion };
  } catch {
    return null;
  }
}
