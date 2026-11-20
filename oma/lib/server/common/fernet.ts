/**
 * Fernet (spec-compatible) implementation on top of `node:crypto`.
 *
 * The FastAPI backend encrypted integration credentials with
 * `cryptography.fernet.Fernet`. Tokens written by that service must stay readable
 * after the migration and vice versa, so this is a byte-for-byte implementation of
 * the published format rather than a look-alike:
 *
 *   token = base64url( 0x80 | timestamp(8B BE) | IV(16B) | AES-128-CBC(ct) | HMAC-SHA256(32B) )
 *
 * Keys are 32 urlsafe-base64 encoded bytes: the first 16 sign, the last 16 encrypt.
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = Buffer.from([0x80]);
const IV_LENGTH = 16;
const HMAC_LENGTH = 32;
const KEY_LENGTH = 32;

/** Raised for a key that is not a valid Fernet key. */
export class InvalidFernetKeyError extends Error {}

/** Raised when a token cannot be authenticated or decrypted. */
export class InvalidFernetTokenError extends Error {}

export interface FernetKey {
  signingKey: Buffer;
  encryptionKey: Buffer;
}

/** Parse and validate a Fernet key (32 urlsafe-base64 bytes). */
export function parseFernetKey(encoded: string): FernetKey {
  let raw: Buffer;
  try {
    raw = Buffer.from(encoded, "base64url");
  } catch {
    throw new InvalidFernetKeyError("Fernet key is not valid base64");
  }
  // Round-trip so trailing garbage and non-canonical padding are rejected the way
  // Python's base64.urlsafe_b64decode(validate=False) + length check would.
  if (raw.length !== KEY_LENGTH) {
    throw new InvalidFernetKeyError("Fernet key must decode to 32 bytes");
  }
  return { signingKey: raw.subarray(0, 16), encryptionKey: raw.subarray(16, 32) };
}

export function isValidFernetKey(encoded: string): boolean {
  try {
    parseFernetKey(encoded);
    return true;
  } catch {
    return false;
  }
}

/**
 * A fresh 32-byte urlsafe-base64 key, equivalent to Python's
 * `Fernet.generate_key().decode()`:
 *
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
 */
export function generateFernetKey(): string {
  return randomBytes(KEY_LENGTH).toString("base64url");
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function base64UrlDecode(encoded: string): Buffer {
  return Buffer.from(encoded, "base64url");
}

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** Encrypt a UTF-8 plaintext, producing a Fernet token. */
export function fernetEncrypt(key: FernetKey, plaintext: Buffer, timestamp?: Date): string {
  const iv = randomBytes(IV_LENGTH);
  const time = Math.floor((timestamp ?? new Date()).getTime() / 1000);
  const header = Buffer.alloc(9);
  VERSION.copy(header, 0);
  header.writeBigUInt64BE(BigInt(time), 1);

  const cipher = createCipheriv("aes-128-cbc", key.encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  const signed = Buffer.concat([header, iv, ciphertext]);
  const signature = hmac(key.signingKey, signed);
  return base64UrlEncode(Buffer.concat([signed, signature]));
}

/** Decrypt a Fernet token, returning the plaintext bytes. */
export function fernetDecrypt(key: FernetKey, token: string, ttlSeconds?: number): Buffer {
  const raw = base64UrlDecode(token);
  if (raw.length < 9 + IV_LENGTH + 16 + HMAC_LENGTH) {
    throw new InvalidFernetTokenError("Fernet token is too short");
  }
  const signed = raw.subarray(0, raw.length - HMAC_LENGTH);
  const signature = raw.subarray(raw.length - HMAC_LENGTH);
  if (signed[0] !== VERSION[0]) {
    throw new InvalidFernetTokenError("Fernet token has an unknown version");
  }
  const expected = hmac(key.signingKey, signed);
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
    throw new InvalidFernetTokenError("Fernet token signature does not match");
  }

  const timestamp = Number(signed.readBigUInt64BE(1));
  if (ttlSeconds !== undefined && timestamp + ttlSeconds < Math.floor(Date.now() / 1000)) {
    throw new InvalidFernetTokenError("Fernet token has expired");
  }

  const iv = signed.subarray(9, 9 + IV_LENGTH);
  const ciphertext = signed.subarray(9 + IV_LENGTH);
  const decipher = createDecipheriv("aes-128-cbc", key.encryptionKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
