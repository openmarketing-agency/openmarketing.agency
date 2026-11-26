/** Issues and verifies the signed, long-lived access JWT. */

import jwt from "jsonwebtoken";

import { isUuid } from "../common/uuid";
import type { Settings } from "../settings";

const ACCESS_AUDIENCE = "fastapi-users:auth";

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
