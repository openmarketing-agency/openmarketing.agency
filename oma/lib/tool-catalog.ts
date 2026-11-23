import type { Composio } from "@composio/core";
import { tools } from "./campaigns.ts";

export type Toolkit = {
  slug: string;
  name: string;
  description: string;
  logoUrl?: string;
  categories: { id: string; name: string }[];
  noAuth: boolean;
  toolCount: number;
  managedAuth?: boolean;
  authSchemes?: string[];
};
export type CatalogQuery = {
  search?: string;
  category?: string;
  cursor?: string;
};
export type CatalogPage = {
  items: Toolkit[];
  nextCursor: string | null;
  total: number;
};
export const validToolkitSlug = (slug: unknown): slug is string =>
  typeof slug === "string" && /^[a-z0-9][a-z0-9_-]{0,127}$/.test(slug);
export function toolkitSlug(id: string) {
  return Object.hasOwn(tools, id) ? tools[id as keyof typeof tools].slug : id;
}
export function suggestedToolkit(id: keyof typeof tools): Toolkit {
  const tool = tools[id];
  return {
    slug: tool.slug,
    name: tool.name,
    description: tool.description,
    categories: [],
    noAuth: false,
    toolCount: 0,
  };
}
type CatalogClient = ReturnType<Composio["getClient"]>;
type CatalogItem = Awaited<ReturnType<CatalogClient["toolkits"]["list"]>>["items"][number];

function toToolkit(item: CatalogItem): Toolkit {
  const logo = typeof item.meta.logo === "string" ? URL.parse(item.meta.logo) : null;
  const logoUrl = logo?.protocol === "https:" && !logo.username && !logo.password ? logo.href : undefined;
  return {
    slug: item.slug,
    name: item.name,
    description: item.meta.description,
    ...(logoUrl && { logoUrl }),
    categories: item.meta.categories,
    noAuth: Boolean(item.no_auth),
    toolCount: item.meta.tools_count,
    managedAuth: Boolean(item.composio_managed_auth_schemes?.length),
    authSchemes: item.auth_schemes ?? [],
  };
}

export function createToolCatalog(client: CatalogClient) {
  const cache = new Map<string, { tool: Toolkit; expiresAt: number }>();
  async function list(query: CatalogQuery = {}): Promise<CatalogPage> {
    const page = await client.toolkits.list({
      type: "native",
      limit: 24,
      sort_by: "usage",
      search: query.search?.trim().slice(0, 100) || undefined,
      category: query.category || undefined,
      cursor: query.cursor || undefined,
    });
    const items = page.items.map(toToolkit);
    items.forEach((item) =>
      cache.set(item.slug, { tool: item, expiresAt: Date.now() + 300_000 }),
    );
    return {
      items,
      nextCursor: page.next_cursor ?? null,
      total: page.total_items,
    };
  }
  async function get(slug: string): Promise<Toolkit> {
    if (!validToolkitSlug(slug)) throw new Error("Choose a supported tool.");
    const cached = cache.get(slug);
    if (cached && cached.expiresAt > Date.now()) return cached.tool;
    const page = await client.toolkits.list({
      type: "native",
      search: slug,
      limit: 100,
    });
    const item = page.items.find((item) => item.slug === slug);
    if (!item) throw new Error("This tool is no longer available.");
    const toolkit = toToolkit(item);
    cache.set(slug, { tool: toolkit, expiresAt: Date.now() + 300_000 });
    return toolkit;
  }
  let categoryCache:
    { items: { id: string; name: string }[]; expiresAt: number } | undefined;
  async function categories() {
    if (categoryCache && categoryCache.expiresAt > Date.now())
      return categoryCache.items;
    const raw = (await client.toolkits.retrieveCategories()).items;
    // The API repeats categories per toolkit. Return one option per category ID.
    const counts = new Map<string, number>();
    const unique = new Map<string, { id: string; name: string }>();
    for (const category of raw) {
      unique.set(category.id, category);
      counts.set(category.id, (counts.get(category.id) ?? 0) + 1);
    }
    const items = [...unique.values()].sort(
      (a, b) =>
        counts.get(b.id)! - counts.get(a.id)! || a.name.localeCompare(b.name),
    );
    categoryCache = { items, expiresAt: Date.now() + 300_000 };
    return items;
  }
  return { list, get, categories };
}
