/** Creates and updates the single account owned by this installation. */

import { randomUUID } from "node:crypto";

import { getDb, writeTransaction } from "@/lib/db";

import { ErrorCode, apiError, passwordError, unauthorized } from "../common/api-error";
import { hashPassword, validatePassword } from "./password";
import type { UserCreateInput, UserUpdateInput } from "./user-input";

export interface User {
  id: string;
  email: string;
  hashed_password: string;
  session_version: number;
}

export const userColumns = "id, email, hashed_password, session_version";

export function findUser(id: string): User | undefined {
  return getDb().prepare(`SELECT ${userColumns} FROM users WHERE id = ?`).get(id) as User | undefined;
}

function registrationClosed() {
  return apiError(409, ErrorCode.REGISTRATION_CLOSED);
}

async function passwordHash(password: string, code: string) {
  const error = validatePassword(password);
  if (error) throw passwordError(400, code, error);
  return hashPassword(password);
}

export async function registerUser({ email, password }: UserCreateInput): Promise<User> {
  const db = getDb();
  if (db.prepare("SELECT 1 FROM users WHERE slot = 1").get()) throw registrationClosed();

  const hash = await passwordHash(password, ErrorCode.REGISTER_INVALID_PASSWORD);
  // The unique slot also closes registration when two first requests race.
  const user = db.prepare(`
    INSERT INTO users (id, email, hashed_password) VALUES (?, ?, ?)
    ON CONFLICT (slot) DO NOTHING
    RETURNING ${userColumns}
  `).get(randomUUID(), email.trim().toLowerCase(), hash) as User | undefined;
  if (!user) throw registrationClosed();
  return user;
}

export async function updateOwnProfile(user: User, { email, password }: UserUpdateInput): Promise<User> {
  const hash = password === undefined ? undefined : await passwordHash(password, ErrorCode.UPDATE_USER_INVALID_PASSWORD);
  const db = getDb();
  return writeTransaction(db, () => {
    const current = findUser(user.id);
    if (!current || current.session_version !== user.session_version) throw unauthorized();

    const updated = db.prepare(`
      UPDATE users SET email = ?, hashed_password = ?, session_version = ? WHERE id = ?
      RETURNING ${userColumns}
    `).get(email?.trim().toLowerCase() ?? current.email, hash ?? current.hashed_password,
      current.session_version + (hash === undefined ? 0 : 1), user.id) as User | undefined;
    if (!updated) throw unauthorized();
    if (hash !== undefined) {
      db.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").run(user.id);
    }
    return updated;
  });
}
