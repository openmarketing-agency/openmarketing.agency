/**
 * Application error codes and the `{ "detail": … }` envelope every error shares.
 *
 * The codes are the ones clients already branch on (the console maps several of
 * them to copy), so they are part of the API contract rather than decoration.
 */

export class ApiError extends Error {
  constructor(readonly status: number, readonly detail: unknown) {
    super(typeof detail === "string" ? detail : "Request failed.");
    this.name = "ApiError";
  }
}

export const ErrorCode = {
  REGISTER_INVALID_PASSWORD: "REGISTER_INVALID_PASSWORD",
  REGISTRATION_CLOSED: "REGISTRATION_CLOSED",
  LOGIN_BAD_CREDENTIALS: "LOGIN_BAD_CREDENTIALS",
  UPDATE_USER_INVALID_PASSWORD: "UPDATE_USER_INVALID_PASSWORD",
  INVALID_REFRESH_TOKEN: "INVALID_REFRESH_TOKEN",
  MCP_INTEGRATION_ALREADY_EXISTS: "MCP_INTEGRATION_ALREADY_EXISTS",
  MCP_INTEGRATION_NOT_FOUND: "MCP_INTEGRATION_NOT_FOUND",
  INTEGRATION_CREDENTIAL_STORAGE_UNAVAILABLE: "INTEGRATION_CREDENTIAL_STORAGE_UNAVAILABLE",
  INTEGRATION_AUTH_REQUIRES_HTTPS: "INTEGRATION_AUTH_REQUIRES_HTTPS",
  INVALID_TOOL_ASSIGNMENT: "INVALID_TOOL_ASSIGNMENT",
} as const;

export type ErrorCodeName = (typeof ErrorCode)[keyof typeof ErrorCode];

/** An error carrying a machine-readable `detail`, as the API has always returned. */
export function apiError(status: number, detail: unknown): ApiError {
  return new ApiError(status, detail);
}

export function unauthorized(): ApiError {
  return apiError(401, "Unauthorized");
}

export function forbidden(): ApiError {
  return apiError(403, "Forbidden");
}

export function notFound(detail = "Not Found"): ApiError {
  return apiError(404, detail);
}

/** `{"detail": {"code": …, "reason": …}}` — used for password-policy rejections. */
export function passwordError(status: number, code: string, reason: string): ApiError {
  return apiError(status, { code, reason });
}
