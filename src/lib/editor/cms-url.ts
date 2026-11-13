// path: src/lib/editor/cms-url.ts

/**
 * Pure URL contract for the CMS editor area (no React, no stores).
 *
 *   /campaign/{campaignId}/edit/cms                         → no collection selected
 *   /campaign/{campaignId}/edit/cms/{collectionId}          → collection table
 *   …/cms/{collectionId}?page=2&limit=50&search=foo         → pagination / search
 *   …/cms/{collectionId}?edit={itemId}                      → edit an existing item
 *   …/cms/{collectionId}?new                                → create a new item
 *
 * The URL is the single source of truth for WHICH collection / item is open;
 * the collections store only holds the loaded data. Mirrors Ycode's
 * `/ycode/collections/[id]?page&limit&search&edit|new` contract.
 */

import { buildAreaUrl } from "./editor-areas";

export const CMS_DEFAULT_PAGE_SIZE = 25;
export const CMS_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export const CMS_MAX_SEARCH_LENGTH = 200;

export interface CmsUrlState {
  collectionId: string | null;
  /** Existing item being edited (`?edit=<id>`), never "new". */
  itemId: string | null;
  /** `?new` — the create-item sheet is open. */
  isCreatingItem: boolean;
  page: number;
  pageSize: number;
  search: string;
}

interface SearchParamsLike {
  get(name: string): string | null;
  has(name: string): boolean;
}

function parsePositiveInt(value: string | null): number | null {
  if (!value || !/^\d{1,9}$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 ? n : null;
}

export function parseCmsUrlState(
  collectionId: string | null,
  searchParams: SearchParamsLike | null | undefined,
): CmsUrlState {
  const sp = searchParams ?? null;
  const rawEdit = sp?.get("edit")?.trim() || null;
  // `?edit=new` is accepted as an alias of `?new` (Ycode emitted both).
  const isCreatingItem = !!sp && (sp.has("new") || rawEdit === "new");
  const limit = parsePositiveInt(sp?.get("limit") ?? null);

  return {
    collectionId: collectionId || null,
    itemId: !isCreatingItem && rawEdit && collectionId ? rawEdit : null,
    isCreatingItem: !!collectionId && isCreatingItem,
    page: parsePositiveInt(sp?.get("page") ?? null) ?? 1,
    pageSize:
      limit !== null && limit <= 100 ? limit : CMS_DEFAULT_PAGE_SIZE,
    search: (sp?.get("search") ?? "").trim().slice(0, CMS_MAX_SEARCH_LENGTH),
  };
}

export interface BuildCmsUrlOptions {
  page?: number;
  pageSize?: number;
  search?: string;
  /** Existing item id to edit, or the literal "new" to create. */
  item?: string | "new" | null;
}

/** Canonical CMS URL. Defaults (page 1, default limit, empty search) are omitted. */
export function buildCmsUrl(
  campaignId: string,
  collectionId: string | null,
  options: BuildCmsUrlOptions = {},
): string {
  const base = buildAreaUrl(campaignId, "cms");
  if (!collectionId) return base;

  const params = new URLSearchParams();
  if (options.page && options.page > 1) params.set("page", String(options.page));
  if (options.pageSize && options.pageSize !== CMS_DEFAULT_PAGE_SIZE) {
    params.set("limit", String(options.pageSize));
  }
  const search = options.search?.trim();
  if (search) params.set("search", search.slice(0, CMS_MAX_SEARCH_LENGTH));

  let query = params.toString();
  if (options.item === "new") {
    query = query ? `${query}&new` : "new";
  } else if (options.item) {
    params.set("edit", options.item);
    query = params.toString();
  }

  return `${base}/${encodeURIComponent(collectionId)}${query ? `?${query}` : ""}`;
}
