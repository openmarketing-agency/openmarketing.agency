/** Typed in-process control-plane client for Server Components, Server Actions, and Proxy. */

import "server-only";

import { controlPlane } from "@/lib/server/control-plane";

export type ApiUser = { id: string; email: string };

export type TokenPair = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
};

export type ApiError = {
  /** HTTP status used to present a consistent failure in the console. */
  status: number;
  /** Machine-readable code: a fastapi-users error code, or a local one. */
  code: string;
  /** Copy that is safe to show in the UI. */
  message: string;
};

export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

function invoke(path: string, init: RequestInit): Promise<Response> {
  const url = new URL(path, "http://oma.internal");
  const segments = url.pathname.slice("/api/v1/".length).split("/").map(decodeURIComponent);
  return controlPlane(new Request(url, init), segments);
}

/** Backend error codes mapped to user-facing copy. */
const MESSAGES: Record<string, string> = {
  LOGIN_BAD_CREDENTIALS: "Incorrect email or password.",
  REGISTRATION_CLOSED: "This installation already has an account. Sign in to continue.",
  REGISTER_INVALID_PASSWORD: "That password is not allowed.",
  INVALID_REFRESH_TOKEN: "Your session has expired. Please sign in again.",
};

function describeError(
  status: number,
  body: unknown,
  fallback: string,
): ApiError {
  const detail = (body as { detail?: unknown } | null)?.detail;

  if (typeof detail === "string") {
    return { status, code: detail, message: MESSAGES[detail] ?? fallback };
  }

  // Validation errors carry `{code, reason}`.
  if (detail && typeof detail === "object" && "code" in detail) {
    const { code, reason } = detail as { code?: string; reason?: string };
    const key = code ?? "UNKNOWN";
    return { status, code: key, message: reason ?? MESSAGES[key] ?? fallback };
  }

  // Pydantic 422 responses carry a list of issues.
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as { msg?: string; loc?: unknown[] };
    const field = Array.isArray(first.loc)
      ? String(first.loc.at(-1))
      : undefined;
    return {
      status,
      code: "VALIDATION_ERROR",
      message: first.msg
        ? field
          ? `${field}: ${first.msg}`
          : first.msg
        : "That request was rejected by the API.",
    };
  }

  return { status, code: "UNKNOWN", message: fallback };
}

async function request<T>(
  path: string,
  init: RequestInit & { fallbackMessage: string },
): Promise<Result<T>> {
  const { fallbackMessage, ...rest } = init;
  let response: Response;

  try {
    response = await invoke(path, rest);
  } catch {
    return {
      ok: false,
      error: {
        status: 500,
        code: "INTERNAL_ERROR",
        message: fallbackMessage,
      },
    };
  }

  if (response.status === 204) {
    return { ok: true, data: undefined as T };
  }

  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    return {
      ok: false,
      error: describeError(response.status, body, fallbackMessage),
    };
  }

  return { ok: true, data: body as T };
}

function bearer(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Login uses the OAuth2 password flow, so the body is form-encoded. */
export function login(
  email: string,
  password: string,
): Promise<Result<TokenPair>> {
  return request<TokenPair>("/api/v1/auth/jwt/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: email, password }),
    fallbackMessage: "Could not sign in. Please try again.",
  });
}

export function register(
  email: string,
  password: string,
): Promise<Result<ApiUser>> {
  return request<ApiUser>("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    fallbackMessage: "Could not create the account. Please try again.",
  });
}

/** Trades a refresh token for a new pair; the presented token is rotated server-side. */
export function refreshTokens(
  refreshToken: string,
): Promise<Result<TokenPair>> {
  return request<TokenPair>("/api/v1/auth/jwt/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
    fallbackMessage: "Your session has expired. Please sign in again.",
  });
}

export function logout(refreshToken: string): Promise<Result<void>> {
  return request<void>("/api/v1/auth/jwt/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
    fallbackMessage: "Could not reach the API to revoke the session.",
  });
}

/** Revokes every refresh token for the caller. */
export function logoutAll(accessToken: string): Promise<Result<void>> {
  return request<void>("/api/v1/auth/jwt/logout-all", {
    method: "POST",
    headers: bearer(accessToken),
    fallbackMessage: "Could not reach the API to revoke the sessions.",
  });
}

export function me(accessToken: string): Promise<Result<ApiUser>> {
  return request<ApiUser>("/api/v1/users/me", {
    headers: bearer(accessToken),
    fallbackMessage: "Could not load your profile.",
  });
}
