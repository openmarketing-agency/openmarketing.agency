/**
 * Write-only integration credentials and server-side header construction.
 *
 * An optional `auth` is a discriminated object:
 *   {"type":"none"} | {"type":"bearer","token":…}
 *   {"type":"api_key","header_name":…,"key":…} | {"type":"basic","username":…,"password":…}
 *
 * Secrets are encrypted at rest with a persistent Fernet key (envelope bound to the
 * integration and account), never returned by the API, and never echoed in errors.
 */

import { fernetDecrypt, fernetEncrypt, parseFernetKey } from "../common/fernet";
import {
  ValidationCollector,
  isPlainObject,
  py,
  requiredString,
  validationError,
  type Location,
} from "../common/validation";
import { AUTH_TYPES, type AuthType } from "./types";

export type IntegrationAuth =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "api_key"; header_name: string; key: string }
  | { type: "basic"; username: string; password: string };

/** Authenticated integrations cannot be saved without a persistent encryption key. */
export class CredentialStorageUnavailableError extends Error {}

const BEARER_TOKEN_PATTERN = /^[A-Za-z0-9\-._~+/]+=*$/;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const RESERVED_HEADERS = new Set([
  "host",
  "cookie",
  "set-cookie",
  "content-length",
  "content-type",
  "accept",
  "connection",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "keep-alive",
  "mcp-session-id",
  "mcp-protocol-version",
]);

const AUTH_FIELDS: Record<AuthType, string[]> = {
  none: ["type"],
  bearer: ["type", "token"],
  api_key: ["type", "header_name", "key"],
  basic: ["type", "username", "password"],
};

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) as number;
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** Length bounds followed by the field's own validator, matching pydantic's order. */
function bounded(
  collector: ValidationCollector,
  loc: Location,
  value: string,
  min: number,
  max: number,
): boolean {
  if (value.length < min) {
    collector.add(py.stringTooShort(loc, min));
    return false;
  }
  if (value.length > max) {
    collector.add(py.stringTooLong(loc, max));
    return false;
  }
  return true;
}

/** Validate the `auth` object. Throws a 422 with pydantic-shaped issues. */
export function parseIntegrationAuth(value: unknown, loc: Location): IntegrationAuth {
  if (!isPlainObject(value)) {
    throw validationError([py.dictType(loc, "NoAuth | BearerAuth | ApiKeyAuth | BasicAuth")]);
  }

  const tag = value["type"];
  if (typeof tag !== "string" || !(AUTH_TYPES as readonly string[]).includes(tag)) {
    throw validationError([py.unionTagInvalid(loc)]);
  }
  const authType = tag as AuthType;
  const collector = new ValidationCollector();

  for (const key of Object.keys(value)) {
    if (!AUTH_FIELDS[authType].includes(key)) {
      collector.add(py.extraForbidden([...loc, key]));
    }
  }

  if (authType === "none") {
    collector.throwIfAny();
    return { type: "none" };
  }

  if (authType === "bearer") {
    const token = requiredString(value, "token", loc, collector);
    if (token !== null && bounded(collector, [...loc, "token"], token, 1, 8192)) {
      if (!BEARER_TOKEN_PATTERN.test(token)) {
        collector.add(
          py.valueError([...loc, "token"], "Enter a valid bearer token without the Bearer prefix"),
        );
      }
    }
    collector.throwIfAny();
    return { type: "bearer", token: token as string };
  }

  if (authType === "api_key") {
    const headerName = requiredString(value, "header_name", loc, collector);
    const key = requiredString(value, "key", loc, collector);
    if (headerName !== null && bounded(collector, [...loc, "header_name"], headerName, 1, 128)) {
      if (!HEADER_NAME_PATTERN.test(headerName)) {
        collector.add(py.valueError([...loc, "header_name"], "Enter a valid HTTP header name"));
      } else if (
        RESERVED_HEADERS.has(headerName.toLowerCase()) ||
        headerName.toLowerCase().startsWith("sec-") ||
        headerName.toLowerCase().startsWith("proxy-")
      ) {
        collector.add(
          py.valueError([...loc, "header_name"], "This header is reserved; use an authentication header"),
        );
      }
    }
    if (key !== null && bounded(collector, [...loc, "key"], key, 1, 8192)) {
      if (!key.trim() || key !== key.trim() || hasControlCharacter(key) || !/^[\x20-\x7e]+$/.test(key)) {
        collector.add(
          py.valueError([...loc, "key"], "API key must be a nonempty printable HTTP header value"),
        );
      }
    }
    collector.throwIfAny();
    return { type: "api_key", header_name: headerName as string, key: key as string };
  }

  const username = requiredString(value, "username", loc, collector);
  const password = requiredString(value, "password", loc, collector);
  if (username !== null && bounded(collector, [...loc, "username"], username, 1, 512)) {
    if (username.includes(":") || !username.trim() || hasControlCharacter(username)) {
      collector.add(
        py.valueError(
          [...loc, "username"],
          "Basic authentication username cannot contain a colon or control character",
        ),
      );
    }
  }
  if (password !== null && bounded(collector, [...loc, "password"], password, 1, 8192)) {
    if (hasControlCharacter(password)) {
      collector.add(py.valueError([...loc, "password"], "Password cannot contain control characters"));
    }
  }
  collector.throwIfAny();
  return { type: "basic", username: username as string, password: password as string };
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Authenticated remote endpoints must use HTTPS; loopback HTTP is allowed. */
export function isAuthEndpointAllowed(url: URL, authType: string): boolean {
  if (authType === "none") return true;
  if (url.protocol === "https:") return true;
  return LOOPBACK_HOSTS.has(url.hostname);
}

/** Encrypt the submitted credentials, bound to the integration and account. */
export function encryptAuth(
  auth: IntegrationAuth,
  ids: { integrationId: string; userId: string },
  encryptionKey: string | null,
): string | null {
  if (auth.type === "none") return null;
  if (encryptionKey === null) throw new CredentialStorageUnavailableError();
  const envelope = {
    integration_id: ids.integrationId,
    user_id: ids.userId,
    auth: { ...auth },
  };
  return fernetEncrypt(parseFernetKey(encryptionKey), Buffer.from(JSON.stringify(envelope), "utf8"));
}

/**
 * For trusted server-side consumers only; never return these headers from the API.
 *
 * Consumers must use the owned integration's exact destination, TLS verification, and
 * disable cross-origin redirects. This helper does not connect to a server.
 */
export function credentialHeaders(
  integration: { id: string; userId: string; authType: string; authCredentialsEncrypted: string | null },
  encryptionKey: string | null,
): Record<string, string> {
  if (integration.authType === "none") return {};
  if (encryptionKey === null || integration.authCredentialsEncrypted === null) {
    throw new CredentialStorageUnavailableError();
  }
  const plaintext = fernetDecrypt(parseFernetKey(encryptionKey), integration.authCredentialsEncrypted);
  const envelope = JSON.parse(plaintext.toString("utf8")) as {
    integration_id: string;
    user_id: string;
    auth: unknown;
  };
  if (envelope.integration_id !== integration.id || envelope.user_id !== integration.userId) {
    throw new Error("Credential binding does not match integration");
  }
  const auth = parseIntegrationAuth(envelope.auth, []);
  if (auth.type === "bearer") return { Authorization: `Bearer ${auth.token}` };
  if (auth.type === "api_key") return { [auth.header_name]: auth.key };
  if (auth.type === "basic") {
    const value = Buffer.from(`${auth.username}:${auth.password}`, "utf8");
    return { Authorization: `Basic ${value.toString("base64")}` };
  }
  throw new Error("Stored authentication type is invalid");
}
