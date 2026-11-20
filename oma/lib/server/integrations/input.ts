/** Request bodies for the MCP integration routes. */

import { MAX_URL_LENGTH, MCP_TRANSPORTS, type McpTransport } from "./types";
import {
  ValidationCollector,
  isPlainObject,
  optionalBoolean,
  optionalEnum,
  optionalString,
  py,
  validationError,
  type Location,
} from "../common/validation";
import {
  isAuthEndpointAllowed,
  parseIntegrationAuth,
  type IntegrationAuth,
} from "./credentials";

/** HttpUrl permits longer values than the column holds: pydantic caps at 2083. */
const URL_SCHEMA_MAX_LENGTH = 2083;

export interface McpIntegrationCreateInput {
  name: string;
  url: string;
  urlObject: URL;
  transport: McpTransport;
  isEnabled: boolean;
  auth: IntegrationAuth;
}

export interface McpIntegrationUpdateInput {
  name?: string;
  url?: string;
  urlObject?: URL;
  transport?: McpTransport;
  isEnabled?: boolean;
  auth?: IntegrationAuth;
}

function requireObject(value: unknown, model: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw validationError([py.dictType(["body"], model)]);
  }
  return value;
}

/**
 * Validate an `HttpUrl`: http(s) only, no embedded credentials, and small enough for
 * the column. Returns the normalised URL (pydantic adds the trailing slash too).
 */
function parseHttpUrl(
  raw: string,
  loc: Location,
  collector: ValidationCollector,
): { url: URL; value: string } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    collector.add(py.urlParsing(loc));
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    collector.add(py.urlScheme(loc));
    return null;
  }
  if (url.href.length > URL_SCHEMA_MAX_LENGTH) {
    collector.add(py.urlTooLong(loc, URL_SCHEMA_MAX_LENGTH));
    return null;
  }
  if (url.href.length > MAX_URL_LENGTH) {
    collector.add(py.valueError(loc, `URL must be at most ${MAX_URL_LENGTH} characters long`));
    return null;
  }
  if (url.username || url.password) {
    collector.add(
      py.valueError(loc, "Use the authentication fields instead of credentials in the URL"),
    );
    return null;
  }
  return { url, value: url.href };
}

export function parseMcpIntegrationCreate(value: unknown): McpIntegrationCreateInput {
  const body = requireObject(value, "McpIntegrationCreate");
  const collector = new ValidationCollector();

  const name = optionalString(body, "name", ["body"], collector, { min: 1, max: 100, strip: true }, false);
  const rawUrl = optionalString(body, "url", ["body"], collector, { strip: true }, false);
  const transport = optionalEnum(body, "transport", ["body"], collector, MCP_TRANSPORTS, false);
  const isEnabled = optionalBoolean(body, "is_enabled", ["body"], collector, false);

  let parsedUrl: { url: URL; value: string } | null = null;
  if (rawUrl.present && rawUrl.value !== null) {
    parsedUrl = parseHttpUrl(rawUrl.value, ["body", "url"], collector);
  }

  let auth: IntegrationAuth = { type: "none" };
  if ("auth" in body) {
    auth = parseIntegrationAuth(body["auth"], ["body", "auth"]);
  }

  collector.throwIfAny();

  const url = parsedUrl as { url: URL; value: string };
  if (!isAuthEndpointAllowed(url.url, auth.type)) {
    collector.add(py.valueError(["body"], "Use HTTPS for authenticated remote MCP servers"));
    collector.throwIfAny();
  }

  return {
    name: name.value as string,
    url: url.value,
    urlObject: url.url,
    transport: (transport.value ?? "streamable_http") as McpTransport,
    isEnabled: isEnabled.value ?? true,
    auth,
  };
}

export function parseMcpIntegrationUpdate(value: unknown): McpIntegrationUpdateInput {
  const body = requireObject(value, "McpIntegrationUpdate");
  const collector = new ValidationCollector();

  const name = optionalString(body, "name", ["body"], collector, { min: 1, max: 100, strip: true }, true);
  const rawUrl = optionalString(body, "url", ["body"], collector, { strip: true }, true);
  const transport = optionalEnum(body, "transport", ["body"], collector, MCP_TRANSPORTS, true);
  const isEnabled = optionalBoolean(body, "is_enabled", ["body"], collector, true);

  let parsedUrl: { url: URL; value: string } | null = null;
  if (rawUrl.present && rawUrl.value !== null) {
    parsedUrl = parseHttpUrl(rawUrl.value, ["body", "url"], collector);
  }

  let auth: IntegrationAuth | undefined;
  if ("auth" in body && body["auth"] !== null) {
    auth = parseIntegrationAuth(body["auth"], ["body", "auth"]);
  }

  collector.throwIfAny();

  const update: McpIntegrationUpdateInput = {};
  if (name.present && name.value !== null) update.name = name.value;
  if (parsedUrl !== null) {
    update.url = parsedUrl.value;
    update.urlObject = parsedUrl.url;
  }
  if (transport.present && transport.value !== null) update.transport = transport.value;
  if (isEnabled.present && isEnabled.value !== null) update.isEnabled = isEnabled.value;
  if (auth !== undefined) update.auth = auth;
  return update;
}
