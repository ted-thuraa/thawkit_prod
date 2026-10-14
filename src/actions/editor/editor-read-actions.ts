// path: src/actions/editor/editor-read-actions.ts

"use server";

import { loadCollectionsBootstrap } from "@/lib/editor/bootstrap/load-collections";
import { toErrorResult } from "@/lib/editor/read/action-result";
import {
  queryAssetsByIds,
  queryAssetsPage,
  loadAssetFolders,
} from "@/lib/editor/read/asset-queries";
import {
  queryCollectionFields,
  queryCollectionItemById,
  queryCollectionItemsPage,
  queryItemSlugs,
  queryReferencedItemsBatch,
} from "@/lib/editor/read/collection-queries";
import { requireCampaignScope } from "@/lib/editor/read/guards";
import {
  queryPageLayers,
  type PageLayersSnapshot,
} from "@/lib/editor/read/page-queries";
import {
  assetIdsSchema,
  collectionIdsSchema,
  collectionItemsOptionsSchema,
  fetchAssetsParamsSchema,
  idSchema,
  itemIdsSchema,
  referencedLimitSchema,
  searchTermSchema,
  type CollectionItemsOptionsInput,
  type FetchAssetsParamsInput,
} from "@/lib/editor/read/schemas";
import type {
  ActionResult,
  AssetsPage,
  CollectionItemsPage,
} from "@/lib/editor/read/types";
import type { CollectionsBootstrapData } from "@/lib/editor/bootstrap/types";
import type {
  Asset,
  AssetFolder,
  CollectionField,
  CollectionItemWithValues,
} from "@/types/funnel";

/**
 * Typed Server Action READS for the editor — the on-demand counterpart to
 * the initial bootstrap (resolve-editor-bootstrap.ts). They replace the
 * `/ycode/api/*` GET endpoints the Ycode-ported stores still call, none of
 * which exist in this project.
 *
 * EVERY action, in this order:
 *   1. shape-checks `campaignId`,
 *   2. authenticates + authorizes the caller for that campaign and derives
 *      the tenant scope from it (organization for assets, funnel for
 *      collections) — never from client-supplied tenant ids,
 *   3. validates the rest of the payload with zod (an action is a public
 *      endpoint; TypeScript parameter types are not enforced at runtime),
 *   4. runs a query that re-proves any client-supplied collection / item id
 *      belongs to that scope.
 * Failures come back as `ActionResult` — known app errors keep their
 * message, everything else is logged and replaced by a generic one.
 *
 * Reads only. Mutations (create/update/delete/reorder) and the publish
 * pipeline are deliberately not here.
 */

/** Steps 1–2. Not exported: a "use server" module may only export async actions. */
async function authorize(campaignId: string) {
  return requireCampaignScope(idSchema.parse(campaignId));
}

// ─── Pages ──────────────────────────────────────────────────────────────────

/**
 * The last SAVED layer tree of one page — the refresh path behind the pages
 * store's `reloadPage` (undo/redo "restore latest"). Returns what autosave
 * last wrote, which can lag the editor's in-memory copy by up to the autosave
 * debounce.
 */
export async function getPageLayersAction(
  campaignId: string,
  pageId: string,
): Promise<ActionResult<PageLayersSnapshot>> {
  try {
    const scope = await authorize(campaignId);
    const id = idSchema.parse(pageId);
    return { success: true, data: await queryPageLayers(scope, id) };
  } catch (error) {
    return toErrorResult(error, "Failed to load page.");
  }
}

// ─── Assets ─────────────────────────────────────────────────────────────────

/** One page of the media library: folder-scoped, searchable. */
export async function fetchAssetsPageAction(
  campaignId: string,
  params: FetchAssetsParamsInput,
): Promise<ActionResult<AssetsPage>> {
  try {
    const scope = await authorize(campaignId);
    const input = fetchAssetsParamsSchema.parse(params);
    return { success: true, data: await queryAssetsPage(scope.organizationId, input) };
  } catch (error) {
    return toErrorResult(error, "Failed to load assets.");
  }
}

/** Batch lookup by id (the `getAsset` cache-miss path). Unknown ids are omitted. */
export async function getAssetsByIdsAction(
  campaignId: string,
  ids: string[],
): Promise<ActionResult<Asset[]>> {
  try {
    const scope = await authorize(campaignId);
    const input = assetIdsSchema.parse(ids);
    return { success: true, data: await queryAssetsByIds(scope.organizationId, input) };
  } catch (error) {
    return toErrorResult(error, "Failed to load assets.");
  }
}

export async function getAssetFoldersAction(
  campaignId: string,
): Promise<ActionResult<AssetFolder[]>> {
  try {
    const scope = await authorize(campaignId);
    return { success: true, data: await loadAssetFolders(scope.organizationId) };
  } catch (error) {
    return toErrorResult(error, "Failed to load asset folders.");
  }
}

// ─── Collections ────────────────────────────────────────────────────────────

/**
 * Re-runs the whole collections bootstrap (collections, fields, first page of
 * items) — the refresh path behind the store's `loadCollections`.
 */
export async function refreshCollectionsAction(
  campaignId: string,
): Promise<ActionResult<CollectionsBootstrapData>> {
  try {
    const scope = await authorize(campaignId);
    return { success: true, data: await loadCollectionsBootstrap(scope.funnelId) };
  } catch (error) {
    return toErrorResult(error, "Failed to load collections.");
  }
}

/** Fields of one collection, or of every collection in the funnel when `collectionId` is null. */
export async function getCollectionFieldsAction(
  campaignId: string,
  collectionId: string | null,
  search?: string,
): Promise<ActionResult<CollectionField[]>> {
  try {
    const scope = await authorize(campaignId);
    const id = collectionId === null ? null : idSchema.parse(collectionId);
    const term = searchTermSchema.parse(search);
    return { success: true, data: await queryCollectionFields(scope, id, term) };
  } catch (error) {
    return toErrorResult(error, "Failed to load fields.");
  }
}

/** Paged, searched, filtered and sorted items of one collection. */
export async function getCollectionItemsAction(
  campaignId: string,
  collectionId: string,
  options: CollectionItemsOptionsInput,
): Promise<ActionResult<CollectionItemsPage>> {
  try {
    const scope = await authorize(campaignId);
    const id = idSchema.parse(collectionId);
    const input = collectionItemsOptionsSchema.parse(options ?? {});
    return { success: true, data: await queryCollectionItemsPage(scope, id, input) };
  } catch (error) {
    return toErrorResult(error, "Failed to load items.");
  }
}

/** First `limit` items for many collections in one round trip (reference fields). */
export async function getReferencedItemsBatchAction(
  campaignId: string,
  collectionIds: string[],
  limit: number,
): Promise<
  ActionResult<{ items: Record<string, { items: CollectionItemWithValues[] }> }>
> {
  try {
    const scope = await authorize(campaignId);
    const ids = collectionIdsSchema.parse(collectionIds);
    const max = referencedLimitSchema.parse(limit);
    // `{ items: { [collectionId]: { items } } }` — the shape the layer store
    // has always read from this call (`response.data.items`).
    return {
      success: true,
      data: { items: await queryReferencedItemsBatch(scope, ids, max) },
    };
  } catch (error) {
    return toErrorResult(error, "Failed to load referenced items.");
  }
}

export async function getCollectionItemByIdAction(
  campaignId: string,
  collectionId: string,
  itemId: string,
): Promise<ActionResult<CollectionItemWithValues>> {
  try {
    const scope = await authorize(campaignId);
    const cId = idSchema.parse(collectionId);
    const iId = idSchema.parse(itemId);
    return { success: true, data: await queryCollectionItemById(scope, cId, iId) };
  } catch (error) {
    return toErrorResult(error, "Failed to load item.");
  }
}

/** `item id → slug` across the funnel's collections. */
export async function getItemSlugsAction(
  campaignId: string,
  itemIds: string[],
): Promise<ActionResult<{ slugs: Record<string, string> }>> {
  try {
    const scope = await authorize(campaignId);
    const ids = itemIdsSchema.parse(itemIds);
    return { success: true, data: { slugs: await queryItemSlugs(scope, ids) } };
  } catch (error) {
    return toErrorResult(error, "Failed to load item slugs.");
  }
}
