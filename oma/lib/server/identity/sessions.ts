/** Issues and rotates signed sessions with atomic refresh-token updates in SQLite. */

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { getDb, writeTransaction } from "@/lib/db";

import { ErrorCode, apiError } from "../common/api-error";
import { tokenPairBody } from "../common/serialize";
import { loadSettings, type Settings } from "../settings";
import { hashPassword, PASSWORD_MAX_LENGTH, verifyPassword } from "./password";
import { readRefreshToken, signAccessToken, signRefreshToken } from "./tokens";
import { findUser, userColumns, type User } from "./users";

interface RefreshRow {
  expires_at: number;
  revoked_at: number | null;
  replaced_by_jti: string | null;
}

function invalidRefresh() {
  return apiError(401, ErrorCode.INVALID_REFRESH_TOKEN);
}

function badCredentials() {
  return apiError(400, ErrorCode.LOGIN_BAD_CREDENTIALS);
}

function issuePair(db: DatabaseSync, user: User, jti: string, settings: Settings, now: number) {
  const refreshToken = signRefreshToken(user.id, jti, settings, user.session_version);
  db.prepare("DELETE FROM refresh_tokens WHERE expires_at <= ?").run(now);
  db.prepare("INSERT INTO refresh_tokens (jti, user_id, expires_at) VALUES (?, ?, ?)")
    .run(jti, user.id, now + settings.refreshTokenLifetimeSeconds * 1000);
  return tokenPairBody(signAccessToken(user.id, settings, user.session_version), refreshToken,
    settings.accessTokenLifetimeSeconds);
}

export async function login(username: string, password: string) {
  if (password.length > PASSWORD_MAX_LENGTH) throw badCredentials();
  const settings = loadSettings();
  const db = getDb();
  const user = db.prepare(`SELECT ${userColumns} FROM users WHERE email = ?`)
    .get(username.trim().toLowerCase()) as User | undefined;
  if (!user) {
    // Match the password verification cost even for an unknown email.
    await hashPassword(password);
    throw badCredentials();
  }

  const { verified, updatedHash } = await verifyPassword(password, user.hashed_password);
  if (!verified) throw badCredentials();
  return writeTransaction(db, () => {
    const current = findUser(user.id);
    if (!current || current.hashed_password !== user.hashed_password || current.email !== user.email) {
      throw badCredentials();
    }
    if (updatedHash) {
      db.prepare("UPDATE users SET hashed_password = ? WHERE id = ?").run(updatedHash, user.id);
    }
    return issuePair(db, current, randomUUID(), settings, Date.now());
  });
}

/** Consumes a refresh token once. Replaying a rotated token revokes the current sessions. */
export function rotateRefreshToken(token: string) {
  const settings = loadSettings();
  const claims = readRefreshToken(token, settings);
  if (!claims) throw invalidRefresh();

  const db = getDb();
  const pair = writeTransaction(db, () => {
    const user = findUser(claims.sub);
    if (!user || user.session_version !== claims.sessionVersion) return null;
    const row = db.prepare("SELECT * FROM refresh_tokens WHERE jti = ? AND user_id = ?")
      .get(claims.jti, user.id) as RefreshRow | undefined;
    const now = Date.now();
    if (!row || row.expires_at <= now) return null;
    if (row.revoked_at !== null) {
      if (row.replaced_by_jti) revokeAllSessions(user.id);
      return null;
    }

    const successor = randomUUID();
    db.prepare("UPDATE refresh_tokens SET revoked_at = ?, replaced_by_jti = ? WHERE jti = ?")
      .run(now, successor, claims.jti);
    return issuePair(db, user, successor, settings, now);
  });
  if (!pair) throw invalidRefresh();
  return pair;
}

export function logout(token: string): void {
  const claims = readRefreshToken(token, loadSettings());
  if (!claims) return;
  getDb().prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE jti = ? AND user_id = ? AND revoked_at IS NULL")
    .run(Date.now(), claims.jti, claims.sub);
}

export function revokeAllSessions(userId: string): void {
  getDb().prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
    .run(Date.now(), userId);
}
