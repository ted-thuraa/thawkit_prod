// path: src/lib/editor/bootstrap/types.ts

import type {
  Asset,
  AssetFolder,
  Collection,
  CollectionField,
  CollectionItemWithValues,
} from "@/types/funnel";

/**
 * Wire types for the editor bootstrap payload (server → client).
 *
 * Everything here is plain JSON: timestamps are ISO strings, nothing is a
 * Drizzle row, and every shape is already the domain type the Zustand stores
 * speak. Row → domain mapping happens on the SERVER (see mappers.ts), so rows
 * never cross the RSC boundary for the new sections and the stores can
 * hydrate with zero transformation.
 */

/**
 * An optional section can fail without taking the editor down. Page editing
 * must not die because a CMS or media-library query broke, so these sections
 * degrade to `{ status: "error" }` (logged server-side with full detail) and
 * the client surfaces a notice. The message is deliberately generic — no
 * internal error text reaches the browser.
 */
export type BootstrapSection<T> =
  | { status: "ready"; data: T }
  | { status: "error"; error: string };

export interface AssetsBootstrapData {
  /** Every live draft folder in the organization's library. */
  folders: AssetFolder[];
  /**
   * A SUBSET of the library: assets referenced by this funnel's pages,
   * components, styles and CMS values, plus the first page of the library
   * root. Anything else is fetched on demand — the store must not assume
   * completeness.
   */
  assets: Asset[];
}

export interface CollectionItemsQuery {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: string;
}

export interface CollectionsBootstrapData {
  /** Ordered like `sortCollectionsByOrder` (order asc, then name). */
  collections: Collection[];
  /** Keyed by collection id. Every collection has an entry (possibly `[]`). */
  fields: Record<string, CollectionField[]>;
  /** Keyed by collection id: the first page only. */
  items: Record<string, CollectionItemWithValues[]>;
  /** Keyed by collection id: total live draft items (for pagination). */
  itemsTotalCount: Record<string, number>;
  /** Keyed by collection id: the query that produced `items`. */
  lastItemsQuery: Record<string, CollectionItemsQuery>;
}
