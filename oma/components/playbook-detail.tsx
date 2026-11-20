"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  LockKeyhole,
  Terminal,
  Users,
  Workflow,
} from "lucide-react";
import { type Playbook } from "@/lib/playbooks";
import {
  assignedToolSlugs,
  playbookToolSlugs,
  type ToolAssignment,
} from "@/lib/agent-connections";
import type { ConnectionSnapshot } from "@/lib/tool-connection-service";
import { suggestedToolkit, type Toolkit } from "@/lib/tool-catalog";
import type { HostedMcpConnection } from "@/lib/mcp-client-config";
import { AgentIcon } from "@/components/agent-icon";
import { PlaybookMcpSetup } from "@/components/playbook-mcp-setup";
import { ToolkitBrowser } from "@/components/toolkit-browser";

export function PlaybookDetail({
  playbook: p,
  snapshot: initialSnapshot,
  assignments: initialAssignments,
  metadata: initialMetadata,
  initialAgent,
  initialView,
  demo = false,
  demoCatalog,
  feedback,
  error,
}: {
  playbook: Playbook;
  snapshot: ConnectionSnapshot;
  assignments: ToolAssignment[];
  metadata: Toolkit[];
  initialAgent?: string;
  initialView?: string;
  demo?: boolean;
  demoCatalog?: Toolkit[];
  feedback?: string;
  error?: string;
}) {
  const [selectedId, setSelectedId] = useState(
    p.agents.some((agent) => agent.id === initialAgent)
      ? initialAgent!
      : "researcher",
  );
  const [view, setView] = useState(
    initialView === "mcp" || initialView === "mission" ? initialView : "team"
  );
  function selectView(tab: string) {
    setView(tab);
    const next = new URL(window.location.href);
    if (tab === "team") next.searchParams.delete("view");
    else next.searchParams.set("view", tab);
    window.history.replaceState(null, "", next);
  }
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [metadata, setMetadata] = useState(initialMetadata);
  const [mcp, setMcp] = useState<HostedMcpConnection>();
  const [copied, setCopied] = useState(false);
  const agent = p.agents.find((item) => item.id === selectedId) ?? p.agents[0];
  const scope = { playbookId: p.id, agentId: agent.id };
  const selected = assignedToolSlugs(assignments, scope);
  const allSlugs = playbookToolSlugs(p.id, assignments);
  const noAuth = new Set(
    metadata.filter((tool) => tool.noAuth).map((tool) => tool.slug),
  );
  const available = (slug: string) =>
    noAuth.has(slug) || snapshot.connected.includes(slug);
  const missing = allSlugs.filter((slug) => !available(slug));
  const ready = allSlugs.length > 0 && !missing.length && !error;
  const toolName = (slug: string) =>
    metadata.find((tool) => tool.slug === slug)?.name ?? slug;
  function selectAgent(id: string) {
    setSelectedId(id);
    setView("team");
    const next = new URL(window.location.href);
    next.searchParams.set("agent", id);
    next.searchParams.delete("view");
    window.history.replaceState(null, "", next);
  }
  function updateConnections(
    nextSnapshot: ConnectionSnapshot,
    slugs: string[],
    items: Toolkit[],
  ) {
    setSnapshot(nextSnapshot);
    setMetadata(items);
    setMcp(undefined);
    setAssignments((previous) => [
      ...previous.filter(
        (item) => item.playbook_id !== p.id || item.agent_id !== agent.id,
      ),
      ...slugs.map((slug) => ({
        playbook_id: p.id,
        agent_id: agent.id,
        toolkit_slug: slug,
      })),
    ]);
  }
  async function copyMission() {
    try {
      await navigator.clipboard.writeText(p.prompt);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="agent-playbook-page">
      <Link className="back-link" href={demo ? "/demo" : "/dashboard"}>
        <ArrowLeft size={14} />
        Playbooks
      </Link>
      <header className="agent-page-heading">
        <div className="agent-page-title">
          <span className="playbook-mark">
            <Workflow size={26} strokeWidth={1.5} />
          </span>
          <div>
            <div className="agent-title-line">
              <h1>{p.title}</h1>
              <span className="version-label">v{p.version}</span>
            </div>
            <p>{p.description}</p>
          </div>
        </div>
      </header>
      <div className="agent-page-tabs" aria-label="Playbook sections">
        <button
          className={view === "team" ? "selected" : ""}
          aria-pressed={view === "team"}
          onClick={() => selectView("team")}
        >
          <Users size={16} />
          Agent team<span>{p.agents.length}</span>
        </button>
        <button
          className={view === "mission" ? "selected" : ""}
          aria-pressed={view === "mission"}
          onClick={() => selectView("mission")}
        >
          Mission
        </button>
        <button
          className={view === "mcp" ? "selected" : ""}
          aria-pressed={view === "mcp"}
          onClick={() => selectView("mcp")}
        >
          <Terminal size={15} />
          MCP connection
        </button>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error} Refresh the page before changing tool selections.
        </p>
      )}
      {view === "team" ? (
        <>
          <div className="agent-workspace-intro">
            <h2>Choose tools for your team</h2>
            <p>
              Start with the suggestions, or browse the catalog for any
              specialist.
            </p>
          </div>
          <div className="agent-workspace">
            <nav className="agent-picker" aria-label="Playbook agents">
              <div className="agent-picker-label">Your team</div>
              {p.agents.map((item) => {
                const slugs = assignedToolSlugs(assignments, {
                  playbookId: p.id,
                  agentId: item.id,
                });
                const active = slugs.length > 0 && slugs.every(available);
                return (
                  <button
                    key={item.id}
                    className={`agent-picker-row ${item.id === agent.id ? "selected" : ""} ${item.id === "default" ? "mission-owner-row" : ""}`}
                    onClick={() => selectAgent(item.id)}
                    aria-current={item.id === agent.id ? "true" : undefined}
                  >
                    <AgentIcon id={item.id} />
                    <span>
                      <strong>
                        {item.id === "default" ? "Mission owner" : item.role}
                      </strong>
                      <small>
                        {item.id === "default"
                          ? "Coordinates the team"
                          : slugs.length
                            ? `${slugs.length} ${slugs.length === 1 ? "tool" : "tools"} selected`
                            : "Choose tools"}
                      </small>
                    </span>
                    {item.id === "default" ? (
                      <LockKeyhole size={13} className="agent-row-trailing" />
                    ) : active ? (
                      <CheckCircle2 size={15} className="agent-ready-icon" />
                    ) : (
                      <ChevronRight size={14} className="agent-row-trailing" />
                    )}
                  </button>
                );
              })}
              <div className="agent-picker-note">
                <Terminal size={14} />
                <p>
                  All selected tools come together in one playbook MCP
                  connection.
                </p>
              </div>
            </nav>
            <section
              className="agent-configuration"
              aria-labelledby="selected-agent-name"
            >
              <header className="agent-configuration-heading">
                <div className="agent-identity">
                  <AgentIcon id={agent.id} size={25} />
                  <div>
                    <h2 id="selected-agent-name">
                      {agent.id === "default" ? "Mission owner" : agent.role}
                    </h2>
                    <p>{agent.summary}</p>
                  </div>
                </div>
                <span
                  className={`agent-state ${agent.id === "default" || (selected.length && selected.every(available)) ? "is-ready" : ""}`}
                >
                  {agent.id === "default"
                    ? "No tools needed"
                    : selected.length
                      ? `${selected.length} ${selected.length === 1 ? "tool" : "tools"} selected`
                      : "No tools selected"}
                </span>
              </header>
              {agent.id === "default" ? (
                <div className="mission-owner-content">
                  <Workflow size={30} strokeWidth={1.3} />
                  <h3>Direction for the whole team.</h3>
                  <p>{agent.responsibility}</p>
                  <div className="owner-responsibilities">
                    <span>
                      <Check size={15} />
                      Sets priorities
                    </span>
                    <span>
                      <Check size={15} />
                      Assigns specialist tasks
                    </span>
                    <span>
                      <Check size={15} />
                      Reviews outcomes
                    </span>
                  </div>
                  <button
                    className="btn secondary"
                    onClick={() => selectAgent("researcher")}
                  >
                    Choose researcher tools
                    <ArrowRight size={15} />
                  </button>
                </div>
              ) : (
                <div className="agent-connection-area">
                  <ToolkitBrowser
                    key={agent.id}
                    scope={scope}
                    agentName={agent.role}
                    suggestions={agent.tools.map((tool) => ({
                      ...suggestedToolkit(tool.id),
                      description: tool.purpose,
                    }))}
                    snapshot={snapshot}
                    selected={selected}
                    metadata={metadata}
                    demo={demo}
                    demoCatalog={demoCatalog}
                    feedback={initialAgent === agent.id ? feedback : undefined}
                    onChange={updateConnections}
                  />
                </div>
              )}
              <div className="agent-responsibility">
                <h3>
                  {agent.id === "default"
                    ? "Standing mission"
                    : "What this agent is responsible for"}
                </h3>
                <p>
                  {agent.id === "default" ? p.outcome : agent.responsibility}
                </p>
              </div>
            </section>
          </div>
          <footer className="agent-page-note">
            <LockKeyhole size={14} />
            <span>
              Accounts connect to your workspace. Agent selections define the
              tools included in your playbook MCP connection.
            </span>
          </footer>
        </>
      ) : view === "mcp" ? (
        <div className="playbook-mcp-view">
          <div className="playbook-mcp-intro">
            <h2>One connection for the whole playbook</h2>
            <p>
              Use this URL with your AI client to access the tools selected
              across the {p.title} team. The mission owner does not need its own
              tools.
            </p>
          </div>
          <div className="playbook-tool-summary">
            <h3>
              Included tools <span>{allSlugs.length}</span>
            </h3>
            {allSlugs.length ? (
              <ul>
                {allSlugs.map((slug) => (
                  <li key={slug}>
                    <span>
                      <strong>{toolName(slug)}</strong>
                      <small>
                        {p.agents
                          .filter((item) =>
                            assignedToolSlugs(assignments, {
                              playbookId: p.id,
                              agentId: item.id,
                            }).includes(slug),
                          )
                          .map((item) => item.role)
                          .join(" · ")}
                      </small>
                    </span>
                    <span
                      className={
                        available(slug)
                          ? "connection-status"
                          : "tool-needs-connection"
                      }
                    >
                      {available(slug) ? (
                        <>
                          <Check size={14} />
                          {noAuth.has(slug) ? "No sign-in needed" : "Connected"}
                        </>
                      ) : (
                        "Needs connection"
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Choose tools for at least one specialist to get started.</p>
            )}
          </div>
          {missing.length > 0 && (
            <p className="notice">
              Connect or remove the selected tools marked “Needs connection”
              before generating your URL.
            </p>
          )}
          <PlaybookMcpSetup
            playbookId={p.id}
            playbookName={p.title}
            ready={ready}
            configured={snapshot.configured}
            connection={mcp}
            demo={demo}
            onGenerate={setMcp}
          />
          <button className="btn ghost" onClick={() => selectView("team")}>
            <ArrowLeft size={14} />
            Back to agent tools
          </button>
        </div>
      ) : (
        <div className="agent-mission-view">
          <section>
            <h2>The mission</h2>
            <p>{p.outcome}</p>
            <div className="mission-capabilities">
              {p.capabilities.map((capability) => (
                <div key={capability.title}>
                  <CheckCircle2 size={18} />
                  <div>
                    <h3>{capability.title}</h3>
                    <p>{capability.description}</p>
                  </div>
                </div>
              ))}
            </div>
            <button className="btn secondary" onClick={copyMission}>
              {copied ? <Check size={15} /> : <Copy size={15} />}{" "}
              {copied ? "Mission copied" : "Copy mission brief"}
            </button>
          </section>
          <section>
            <h2>What the team delivers</h2>
            <ul>
              {p.outputs.map((output) => (
                <li key={output}>
                  <Check size={16} />
                  {output}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
