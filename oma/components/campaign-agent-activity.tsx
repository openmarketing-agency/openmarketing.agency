/** Browses campaign sessions, transcripts, and retained runtime logs on the Progress tab. */
"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, RefreshCw } from "lucide-react";

import type { CampaignActivityCategory, CampaignActivityEntry, CampaignActivityIndex,
  CampaignActivityText, CampaignActivityTranscript } from "@/lib/server/campaign-activity";
import { useCampaignFeed } from "./use-campaign-feed";

const categories = {
  chat: "Campaign chat", agent: "Agent sessions and logs", worker: "Kanban workers", cron: "Scheduled jobs", delegated: "Delegated agents",
} satisfies Record<CampaignActivityCategory, string>;
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const labels = { user: "User", assistant: "Agent", tool: "Tool result" } as const;

function time(value: number | null) {
  if (value === null) return null;
  const at = new Date(value * 1000);
  return <time dateTime={at.toISOString()}>{dateFormat.format(at)}</time>;
}

function entryTitle(entry: CampaignActivityEntry) {
  return entry.title || (entry.category === "delegated" ? "Delegated session" : "Session");
}

function pathWith(path: string, values: Record<string, string | number>) {
  const query = new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)]));
  return `${path}?${query}`;
}

function Pager({ offset, next, step, onPage, singular }: {
  offset: number; next: number | null; step: number; onPage: (page: number) => void; singular: string;
}) {
  if (!offset && next === null) return null;
  return <div className="campaign-activity-pager" role="group" aria-label={`${singular} pages`}>
    {offset > 0 && <button type="button" className="btn secondary" onClick={() => onPage(Math.max(0, offset - step))}>Previous page</button>}
    {next !== null && <button type="button" className="btn secondary" onClick={() => onPage(next)}>Next page</button>}
  </div>;
}

function TextPages({ path, fields, refresh, empty, label }: {
  path: string; fields: Record<string, string | number>; refresh: number; empty: string; label: string;
}) {
  const [offset, setOffset] = useState(0);
  const result = useCampaignFeed<CampaignActivityText>(pathWith(path, { ...fields, offset }), refresh, offset === 0);
  return <>
    {!result && <p role="status">Loading {label.toLowerCase()}…</p>}
    {result?.error && <p className="form-error" role="status">{result.error}</p>}
    {result?.data && <>
      {result.data.text ? <pre className="campaign-activity-log" tabIndex={0} aria-label={label}>{result.data.text}</pre> : <p>{empty}</p>}
      <Pager offset={offset} next={result.data.nextOffset} step={24000} onPage={setOffset} singular={label} />
    </>}
  </>;
}

function Transcript({ path, fields, refresh }: {
  path: string; fields: Record<string, string>; refresh: number;
}) {
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<number>();
  const result = useCampaignFeed<CampaignActivityTranscript>(pathWith(path, { ...fields, offset }), refresh, offset === 0);
  return <>
    {!result && <p role="status">Loading transcript…</p>}
    {result?.error && <p className="form-error" role="status">{result.error}</p>}
    {result?.data && <>
      {result.data.messages.length ? <ol className="campaign-progress-list campaign-activity-messages">
        {result.data.messages.map((message) => <li key={message.id}>
          <div className="campaign-progress-row">
            <strong>{labels[message.role]}{message.tool ? ` · ${message.tool}` : ""}</strong>{time(message.at)}
          </div>
          {message.text && <p className="campaign-progress-text">{message.text}</p>}
          {message.calls.map((call, index) => <details key={index} className="campaign-activity-call">
            <summary>Tool call <code>{call.name}</code></summary>
            {call.arguments && <pre className="campaign-activity-log" tabIndex={0} aria-label={`${call.name} arguments`}>{call.arguments}</pre>}
          </details>)}
          {message.truncated && <>
            <button type="button" className="btn secondary" aria-expanded={expanded === message.id}
              onClick={() => setExpanded(expanded === message.id ? undefined : message.id)}>
              {expanded === message.id ? "Hide full message" : "Read full message"}
            </button>
            {expanded === message.id && <TextPages path={path} fields={{ ...fields, view: "message", message: message.id }}
              refresh={refresh} empty="This message has no saved text." label="Message" />}
          </>}
        </li>)}
      </ol> : <p>No messages have been recorded for this session yet.</p>}
      <Pager offset={offset} next={result.data.nextOffset} step={25} onPage={(page) => { setExpanded(undefined); setOffset(page); }} singular="Transcript" />
    </>}
  </>;
}

function Detail({ item, path, refresh, onParent }: {
  item: CampaignActivityEntry; path: string; refresh: number; onParent: (item: CampaignActivityEntry) => void;
}) {
  const [view, setView] = useState<"transcript" | "log">("transcript");
  const fields = { kind: item.kind, profile: item.profile, ref: item.ref };
  const parent = item.parent;
  if (item.kind !== "session") {
    return <TextPages path={path} fields={fields} refresh={refresh} empty="No output has been recorded yet." label="Log" />;
  }
  return <>
    <div className="campaign-progress-row campaign-activity-identity"><code>{item.ref}</code>
      {parent && parent !== item.ref && <button type="button" className="btn secondary"
        onClick={() => onParent({ ...item, ref: parent, parent: null, title: "Parent session", at: null })}>Open parent session</button>}
    </div>
    <div className="campaign-progress-filters" role="group" aria-label="Session details">
      <button type="button" aria-pressed={view === "transcript"} onClick={() => setView("transcript")}>Transcript</button>
      <button type="button" aria-pressed={view === "log"} onClick={() => setView("log")}>Runtime logs</button>
    </div>
    {view === "transcript" ? <Transcript path={path} fields={fields} refresh={refresh} />
      : <TextPages path={path} fields={{ ...fields, view: "log" }} refresh={refresh}
        empty="No retained runtime logs are tagged with this session." label="Runtime log" />}
  </>;
}

export function CampaignAgentActivity({ campaign, agents }: { campaign: string; agents: Record<string, string> }) {
  const id = useId();
  const path = `/api/campaigns/${campaign}/activity`;
  const [offset, setOffset] = useState(0);
  const [category, setCategory] = useState("");
  const [agent, setAgent] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<CampaignActivityEntry>();
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const activityFilter = useRef<HTMLSelectElement>(null);
  const wasShowingDetails = useRef(false);
  useEffect(() => {
    if (selected) detailHeading.current?.focus();
    else if (wasShowingDetails.current) activityFilter.current?.focus();
    wasShowingDetails.current = Boolean(selected);
  }, [selected]);
  const listPath = pathWith(path, { offset, ...(category && { category }), ...(agent && { agent }) });
  const result = useCampaignFeed<CampaignActivityIndex>(listPath, refresh, offset === 0 && !selected);
  const agentName = (profile: string) => profile === "default" ? "Hermes" : Object.hasOwn(agents, profile) ? agents[profile] : profile;

  return <section className="campaign-agent-activity" aria-labelledby={id}>
    <header className="campaign-progress-toolbar">
      <h2 id={id}>Agent activity</h2>
      <button type="button" className="btn secondary" onClick={() => setRefresh((value) => value + 1)}>
        <RefreshCw size={15} aria-hidden="true" /> Refresh
      </button>
    </header>
    {selected ? <div className="campaign-activity-detail">
      <button type="button" className="btn secondary" onClick={() => setSelected(undefined)}>
        <ArrowLeft size={16} aria-hidden="true" /> Back to activity
      </button>
      <div className="campaign-activity-entry-heading">
        <h3 tabIndex={-1} ref={detailHeading}>{entryTitle(selected)}</h3>
        <div className="campaign-progress-row">
          <span>{categories[selected.category]}</span>{selected.profile && <span>{agentName(selected.profile)}</span>}{time(selected.at)}
        </div>
      </div>
      <Detail key={`${selected.kind}:${selected.profile}:${selected.ref}`} item={selected} path={path} refresh={refresh} onParent={setSelected} />
    </div> : <>
      <div className="campaign-activity-controls">
        <label>Activity type <select ref={activityFilter} value={category} onChange={(event) => { setCategory(event.target.value); setOffset(0); }}>
          <option value="">All activity</option>
          {Object.entries(categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Agent <select value={agent} onChange={(event) => { setAgent(event.target.value); setOffset(0); }}>
          <option value="">All agents</option>
          <option value="default">Hermes</option>
          {Object.entries(agents).filter(([profile]) => profile !== "default").map(([profile, name]) => <option key={profile} value={profile}>{name}</option>)}
        </select></label>
      </div>
      {!result && <p role="status">Loading campaign activity…</p>}
      {result?.error && <p className="form-error" role="status">{result.error}</p>}
      {result?.data && <>
        {result.data.partial && <p className="campaign-progress-warning" role="status">Some agent or board activity is temporarily unavailable.</p>}
        {result.data.entries.length ? <ul className="campaign-progress-list campaign-activity-entries">
          {result.data.entries.map((item) => <li key={`${item.kind}:${item.profile}:${item.ref}`}>
            <button type="button" className="campaign-activity-entry" onClick={() => setSelected(item)}>
              <span><strong>{entryTitle(item)}</strong>
                <span className="campaign-progress-row">
                  <span>{categories[item.category]}</span>
                  {item.profile && <span>{agentName(item.profile)}</span>}
                  {item.kind === "session" && <span>{item.messages} messages · {item.tools} tool calls</span>}
                  {item.status && <span>{item.status.replaceAll("_", " ")}</span>}
                </span>
              </span>
              {time(item.at)}<ChevronRight size={16} aria-hidden="true" />
            </button>
          </li>)}
        </ul> : <p className="campaign-progress-empty">{category || agent ? "No activity matches these filters." : "Campaign conversations and background work will appear here when the agent records them."}</p>}
        <Pager offset={offset} next={result.data.nextOffset} step={30} onPage={setOffset} singular="Activity" />
      </>}
    </>}
  </section>;
}
