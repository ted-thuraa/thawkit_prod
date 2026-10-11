// path: src/lib/editor/editor-read-api.ts

import {
  fetchAssetsPageAction,
  getAssetFoldersAction,
  getAssetsByIdsAction,
  getCollectionFieldsAction,
  getCollectionItemByIdAction,
  getCollectionItemsAction,
  getItemSlugsAction,
  getReferencedItemsBatchAction,
  refreshCollectionsAction,
} from "@/actions/editor/editor-read-actions";
import { useEditorBootstrapStore } from "@/stores/editor/useEditorBootstrapStore";
import type { CollectionItemsOptionsInput } from "@/lib/editor/read/schemas";
import type { ActionResult } from "@/lib/editor/read/types";

/**
 * Client-side facade over the editor's READ server actions
 * (`editor-read-actions.ts`). It exists so the Ycode-ported stores can swap
 * `collectionsApi.getItems(...)` → `collectionsReadApi.getItems(...)` with
 * nothing else changing: same method names, same `{ data?, error? }` return
 * shape, no thrown errors. When the write path moves to server actions too,
 * this adapter is the single thing to retire.
 *
 * CAMPAIGN SWITCH SAFETY. The stores are module singletons that are reset
 * and re-hydrated when the user opens a different campaign. A read that was
 * in flight for the PREVIOUS campaign could resolve afterwards and write its
 * result into the NEW campaign's store (the server would happily serve it —
 * the user is authorized for both). So every call captures the campaign id
 * when it starts, and if the editor has moved on by the time the response
 * arrives, the result is dropped by returning a promise that never settles:
 * the caller's `await` simply never continues, so nothing is written, no
 * error state is set, and no loading flag is left stuck (the stores were
 * already reset). The abandoned promise holds no references and is GC'd.
 */

/**
 * Item-query options as the stores build them. Callers hold `sortOrder` as a
 * plain string (it comes from persisted collection settings), so it is
 * accepted as one and normalized here; anything other than "asc"/"desc" is
 * dropped. The server validates the payload again regardless.
 */
export type ItemsReadOptions = Omit<CollectionItemsOptionsInput, "sortOrder"> & {
  sortOrder?: string;
};

function toActionOptions(
  options: ItemsReadOptions | undefined,
): CollectionItemsOptionsInput {
  if (!options) return {};
  const { sortOrder, ...rest } = options;
  return {
    ...rest,
    ...(sortOrder === "asc" || sortOrder === "desc" ? { sortOrder } : {}),
  };
}

export interface ReadResponse<T> {
  data?: T;
  error?: string;
}

async function call<T>(
  run: (campaignId: string) => Promise<ActionResult<T>>,
): Promise<ReadResponse<T>> {
  const campaignId = useEditorBootstrapStore.getState().campaignId;
  if (!campaignId) return { error: "The editor is still loading." };

  let result: ActionResult<T>;
  try {
    result = await run(campaignId);
  } catch (error) {
    // The RPC itself failed (offline, deploy mismatch, server crash).
    if (useEditorBootstrapStore.getState().campaignId !== campaignId) {
      return new Promise<never>(() => {});
    }
    return {
      error: error instanceof Error ? error.message : "Request failed.",
    };
  }

  if (useEditorBootstrapStore.getState().campaignId !== campaignId) {
    return new Promise<never>(() => {});
  }
  return result.success ? { data: result.data } : { error: result.error };
}

// ─── Assets ─────────────────────────────────────────────────────────────────

export const assetsReadApi = {
  fetchPage: (params: Parameters<typeof fetchAssetsPageAction>[1]) =>
    call((campaignId) => fetchAssetsPageAction(campaignId, params)),

  getByIds: (ids: string[]) =>
    call((campaignId) => getAssetsByIdsAction(campaignId, ids)),

  getFolders: () => call((campaignId) => getAssetFoldersAction(campaignId)),
};

// ─── Collections ────────────────────────────────────────────────────────────

export const collectionsReadApi = {
  /** The whole bootstrap again: collections, fields, first page of items. */
  refresh: () => call((campaignId) => refreshCollectionsAction(campaignId)),

  /** Fields of every collection in the funnel. */
  getAllFields: () =>
    call((campaignId) => getCollectionFieldsAction(campaignId, null)),

  getFields: (collectionId: string, search?: string) =>
    call((campaignId) =>
      getCollectionFieldsAction(campaignId, collectionId, search),
    ),

  getItems: (collectionId: string, options?: ItemsReadOptions) =>
    call((campaignId) =>
      getCollectionItemsAction(
        campaignId,
        collectionId,
        toActionOptions(options),
      ),
    ),

  searchItems: (
    collectionId: string,
    query: string,
    options?: Omit<ItemsReadOptions, "search">,
  ) =>
    call((campaignId) =>
      getCollectionItemsAction(campaignId, collectionId, {
        ...toActionOptions(options),
        search: query,
      }),
    ),

  getReferencedItemsBatch: (collectionIds: string[], limit = 100) =>
    call((campaignId) =>
      getReferencedItemsBatchAction(campaignId, collectionIds, limit),
    ),

  getItemById: (collectionId: string, itemId: string) =>
    call((campaignId) =>
      getCollectionItemByIdAction(campaignId, collectionId, itemId),
    ),

  getItemSlugs: (itemIds: string[]) =>
    call((campaignId) => getItemSlugsAction(campaignId, itemIds)),
};
