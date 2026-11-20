/** Validates OMA settings shared by server handlers, the database, and operator commands. */

import { isValidFernetKey } from "./common/fernet";

export const DEV_SECRET = "dev-only-insecure-secret-change-me";
export const MIN_SECRET_LENGTH = 32;

export type Environment = "development" | "staging" | "production";

export interface Settings {
  appName: string;
  docsEnabled: boolean;
  secretKey: string;
  refreshSecretKey: string;
  integrationEncryptionKey: string | null;
  accessTokenLifetimeSeconds: number;
  refreshTokenLifetimeSeconds: number;
  registrationEnabled: boolean;
  corsOrigins: string[];
}

export class SettingsError extends Error {}

type Env = Record<string, string | undefined>;

const ENVIRONMENTS: Environment[] = ["development", "staging", "production"];

function raw(env: Env, name: string): string | undefined {
  const value = env[`OMA_${name.toUpperCase()}`];
  return value === undefined ? undefined : value;
}

function str(env: Env, name: string, fallback: string): string {
  const value = raw(env, name);
  return value === undefined ? fallback : value;
}

function bool(env: Env, name: string, fallback: boolean): boolean {
  const value = raw(env, name);
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "t", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "f", "no", "n", "off"].includes(normalized)) return false;
  throw new SettingsError(`OMA_${name.toUpperCase()} must be a boolean, got ${JSON.stringify(value)}`);
}

function int(env: Env, name: string, fallback: number): number {
  const value = raw(env, name);
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new SettingsError(`OMA_${name.toUpperCase()} must be an integer, got ${JSON.stringify(value)}`);
  }
  return parsed;
}

/** A JSON list, e.g. `OMA_CORS_ORIGINS=["https://app.example.com"]`. */
function stringList(env: Env, name: string, fallback: string[]): string[] {
  const value = raw(env, name);
  if (value === undefined || value.trim() === "") return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new SettingsError(`OMA_${name.toUpperCase()} must be a JSON list of strings`);
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new SettingsError(`OMA_${name.toUpperCase()} must be a JSON list of strings`);
  }
  return parsed as string[];
}

/** Build settings from an environment map, applying the same validation as before. */
export function loadSettings(env: Env = process.env): Settings {
  const environmentRaw = str(env, "environment", "development");
  if (!ENVIRONMENTS.includes(environmentRaw as Environment)) {
    throw new SettingsError(
      `OMA_ENVIRONMENT must be one of ${ENVIRONMENTS.join(", ")}, got ${JSON.stringify(environmentRaw)}`,
    );
  }
  const environment = environmentRaw as Environment;

  const secretKey = raw(env, "secret_key") || DEV_SECRET;
  if (!secretKey.trim()) {
    throw new SettingsError("OMA_SECRET_KEY must not be empty");
  }

  // An empty value (a common form of an unset variable in Compose/Kubernetes)
  // means "derive the refresh secret from the main one", not "sign with ''".
  const refreshSecretRaw = raw(env, "refresh_secret_key");
  const refreshSecretKey =
    refreshSecretRaw === undefined || !refreshSecretRaw.trim() ? secretKey : refreshSecretRaw;

  const integrationKeyRaw = raw(env, "integration_encryption_key");
  let integrationEncryptionKey: string | null = null;
  if (integrationKeyRaw !== undefined && integrationKeyRaw.trim() !== "") {
    if (!isValidFernetKey(integrationKeyRaw)) {
      throw new SettingsError("OMA_INTEGRATION_ENCRYPTION_KEY must be a valid Fernet key");
    }
    integrationEncryptionKey = integrationKeyRaw;
  }

  const isProduction = environment === "production";
  if (isProduction) {
    // HS256 wants at least 32 bytes of key material (RFC 7518 §3.2).
    const pairs: Array<[string, string]> = [
      ["OMA_SECRET_KEY", secretKey],
      ["OMA_REFRESH_SECRET_KEY", refreshSecretKey],
    ];
    for (const [name, value] of pairs) {
      if (value === DEV_SECRET) {
        throw new SettingsError(`${name} must be set to a unique value in production`);
      }
      if (value.length < MIN_SECRET_LENGTH) {
        throw new SettingsError(`${name} must be at least ${MIN_SECRET_LENGTH} characters in production`);
      }
    }
  }

  if (bool(env, "require_email_verification", false)) {
    throw new SettingsError(
      "OMA_REQUIRE_EMAIL_VERIFICATION is not supported yet: no email delivery backend is configured, so verification links cannot be sent.",
    );
  }

  return {
    appName: str(env, "app_name", "Open Marketing Agency"),
    docsEnabled: bool(env, "docs_enabled", true),
    secretKey,
    refreshSecretKey,
    integrationEncryptionKey,
    accessTokenLifetimeSeconds: int(env, "access_token_lifetime_seconds", 60 * 15),
    refreshTokenLifetimeSeconds: int(env, "refresh_token_lifetime_seconds", 60 * 60 * 24 * 30),
    registrationEnabled: bool(env, "registration_enabled", true),
    corsOrigins: stringList(env, "cors_origins", []),
  };
}
