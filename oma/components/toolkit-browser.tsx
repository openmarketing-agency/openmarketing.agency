"use client";
import Image from "next/image";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
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
  connectToolAction,
  disconnectToolAction,
  refreshConnectionsAction,
  searchToolCatalogAction,
  toolCategoriesAction,
} from "@/app/actions/composio";
import {
  isWorkspaceScope,
  WORKSPACE_SCOPE,
  type ToolConnectionScope,
} from "@/lib/agent-connections";
import type { RequiredIntegration } from "@/lib/server/agent-workspace";
import type { ConnectionSnapshot } from "@/lib/tool-connection-service";
import type { CatalogPage, Toolkit } from "@/lib/tool-catalog";

const EMPTY_TOOLKITS: Toolkit[] = [];
const NO_REQUIRED_INTEGRATIONS: RequiredIntegration[] = [];
type ToolList = "connected" | "all";

function ToolkitLogo({ url }: { url?: string }) {
  const [failed, setFailed] = useState<string>();
  return (
    <div className="tool-catalog-icon" aria-hidden="true">
      {url && url !== failed ? (
        <Image src={url} width={24} height={24} alt="" unoptimized referrerPolicy="no-referrer"
          onError={() => setFailed(url)} />
      ) : <AppWindow size={21} strokeWidth={1.5} />}
    </div>
  );
}

export function ToolkitBrowser({
  scope = WORKSPACE_SCOPE,
  requiredIntegrations = NO_REQUIRED_INTEGRATIONS,
  snapshot: initialSnapshot,
  selected: initialSelected = [],
  metadata: initialMetadata = [],
  onChange,
  feedback,
  headingAction,
  demo = false,
  demoCatalog = EMPTY_TOOLKITS,
}: {
  scope?: ToolConnectionScope;
  requiredIntegrations?: RequiredIntegration[];
  snapshot: ConnectionSnapshot;
  selected?: string[];
  metadata?: Toolkit[];
  feedback?: string;
  headingAction?: ReactNode;
  demo?: boolean;
  demoCatalog?: Toolkit[];
  onChange?: (
    snapshot: ConnectionSnapshot,
    metadata: Toolkit[],
  ) => void;
}) {
  const isCampaign = !isWorkspaceScope(scope);
  const hasRequiredTools = isCampaign && requiredIntegrations.length > 0;
  const [selectedTab, setSelectedTab] = useState<ToolList>(
    initialSnapshot.configured && !initialSnapshot.connected.length ? "all" : "connected",
  );
  const tab = isCampaign ? "required" : selectedTab;
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const canBrowseCatalog = snapshot.configured || demo;
  const [selected, setSelected] = useState(initialSelected);
  const [metadata, setMetadata] = useState<Toolkit[]>(initialMetadata);
  const [page, setPage] = useState<CatalogPage>({
    items: demo ? demoCatalog : [],
    total: demo ? demoCatalog.length : 0,
    nextCursor: null,
  });
  const [loading, setLoading] = useState(tab === "all" && canBrowseCatalog && !demo);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(initialSnapshot.error ?? "");
  const [catalogError, setCatalogError] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [notice, setNotice] = useState(feedback ?? "");
  const [busy, setBusy] = useState("");
  const [pending, startTransition] = useTransition();
  const revision = useRef(0);
  const [retry, setRetry] = useState(0);
  const showCategories = !isCampaign;
  useEffect(() => {
    if (demo || !showCategories || !snapshot.configured) return;
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
  }, [demo, showCategories, snapshot.configured]);
  useEffect(() => {
    const counter = revision;
    const current = ++counter.current;
    if (tab !== "all" || !canBrowseCatalog) return;
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
  }, [tab, search, category, retry, demo, demoCatalog, canBrowseCatalog]);
  // Keep no-auth tools and active accounts visible even if the catalog is temporarily unavailable.
  const merged = new Map(
    [...metadata, ...page.items].map((tool) => [
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
  const requiredBySlug = new Map(requiredIntegrations.flatMap((tool) => tool.slug ? [[tool.slug, tool]] as const : []));
  const unsupported = isCampaign ? requiredIntegrations.filter(({ slug }) => !slug) : [];
  const localItems = (isCampaign
    ? [...requiredBySlug].map(([slug, required]) => merged.get(slug) ?? { ...known(slug), name: required.name })
    : connectedIds.map(known)
  ).filter(
    (tool) =>
      `${tool.name} ${tool.slug} ${tool.description}`
        .toLowerCase()
        .includes(search.toLowerCase().trim()) &&
      (!category || tool.categories.some((item) => item.id === category)),
  );
  const catalogLoading = tab === "all" && canBrowseCatalog && loading;
  const showFilters = !isCampaign && (canBrowseCatalog || connectedIds.length > 0);
  const visible = tab === "all" ? page.items : localItems;
  const tabs: { id: ToolList; label: string }[] = [
    { id: "connected", label: `Connected (${connectedIds.length})` },
    { id: "all", label: "All tools" },
  ];

  function selectToolList(next: ToolList) {
    if (next === tab) return;
    if (next === "all" && canBrowseCatalog) setLoading(true);
    setSelectedTab(next);
  }

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
    onChange?.(nextSnapshot, nextMetadata);
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
                remove && !isCampaign
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
        if (remove) {
          const result = await disconnectToolAction(tool.slug);
          if (result.error) {
            setError(result.error);
            return;
          }
          update(
            result.snapshot,
            result.selected ?? selected,
            tool,
          );
          setNotice(
            tool.noAuth
              ? `${tool.name} disabled in the workspace.`
              : `${tool.name} disconnected. Campaigns using this account will need to reconnect it.`,
          );
        } else {
          const result = await connectToolAction(tool.slug, scope);
          if (result.url) {
            window.location.assign(result.url);
            return;
          }
          if (!result.connected) {
            setError(result.error ?? "The connection couldn’t be started.");
            return;
          }
          const fresh = await refreshConnectionsAction(scope);
          update(fresh.snapshot, fresh.selected ?? selected, tool);
          if (result.error || fresh.error) setError(result.error ?? fresh.error ?? "");
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
        const fresh = await refreshConnectionsAction(scope);
        update(fresh.snapshot, fresh.selected ?? selected);
        setError(fresh.error ?? fresh.snapshot.error ?? "");
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
    <div className={`tool-browser ${isCampaign ? "for-campaign" : "for-workspace"}`}>
      <div className="tool-browser-heading">
        <div>
          <h2>{isCampaign ? "Campaign tools" : "Tool catalog"}</h2>
          {hasRequiredTools && <p>Connect the tools required by this campaign’s configuration.</p>}
        </div>
        {isCampaign ? headingAction : (
          <button
            type="button"
            className="icon-button"
            aria-label="Refresh connections"
            disabled={pending || demo || !snapshot.configured}
            onClick={refresh}
          >
            <RefreshCw size={16} className={busy === "refresh" ? "spin" : ""} />
          </button>
        )}
      </div>
      {showFilters && (
        <div className="tool-browser-tabs" role="group" aria-label="Tool lists">
          {tabs.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={tab === item.id}
              disabled={item.id === "all" && !canBrowseCatalog}
              className={tab === item.id ? "selected" : ""}
              onClick={() => selectToolList(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {showFilters && (
        <div className="tool-browser-filters">
          <label className="search-box">
            <Search size={16} />
            <input
              ref={searchInput}
              aria-label="Search tools"
              placeholder={tab === "all" ? "Search tools…" : "Search connected tools…"}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                if (canBrowseCatalog && tab === "all") setLoading(true);
              }}
            />
            {search && (
              <button
                onClick={() => {
                  setSearch("");
                  if (tab === "all") setLoading(true);
                  searchInput.current?.focus();
                }}
                aria-label="Clear tool search"
              >
                <X size={14} />
              </button>
            )}
          </label>
          {showCategories && canBrowseCatalog && <label className="tool-category-filter">
            <span className="sr-only">Tool category</span>
            <select
              aria-label="Tool category"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                if (canBrowseCatalog && tab === "all") setLoading(true);
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
          </label>}
        </div>
      )}
      {!canBrowseCatalog && (!isCampaign || hasRequiredTools) && (
        <div className="notice">
          <div>
            <strong>Tool provider setup required</strong>
            <p>Set <code>COMPOSIO_API_KEY</code> in the console environment, then restart the console.</p>
          </div>
        </div>
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
      {showCategories && categoryError && <p className="tool-catalog-message">{categoryError}</p>}
      {tab === "all" && canBrowseCatalog && (
        <div className="tool-catalog-summary">
          <span>
            {loading
              ? "Searching tools…"
              : `${page.total.toLocaleString()} ${page.total === 1 ? "tool" : "tools"} available`}
          </span>
          <span>Browse integrations and search providers</span>
        </div>
      )}
      <div
        aria-busy={catalogLoading}
        className={`tool-catalog-list ${tab === "all" ? "catalog-grid" : ""}`}
      >
        {unsupported.map(({ id, name }) => (
            <article className="tool-catalog-item" key={id}>
              <ToolkitLogo />
              <div className="tool-catalog-info">
                <h3>{name}</h3>
                <p>No verified Composio toolkit is available.</p>
                <div className="tool-catalog-tags"><span>Required</span></div>
              </div>
            </article>
          ))}
        {catalogLoading ? (
          <div role="status" className="tool-catalog-loading">
            <LoaderCircle size={18} className="spin" />
            Loading tools…
          </div>
        ) : (
          visible.map((tool) => {
            const required = requiredBySlug.has(tool.slug);
            const active =
              snapshot.connected.includes(tool.slug) || tool.noAuth;
            const isConnected = isCampaign ? active : connectedIds.includes(tool.slug);
            const reconnect = snapshot.reconnect?.includes(tool.slug);
            const waiting = snapshot.pending?.includes(tool.slug);
            return (
              <article className="tool-catalog-item" key={tool.slug}>
                <ToolkitLogo url={tool.logoUrl} />
                <div className="tool-catalog-info">
                  <h3>{tool.name}</h3>
                  {tool.description && <p>{tool.description}</p>}
                  <div className="tool-catalog-tags">
                    {required && <span>Required</span>}
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
                        {isCampaign ? "Ready" : tool.noAuth ? "Enabled" : "Connected"}
                      </span>
                      {!isCampaign && <button
                        className="btn ghost"
                        disabled={pending}
                        onClick={() => mutate(tool, true)}
                        aria-label={`${tool.noAuth ? "Remove" : "Disconnect"} ${tool.name}`}
                      >
                        {busy === tool.slug ? (
                          <LoaderCircle size={14} className="spin" />
                        ) : tool.noAuth ? (
                          "Remove"
                        ) : (
                          "Disconnect"
                        )}
                      </button>}
                    </>
                  ) : (
                    <>
                      <button
                        className="btn secondary"
                        disabled={pending || !snapshot.configured}
                        onClick={() => mutate(tool)}
                        aria-label={`${tool.noAuth ? "Enable" : reconnect ? "Reconnect" : "Connect"} ${tool.name}`}
                      >
                        {busy === tool.slug ? (
                          <LoaderCircle size={14} className="spin" />
                        ) : (
                          <>
                            {tool.noAuth ? "Enable" : reconnect ? "Reconnect" : "Connect"}
                            {active ? (
                              <Plus size={14} />
                            ) : (
                              <ArrowUpRight size={14} />
                            )}
                          </>
                        )}
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })
        )}
        {tab === "required" && !visible.length && !unsupported.length && (
          <div className="tool-catalog-empty">
            <h3>No integrations suggested</h3>
          </div>
        )}
        {tab !== "required" && canBrowseCatalog && !catalogLoading && !visible.length && !catalogError && (
          <div className="tool-catalog-empty">
            <Search size={24} />
            <h3>
              {tab === "connected"
                ? "No connected tools yet"
                : "No tools match these filters"}
            </h3>
            <p>
              {tab === "connected"
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
                setSelectedTab("all");
              }}
            >
              Browse all tools
              <ArrowUpRight size={14} />
            </button>
          </div>
        )}
      </div>
      {tab === "all" && catalogError && (
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
