/** Persists account-owned MCP connections and encrypts credentials before writing them. */

import { randomUUID } from "node:crypto";

import { getDb, writeTransaction } from "@/lib/db";

import { ErrorCode, apiError, notFound } from "../common/api-error";
import type { Paging } from "../common/paging";
import { integrationRead, type McpIntegration } from "../common/serialize";
import { isUuid } from "../common/uuid";
import { loadSettings } from "../settings";
import {
  CredentialStorageUnavailableError,
  encryptAuth,
  isAuthEndpointAllowed,
  type IntegrationAuth,
} from "./credentials";
import type { McpIntegrationCreateInput, McpIntegrationUpdateInput } from "./input";

function missingIntegration() {
  return notFound(ErrorCode.MCP_INTEGRATION_NOT_FOUND);
}

function duplicateIntegration() {
  return apiError(409, ErrorCode.MCP_INTEGRATION_ALREADY_EXISTS);
}

function authFields(auth: IntegrationAuth, id: string, userId: string) {
  try {
    return {
      type: auth.type,
      encrypted: encryptAuth(auth, { integrationId: id, userId }, loadSettings().integrationEncryptionKey),
    };
  } catch (error) {
    if (error instanceof CredentialStorageUnavailableError) {
      throw apiError(503, ErrorCode.INTEGRATION_CREDENTIAL_STORAGE_UNAVAILABLE);
    }
    throw error;
  }
}

export function listIntegrations(userId: string, { limit, offset }: Paging) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM mcp_integrations WHERE user_id = ?
    ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?
  `).all(userId, limit, offset) as unknown as McpIntegration[];
  const total = db.prepare("SELECT count(*) AS count FROM mcp_integrations WHERE user_id = ?")
    .get(userId)?.count as number;
  return { items: rows.map(integrationRead), total };
}

function integrationById(userId: string, id: string): McpIntegration {
  if (!isUuid(id)) throw missingIntegration();
  const integration = getDb().prepare("SELECT * FROM mcp_integrations WHERE id = ? AND user_id = ?")
    .get(id, userId) as McpIntegration | undefined;
  if (!integration) throw missingIntegration();
  return integration;
}

export function getIntegration(userId: string, id: string) {
  return integrationRead(integrationById(userId, id));
}

export function createIntegration(userId: string, input: McpIntegrationCreateInput) {
  const { name, url, transport, isEnabled, auth } = input;
  const id = randomUUID();
  const { type, encrypted } = authFields(auth, id, userId);
  const now = Date.now();
  const inserted = getDb().prepare(`
    INSERT INTO mcp_integrations (id, user_id, name, url, transport, is_enabled, auth_type,
      auth_credentials_encrypted, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, url) DO NOTHING
    RETURNING *
  `).get(id, userId, name, url, transport, Number(isEnabled), type, encrypted, now, now) as McpIntegration | undefined;
  if (!inserted) throw duplicateIntegration();
  return integrationRead(inserted);
}

export function updateIntegration(userId: string, id: string, input: McpIntegrationUpdateInput) {
  const db = getDb();
  return writeTransaction(db, () => {
    const current = integrationById(userId, id);
    const targetUrl = input.urlObject ?? new URL(current.url);
    if (!isAuthEndpointAllowed(targetUrl, input.auth?.type ?? current.auth_type)) {
      throw apiError(422, ErrorCode.INTEGRATION_AUTH_REQUIRES_HTTPS);
    }
    const url = input.url ?? current.url;
    if (db.prepare("SELECT 1 FROM mcp_integrations WHERE user_id = ? AND url = ? AND id <> ?")
      .get(userId, url, id)) {
      throw duplicateIntegration();
    }
    const auth = input.auth === undefined
      ? { type: current.auth_type, encrypted: current.auth_credentials_encrypted }
      : authFields(input.auth, id, userId);
    const updated = db.prepare(`
      UPDATE mcp_integrations SET name = ?, url = ?, transport = ?, is_enabled = ?, auth_type = ?,
        auth_credentials_encrypted = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
      RETURNING *
    `).get(input.name ?? current.name, url, input.transport ?? current.transport,
      input.isEnabled === undefined ? current.is_enabled : Number(input.isEnabled),
      auth.type, auth.encrypted, Date.now(), id, userId) as McpIntegration | undefined;
    if (!updated) throw missingIntegration();
    return integrationRead(updated);
  });
}

export function deleteIntegration(userId: string, id: string): void {
  if (!isUuid(id)) throw missingIntegration();
  const result = getDb().prepare("DELETE FROM mcp_integrations WHERE id = ? AND user_id = ?").run(id, userId);
  if (result.changes === 0) throw missingIntegration();
}
