"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  AppWindow,
  ArrowUpRight,
  Check,
  ChevronDown,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import {
  assignToolAction,
  connectToolAction,
  disconnectToolAction,
  refreshConnectionsAction,
  searchToolCatalogAction,
  toolCategoriesAction,
} from "@/app/actions/composio";
import {
  WORKSPACE_SCOPE,
  type AgentConnectionScope,
} from "@/lib/agent-connections";
import type { ConnectionSnapshot } from "@/lib/tool-connection-service";
import type { CatalogPage, Toolkit } from "@/lib/tool-catalog";

const EMPTY_TOOLKITS: Toolkit[] = [];

export function ToolkitBrowser({
  scope = WORKSPACE_SCOPE,
  agentName,
  suggestions = [],
  snapshot: initialSnapshot,
  selected: initialSelected = [],
  metadata: initialMetadata = [],
  onChange,
  feedback,
  demo = false,
  demoCatalog = EMPTY_TOOLKITS,
}: {
  scope?: AgentConnectionScope;
  agentName?: string;
  suggestions?: Toolkit[];
  snapshot: ConnectionSnapshot;
  selected?: string[];
  metadata?: Toolkit[];
  feedback?: string;
  demo?: boolean;
  demoCatalog?: Toolkit[];
  onChange?: (
    snapshot: ConnectionSnapshot,
    selected: string[],
    metadata: Toolkit[],
  ) => void;
}) {
  const isAgent = scope.playbookId !== "workspace";
  const [tab, setTab] = useState(isAgent ? "suggested" : "connected");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [selected, setSelected] = useState(initialSelected);
  const [metadata, setMetadata] = useState<Toolkit[]>(initialMetadata);
  const [page, setPage] = useState<CatalogPage>({
    items: [],
    total: 0,
    nextCursor: null,
  });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(initialSnapshot.error ?? "");
  const [catalogError, setCatalogError] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [notice, setNotice] = useState(feedback ?? "");
  const [busy, setBusy] = useState("");
  const [pending, startTransition] = useTransition();
  const revision = useRef(0);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (demo) return;
    let live = true;
    toolCategoriesAction()
      .then((result) => {
        if (live) {
          setCategories(result.categories ?? []);
          setCategoryError(result.error ?? "");
        }
      })
      .catch(() => {
        if (live)
          setCategoryError(
            "Categories couldn’t be loaded. Search is still available.",
          );
      });
    return () => {
      live = false;
    };
  }, [demo]);
  useEffect(() => {
    const counter = revision;
    const current = ++counter.current;
    if (tab !== "all") return;
    const timer = setTimeout(async () => {
      setLoading(true);
      setPage({ items: [], total: 0, nextCursor: null });
      setCatalogError("");
      try {
        if (demo) {
          const items = demoCatalog.filter(
            (tool) =>
              `${tool.name} ${tool.description}`
                .toLowerCase()
                .includes(search.toLowerCase()) &&
              (!category ||
                tool.categories.some((item) => item.id === category)),
          );
          if (revision.current === current)
            setPage({ items, total: items.length, nextCursor: null });
        } else {
          const result = await searchToolCatalogAction({ search, category });
          if (revision.current === current) {
            if (result.page) setPage(result.page);
            else
              setCatalogError(
                result.error ?? "The catalog couldn’t be loaded.",
              );
          }
        }
      } catch {
        if (revision.current === current)
          setCatalogError("The catalog couldn’t be loaded. Try again.");
      } finally {
        if (revision.current === current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      if (counter.current === current) counter.current++;
    };
  }, [tab, search, category, retry, demo, demoCatalog]);
  // Keep no-auth tools and active accounts visible even if the catalog is temporarily unavailable.
  const merged = new Map(
    [...suggestions, ...metadata, ...page.items].map((tool) => [
      tool.slug,
      tool,
    ]),
  );
  const known = (slug: string): Toolkit =>
    merged.get(slug) ?? {
      slug,
      name: slug,
      description: "Tool details are temporarily unavailable.",
      categories: [],
      noAuth: false,
      toolCount: 0,
    };
  const connectedIds = [
    ...new Set([
      ...snapshot.connected,
      ...selected.filter((slug) => known(slug).noAuth),
    ]),
  ];
  const localItems = (
    tab === "suggested"
      ? suggestions
      : tab === "assigned"
        ? selected.map(known)
        : connectedIds.map(known)
  ).filter(
    (tool) =>
      `${tool.name} ${tool.slug} ${tool.description}`
        .toLowerCase()
        .includes(search.toLowerCase().trim()) &&
      (!category || tool.categories.some((item) => item.id === category)),
  );
  const catalogLoading = tab === "all" && loading;
  const visible = tab === "all" ? page.items : localItems;
  const tabs = isAgent
    ? [
        { id: "suggested", label: "Suggested" },
        { id: "assigned", label: `Added (${selected.length})` },
        { id: "all", label: "All tools" },
      ]
    : [
        { id: "connected", label: `Connected (${connectedIds.length})` },
        { id: "all", label: "All tools" },
      ];
  function update(
    nextSnapshot = snapshot,
    nextSelected = selected,
    tool?: Toolkit,
  ) {
    const nextMetadata = [
      ...new Map(
        [...metadata, ...(tool ? [tool] : [])].map((item) => [item.slug, item]),
      ).values(),
    ];
    setSnapshot(nextSnapshot);
    setSelected(nextSelected);
    setMetadata(nextMetadata);
    onChange?.(nextSnapshot, nextSelected, nextMetadata);
  }
  function mutate(tool: Toolkit, remove = false) {
    setBusy(tool.slug);
    setError("");
    setNotice("");
    startTransition(async () => {
      try {
        if (demo) {
          const nextSelected = remove
            ? selected.filter((slug) => slug !== tool.slug)
            : [...new Set([...selected, tool.slug])];
          update(
            {
              ...snapshot,
              connected:
                remove && !isAgent
                  ? snapshot.connected.filter((slug) => slug !== tool.slug)
                  : tool.noAuth
                    ? snapshot.connected
                    : [...new Set([...snapshot.connected, tool.slug])],
            },
            nextSelected,
            tool,
          );
          return;
        }
        if (
          isAgent &&
          (remove || tool.noAuth || snapshot.connected.includes(tool.slug))
        ) {
          const result = await assignToolAction(tool.slug, scope, !remove);
          if (result.error) {
            setError(result.error);
            return;
          }
          update(
            snapshot,
            remove
              ? selected.filter((slug) => slug !== tool.slug)
              : [...new Set([...selected, tool.slug])],
            result.tool ?? tool,
          );
          setNotice(
            remove
              ? `${tool.name} removed from ${agentName}. The account stays connected.`
              : `${tool.name} added to ${agentName}.`,
          );
        } else if (remove) {
          const result = await disconnectToolAction(tool.slug);
          if (result.error) {
            setError(result.error);
            return;
          }
          update(
            result.snapshot,
            selected.filter((slug) => slug !== tool.slug),
            tool,
          );
          setNotice(
            tool.noAuth
              ? `${tool.name} removed from all agent selections.`
              : `${tool.name} disconnected. Agents using this account will need to reconnect it.`,
          );
        } else {
          const result = await connectToolAction(tool.slug, scope);
          if (result.url) {
            window.location.assign(result.url);
            return;
          }
          if (result.error || !result.connected) {
            setError(result.error ?? "The connection couldn’t be started.");
            return;
          }
          const fresh = await refreshConnectionsAction();
          update(
            fresh,
            isAgent || tool.noAuth
              ? [...new Set([...selected, tool.slug])]
              : selected,
            tool,
          );
          setNotice(`${tool.name} ${tool.noAuth ? "enabled" : "connected"}.`);
        }
      } catch {
        setError("We couldn’t update this tool. Try again.");
      } finally {
        setBusy("");
      }
    });
  }
  function refresh() {
    setBusy("refresh");
    setError("");
    startTransition(async () => {
      try {
        const fresh = await refreshConnectionsAction();
        update(fresh);
        setError(fresh.error ?? "");
      } catch {
        setError("Couldn’t refresh connections. Try again.");
      } finally {
        setBusy("");
      }
    });
  }
  async function loadMore() {
    if (!page.nextCursor || loadingMore) return;
    const current = revision.current;
    setLoadingMore(true);
    setCatalogError("");
    try {
      const result = await searchToolCatalogAction({
        search,
        category,
        cursor: page.nextCursor,
      });
      if (revision.current !== current) return;
      if (result.page) {
        const next = result.page;
        setPage((previous) => ({
          ...next,
          items: [
            ...new Map(
              [...previous.items, ...next.items].map((tool) => [
                tool.slug,
                tool,
              ]),
            ).values(),
          ],
        }));
      } else setCatalogError(result.error ?? "Couldn’t load more tools.");
    } catch {
      if (revision.current === current)
        setCatalogError("Couldn’t load more tools. Try again.");
    } finally {
      if (revision.current === current) setLoadingMore(false);
    }
  }
  return (
    <div className={`tool-browser ${isAgent ? "for-agent" : "for-workspace"}`}>
      <div className="tool-browser-heading">
        <div>
          <h2>{isAgent ? "Tools for this agent" : "Your tools"}</h2>
          <p>
            {isAgent
              ? "Start with a suggestion or find another tool for this role."
              : "Connect accounts once, then choose which specialists use them."}
          </p>
        </div>
        <button
          className="icon-button"
          aria-label="Refresh connections"
          disabled={pending || demo}
          onClick={refresh}
        >
          <RefreshCw size={16} className={busy === "refresh" ? "spin" : ""} />
        </button>
      </div>
      <div className="tool-browser-tabs" aria-label="Tool lists">
        {tabs.map((item) => (
          <button
            key={item.id}
            aria-pressed={tab === item.id}
            className={tab === item.id ? "selected" : ""}
            onClick={() => {
              if (item.id === "all" && tab !== "all") setLoading(true);
              setTab(item.id);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="tool-browser-filters">
        <label className="search-box">
          <Search size={16} />
          <input
            aria-label="Search tools"
            placeholder={
              tab === "all" || isAgent
                ? "Search all tools, including web search…"
                : "Search connected tools…"
            }
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              if (isAgent) setTab("all");
              if (tab === "all" || isAgent) setLoading(true);
            }}
          />
          {search && (
            <button
              onClick={() => {
                setSearch("");
                if (tab === "all") setLoading(true);
              }}
              aria-label="Clear tool search"
            >
              <X size={14} />
            </button>
          )}
        </label>
        <label className="tool-category-filter">
          <span className="sr-only">Tool category</span>
          <select
            aria-label="Tool category"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              if (isAgent) setTab("all");
              if (tab === "all" || isAgent) setLoading(true);
            }}
          >
            <option value="">All categories</option>
            {(demo
              ? [
                  ...new Map(
                    demoCatalog
                      .flatMap((tool) => tool.categories)
                      .map((item) => [item.id, item]),
                  ).values(),
                ]
              : categories
            ).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </label>
      </div>
      {isAgent && tab === "suggested" && (
        <p className="tool-suggestion-note">
          Suggestions are optional. Choose the tools that suit your workflow.
        </p>
      )}
      {!snapshot.configured && !demo && (
        <p className="notice">
          To enable tool connections, set <code>COMPOSIO_API_KEY</code> in the
          root <code>.env</code> file and run <code>docker compose up -d</code>.
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {categoryError && <p className="tool-catalog-message">{categoryError}</p>}
      {tab === "all" && (
        <div className="tool-catalog-summary">
          <span>
            {loading
              ? "Searching tools…"
              : `${page.total.toLocaleString()} tools available`}
          </span>
          <span>Browse integrations and search providers</span>
        </div>
      )}
      <div
        aria-busy={catalogLoading}
        className={`tool-catalog-list ${tab === "all" ? "catalog-grid" : ""}`}
      >
        {catalogLoading ? (
          <div role="status" className="tool-catalog-loading">
            <LoaderCircle size={18} className="spin" />
            Loading tools…
          </div>
        ) : (
          visible.map((tool) => {
            const added = selected.includes(tool.slug);
            const active =
              snapshot.connected.includes(tool.slug) || tool.noAuth;
            const isConnected = isAgent
              ? added && active
              : connectedIds.includes(tool.slug);
            const reconnect = snapshot.reconnect?.includes(tool.slug);
            const waiting = snapshot.pending?.includes(tool.slug);
            return (
              <article className="tool-catalog-item" key={tool.slug}>
                <div className="tool-catalog-icon">
                  <AppWindow size={21} strokeWidth={1.5} />
                </div>
                <div className="tool-catalog-info">
                  <h3>{tool.name}</h3>
                  <p>{tool.description}</p>
                  <div className="tool-catalog-tags">
                    {tool.noAuth && <span>No sign-in needed</span>}
                    {tool.categories.slice(0, 1).map((item) => (
                      <span key={item.id}>{item.name}</span>
                    ))}
                    {waiting && !active && <span>Authorization pending</span>}
                  </div>
                </div>
                <div className="tool-catalog-controls">
                  {isConnected ? (
                    <>
                      <span className="connection-status">
                        <Check size={13} />
                        {isAgent
                          ? "Added"
                          : tool.noAuth
                            ? "Enabled"
                            : "Connected"}
                      </span>
                      <button
                        className="btn ghost"
                        disabled={pending}
                        onClick={() => mutate(tool, true)}
                        aria-label={`${isAgent ? "Remove" : "Disconnect"} ${tool.name}`}
                      >
                        {busy === tool.slug ? (
                          <LoaderCircle size={14} className="spin" />
                        ) : isAgent ? (
                          "Remove"
                        ) : tool.noAuth ? (
                          "Remove"
                        ) : (
                          "Disconnect"
                        )}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="btn secondary"
                        disabled={pending || !snapshot.configured}
                        onClick={() => mutate(tool)}
                        aria-label={`${isAgent && active ? "Add" : "Connect"} ${tool.name}`}
                      >
                        {busy === tool.slug ? (
                          <LoaderCircle size={14} className="spin" />
                        ) : (
                          <>
                            {isAgent && active
                              ? "Add to agent"
                              : tool.noAuth
                                ? "Enable"
                                : reconnect
                                  ? "Reconnect"
                                  : isAgent
                                    ? "Connect & add"
                                    : "Connect"}
                            {active ? (
                              <Plus size={14} />
                            ) : (
                              <ArrowUpRight size={14} />
                            )}
                          </>
                        )}
                      </button>
                      {isAgent && added && (
                        <button
                          className="btn ghost"
                          onClick={() => mutate(tool, true)}
                          disabled={pending}
                        >
                          Remove
                        </button>
                      )}
                    </>
                  )}
                </div>
              </article>
            );
          })
        )}
        {!catalogLoading && !visible.length && !catalogError && (
          <div className="tool-catalog-empty">
            <Search size={24} />
            <h3>
              {tab === "connected"
                ? "No connected tools yet"
                : tab === "assigned"
                  ? "Choose tools for this agent"
                  : "No tools match these filters"}
            </h3>
            <p>
              {tab === "connected" || tab === "assigned"
                ? "Explore the catalog to connect an account or add a tool that needs no sign-in."
                : "Try a different search or category."}
            </p>
            <button
              className="btn secondary"
              onClick={() => {
                setSearch("");
                setCategory("");
                setLoading(true);
                setRetry((value) => value + 1);
                setTab("all");
              }}
            >
              Browse all tools
              <ArrowUpRight size={14} />
            </button>
          </div>
        )}
      </div>
      {catalogError && (
        <div className="tool-catalog-error" role="alert">
          <p>{catalogError}</p>
          <button
            className="btn secondary"
            onClick={() =>
              page.items.length && page.nextCursor
                ? loadMore()
                : setRetry((value) => value + 1)
            }
          >
            Try again
          </button>
        </div>
      )}
      {tab === "all" && !loading && page.nextCursor && (
        <div className="tool-load-more">
          <button
            className="btn secondary"
            disabled={loadingMore}
            onClick={loadMore}
          >
            {loadingMore ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <Plus size={14} />
            )}
            Load more tools
          </button>
          <span>
            Showing {page.items.length} of {page.total.toLocaleString()}
          </span>
        </div>
      )}
    </div>
  );
}
