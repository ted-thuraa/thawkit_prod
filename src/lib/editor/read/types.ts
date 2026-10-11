// path: src/lib/editor/read/types.ts

import type { Asset, CollectionItemWithValues } from "@/types/funnel";

/**
 * Wire types for the editor's on-demand READ server actions (Phase 5).
 * Pure type module: safe to import from server actions, the client adapter
 * and the stores alike.
 */

/** Same convention as editor-actions.ts. */
export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface AssetsPage {
  assets: Asset[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface CollectionItemsPage {
  items: CollectionItemWithValues[];
  total: number;
  page: number;
  limit: number;
  /** Present only when `includeAssets` was requested and any are referenced. */
  referencedAssets?: Asset[];
}
