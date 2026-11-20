"use client";
import { useState, useTransition } from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  LoaderCircle,
  Terminal,
} from "lucide-react";
import { generateMcpAction } from "@/app/actions/composio";
import {
  mcpClientConfiguration,
  type HostedMcpConnection,
} from "@/lib/mcp-client-config";

export function PlaybookMcpSetup({
  playbookId,
  playbookName,
  ready,
  configured,
  connection,
  onGenerate,
  demo = false,
}: {
  playbookId: string;
  playbookName: string;
  ready: boolean;
  configured: boolean;
  connection?: HostedMcpConnection;
  onGenerate: (connection: HostedMcpConnection) => void;
  demo?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [client, setClient] = useState<"Cursor" | "Claude Desktop">("Cursor");
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setError("Copy wasn’t available. Select and copy the text manually.");
    }
  }
  function generate() {
    setError("");
    setCopied("");
    if (demo) {
      onGenerate({
        url: `https://backend.composio.dev/tool_router/v3/trs_preview_${playbookId}/mcp`,
        headerBindings: [
          { name: "x-api-key", environmentVariable: "COMPOSIO_API_KEY" },
        ],
      });
      return;
    }
    startTransition(async () => {
      try {
        const result = await generateMcpAction(playbookId);
        if (result.connection) onGenerate(result.connection);
        else
          setError(
            result.error ?? "We couldn’t create the playbook’s MCP connection.",
          );
      } catch {
        setError(
          "We couldn’t create the playbook’s MCP connection. Try again.",
        );
      }
    });
  }
  return (
    <section
      className="agent-mcp-section"
      aria-label={`${playbookName} playbook MCP connection`}
    >
      <div className="agent-mcp-heading">
        <div>
          <h3>
            <Terminal size={17} />
            Playbook MCP connection
          </h3>
          <p>
            One hosted URL for the tools selected across your {playbookName}{" "}
            team.
          </p>
        </div>
        <button
          className="btn primary"
          onClick={generate}
          disabled={!ready || !configured || pending}
        >
          {pending ? (
            <>
              <LoaderCircle size={14} className="spin" />
              Generating…
            </>
          ) : (
            <>
              {connection ? "Generate new URL" : "Generate MCP URL"}
              <ArrowUpRight size={15} />
            </>
          )}
        </button>
      </div>
      {!ready && (
        <p className="agent-mcp-locked">
          Add and connect at least one tool to generate your playbook MCP URL.
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {connection && (
        <div className="agent-mcp-result">
          {demo && (
            <p className="notice">
              Preview URL only. Tool connections are simulated.
            </p>
          )}
          <label className="agent-url-label" htmlFor={`mcp-${playbookId}`}>
            Hosted MCP URL
          </label>
          <div className="copy-field">
            <input
              id={`mcp-${playbookId}`}
              value={connection.url}
              readOnly
              onFocus={(event) => event.target.select()}
            />
            <button
              onClick={() => copy(connection.url, "url")}
              aria-label={`Copy ${playbookName} MCP URL`}
            >
              {copied === "url" ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
          <details className="agent-client-config">
            <summary>Set up in your AI client</summary>
            <div className="config-tabs" aria-label="MCP client">
              {(["Cursor", "Claude Desktop"] as const).map((name) => (
                <button
                  key={name}
                  className={client === name ? "selected" : ""}
                  aria-pressed={client === name}
                  onClick={() => setClient(name)}
                >
                  {name}
                </button>
              ))}
            </div>
            <pre tabIndex={0}>
              {mcpClientConfiguration(`oma-${playbookId}`, connection, client)}
            </pre>
            <button
              className="btn secondary"
              onClick={() =>
                copy(
                  mcpClientConfiguration(
                    `oma-${playbookId}`,
                    connection,
                    client,
                  ),
                  "config",
                )
              }
            >
              {copied === "config" ? <Check size={14} /> : <Copy size={14} />}{" "}
              {copied === "config"
                ? "Configuration copied"
                : "Copy configuration"}
            </button>
            {connection.headerBindings.length > 0 && (
              <p className="mcp-hint">
                Authentication required:{" "}
                {connection.headerBindings
                  .map(
                    (binding) =>
                      `${binding.name} → ${binding.environmentVariable}`,
                  )
                  .join(", ")}
                . Set these credentials in your client’s environment.
              </p>
            )}
          </details>
        </div>
      )}
    </section>
  );
}
