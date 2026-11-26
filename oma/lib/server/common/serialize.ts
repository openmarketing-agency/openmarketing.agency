/** Maps SQLite rows and issued tokens to the public API response shapes. */

import type { User } from "../identity/users";

export interface McpIntegration {
  id: string;
  name: string;
  url: string;
  transport: string;
  is_enabled: number;
  auth_type: string;
  auth_credentials_encrypted: string | null;
  created_at: number;
  updated_at: number;
}

/** `2026-11-18T07:19:10.199Z` -> `2026-11-18T07:19:10.199000Z` (6-digit microseconds). */
export function isoMicroseconds(value: Date): string {
  const iso = value.toISOString();
  return `${iso.slice(0, -1)}000Z`;
}

export function userRead(user: User) {
  return { id: user.id, email: user.email };
}

export interface TokenBody {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export function tokenBody(accessToken: string, expiresIn: number): TokenBody {
  return { access_token: accessToken, token_type: "bearer", expires_in: expiresIn };
}

export interface McpIntegrationReadBody {
  id: string;
  name: string;
  url: string;
  transport: string;
  is_enabled: boolean;
  auth_type: string;
  has_credentials: boolean;
  created_at: string;
  updated_at: string;
}

/** Credentials and ciphertext are never exposed: only the type and a presence flag. */
export function integrationRead(integration: McpIntegration): McpIntegrationReadBody {
  return {
    id: integration.id,
    name: integration.name,
    url: integration.url,
    transport: integration.transport,
    is_enabled: integration.is_enabled === 1,
    auth_type: integration.auth_type,
    has_credentials: integration.auth_credentials_encrypted !== null,
    created_at: isoMicroseconds(new Date(integration.created_at)),
    updated_at: isoMicroseconds(new Date(integration.updated_at)),
  };
}
