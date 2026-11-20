/** Hashes and verifies account passwords using Argon2id and upgrades older hashes on login. */

import * as argon2 from "argon2";
import * as bcrypt from "bcryptjs";

const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  hashLength: 32,
} satisfies argon2.HashOptions;
const CURRENT_HASH_PREFIX = "$argon2id$v=19$m=65536,t=3,p=4$";

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters long`;
  }
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<{ verified: boolean; updatedHash: string | null }> {
  if (hash.startsWith("$2")) {
    const verified = await bcrypt.compare(password, hash);
    return { verified, updatedHash: verified ? await hashPassword(password) : null };
  }

  let verified: boolean;
  try {
    verified = await argon2.verify(hash, password);
  } catch {
    return { verified: false, updatedHash: null };
  }

  const update = verified && !hash.startsWith(CURRENT_HASH_PREFIX);
  return { verified, updatedHash: update ? await hashPassword(password) : null };
}
