export type McpHeaderBinding = { name: string; environmentVariable: string };
export type HostedMcpConnection = {
  url: string;
  headerBindings: McpHeaderBinding[];
};

const HEADER_ENVIRONMENT: Record<string, string> = {
  "x-api-key": "COMPOSIO_API_KEY",
  "x-user-api-key": "COMPOSIO_USER_API_KEY",
  "x-org-id": "COMPOSIO_ORG_ID",
  "x-project-id": "COMPOSIO_PROJECT_ID",
};

// The SDK's header values contain the server's project credential. Export the
// hosted endpoint and required header bindings, never that shared credential.
export function hostedMcpConnection(mcp: {
  url: string;
  headers?: Record<string, string>;
}): HostedMcpConnection {
  if (new URL(mcp.url).protocol !== "https:") {
    throw new Error("The hosted MCP endpoint must use HTTPS.");
  }
  return {
    url: mcp.url,
    headerBindings: Object.keys(mcp.headers ?? {}).map((name) => ({
      name,
      environmentVariable:
        HEADER_ENVIRONMENT[name.toLowerCase()] ??
        `COMPOSIO_MCP_${name.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}`,
    })),
  };
}

export function mcpClientConfiguration(
  serverName: string,
  connection: HostedMcpConnection,
  client: "Cursor" | "Claude Desktop",
): string {
  const { url, headerBindings } = connection;
  const server =
    client === "Cursor"
      ? {
          url,
          ...(headerBindings.length
            ? {
                headers: Object.fromEntries(
                  headerBindings.map(({ name, environmentVariable }) => [
                    name,
                    `\${env:${environmentVariable}}`,
                  ]),
                ),
              }
            : {}),
        }
      : {
          command: "npx",
          args: [
            "-y",
            "mcp-remote",
            url,
            ...headerBindings.flatMap(({ name, environmentVariable }) => [
              "--header",
              `${name}:\${${environmentVariable}}`,
            ]),
          ],
        };
  return JSON.stringify({ mcpServers: { [serverName]: server } }, null, 2);
}
