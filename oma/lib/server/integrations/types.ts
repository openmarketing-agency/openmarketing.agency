/** Limits and supported connection modes shared by MCP request validation and storage. */

export const MCP_TRANSPORTS = ["streamable_http", "sse"] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

export const AUTH_TYPES = ["none", "bearer", "api_key", "basic"] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

export const MAX_URL_LENGTH = 2048;
