/** Validates bearer tokens against the current account and its session version. */

import { unauthorized } from "../common/api-error";
import { loadSettings } from "../settings";
import { readAccessToken } from "./tokens";
import { findUser } from "./users";

export function requireUser(request: Request) {
  const authorization = request.headers.get("authorization")?.trim();
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const claims = token && readAccessToken(token, loadSettings());
  if (!claims) throw unauthorized();

  const user = findUser(claims.sub);
  if (!user || user.session_version !== claims.sessionVersion) throw unauthorized();
  return user;
}
