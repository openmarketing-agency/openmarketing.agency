/** Signs in with a long-lived access token and ends sessions by bumping the account's session version. */

import { getDb, writeTransaction } from "@/lib/db";

import { ErrorCode, apiError } from "../common/api-error";
import { tokenBody } from "../common/serialize";
import { loadSettings } from "../settings";
import { hashPassword, PASSWORD_MAX_LENGTH, verifyPassword } from "./password";
import { signAccessToken } from "./tokens";
import { findUser, userColumns, type User } from "./users";

function badCredentials() {
  return apiError(400, ErrorCode.LOGIN_BAD_CREDENTIALS);
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
    return tokenBody(signAccessToken(current.id, settings, current.session_version), settings.accessTokenLifetimeSeconds);
  });
}

/** Ends every session for the account: tokens signed with the old session version stop working. */
export function revokeAllSessions(userId: string): void {
  getDb().prepare("UPDATE users SET session_version = session_version + 1 WHERE id = ?").run(userId);
}
