/** OpenAPI metadata for the console's bearer-token control plane and health probes. */

import { loadSettings } from "./settings";

type Method = "get" | "post" | "patch" | "put" | "delete";
type Fields = Record<string, object>;
type Operation = [
  method: Method,
  summary: string,
  options?: { status?: number; public?: boolean; media?: string; fields?: Fields; required?: string[]; query?: Fields },
];

const string = { type: "string" };
const password = { type: "string", format: "password" };
const boolean = { type: "boolean" };
const registration = { email: { type: "string", format: "email" }, password };
const refresh = { fields: { refresh_token: password }, required: ["refresh_token"], public: true };
const integration = { name: string, url: string, transport: { type: "string", enum: ["streamable_http", "sse"] }, is_enabled: boolean, auth: { type: "object" } };

const routes: Record<string, Operation[]> = {
  "/auth/register": [["post", "Register the single account for this installation", { status: 201, public: true, fields: registration, required: ["email", "password"] }]],
  "/auth/jwt/login": [["post", "Sign in with email and password", { public: true, media: "application/x-www-form-urlencoded", fields: { username: string, password }, required: ["username", "password"] }]],
  "/auth/jwt/refresh": [["post", "Rotate a refresh token", refresh]],
  "/auth/jwt/logout": [["post", "Revoke a refresh token", { ...refresh, status: 204 }]],
  "/auth/jwt/logout-all": [["post", "Revoke all refresh tokens", { status: 204 }]],
  "/users/me": [["get", "Read your profile"], ["patch", "Update your profile", { fields: registration }]],
  "/mcp-integrations": [["get", "List your MCP integrations"], ["post", "Add an MCP integration", { status: 201, fields: integration, required: ["name", "url"] }]],
  "/mcp-integrations/{integrationId}": [["get", "Read an MCP integration"], ["patch", "Update an MCP integration", { fields: integration }], ["delete", "Remove an MCP integration", { status: 204 }]],
  "/tool-assignments": [["get", "List your tool assignments"]],
  "/tool-assignments/{playbook}/{agent}/{toolkit}": [["put", "Assign a toolkit", { status: 204 }], ["delete", "Unassign a toolkit", { status: 204 }]],
};

function operations(path: string, entries: Operation[]) {
  const parameters = Array.from(path.matchAll(/\{(\w+)\}/g), ([, name]) =>
    ({ name, in: "path", required: true, schema: string }));
  return Object.fromEntries(entries.map(([method, summary, options]) => [
    method,
    {
      summary,
      parameters: [
        ...parameters,
        ...Object.entries(options?.query ?? {}).map(([name, schema]) => ({ name, in: "query", schema })),
      ],
      security: options?.public ? [] : [{ OAuth2PasswordBearer: [] }],
      ...(options?.fields && {
        requestBody: {
          required: true,
          content: {
            [options.media ?? "application/json"]: {
              schema: { type: "object", properties: options.fields, required: options.required },
            },
          },
        },
      }),
      responses: { [options?.status ?? 200]: { description: "Success" } },
    },
  ]));
}

export function openApiDocument() {
  return {
    openapi: "3.0.3",
    info: { title: loadSettings().appName, version: "0.1.0" },
    paths: {
      ...Object.fromEntries(Object.entries(routes).map(([path, entries]) => [
        "/api/v1" + path,
        operations(path, entries),
      ])),
      "/health": operations("/health", [["get", "Liveness", { public: true }]]),
      "/health/ready": operations("/health/ready", [["get", "Database readiness", { public: true }]]),
    },
    components: {
      securitySchemes: {
        OAuth2PasswordBearer: {
          type: "oauth2",
          flows: { password: { tokenUrl: "/api/v1/auth/jwt/login", scopes: {} } },
        },
      },
    },
  };
}
