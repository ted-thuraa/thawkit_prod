import { create } from "zustand";
import { collectionsWriteApi } from "@/lib/editor/editor-collection-write-api";
import { collectionsReadApi } from "@/lib/editor/editor-read-api";
import { sortCollectionsByOrder } from "@/lib/collection-utils";
import { MULTI_ASSET_COLLECTION_ID } from "@/lib/collection-field-utils";

import type {
  Collection,
  CollectionField,
  CollectionItemWithValues,
  CreateCollectionData,
  UpdateCollectionData,
  CreateCollectionFieldData,
  UpdateCollectionFieldData,
} from "@/types/funnel";
import type { CollectionsBootstrapData } from "@/lib/editor/bootstrap/types";
import { useAssetsStore } from "./useAssetsStore";
import { usePagesStore } from "./usePagesStore";

/**
 * Collections Store
 *
 * Manages state for Collections (CMS) feature using EAV architecture.
 * Handles collections, fields, and items with their values.
 */

interface ItemsQueryParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
  /** Set when the last query was a text search rather than a plain page load. */
  search?: string;
}

interface CollectionsState {
  collections: Collection[];
  fields: Record<string, CollectionField[]>; // keyed by collection_id (UUID)
  items: Record<string, CollectionItemWithValues[]>; // keyed by collection_id (UUID, current page only, UUID)
  itemsTotalCount: Record<string, number>; // keyed by collection_id (UUID) - total count for pagination
  lastItemsQuery: Record<string, ItemsQueryParams>; // keyed by collection_id — last loadItems params
  selectedCollectionId: string | null; // UUID
  cmsSection: "collections" | "globals";
  /**
   * Slugs of items referenced by link fields but not present in the currently
   * loaded `items` (e.g. cross-collection refs or items on a different page).
   * Keyed by item ID. `null` marks an item id we already tried to resolve and
   * found no slug for — prevents repeated fetch attempts.
   */
  crossCollectionSlugs: Record<string, string | null>;
  isLoading: boolean;
  error: string | null;
}

interface CollectionsActions {
  // Collections
  loadCollections: () => Promise<void>;
  /**
   * Atomically seed the store from the server bootstrap — collections,
   * fields, and the first page of items per collection — in ONE update with
   * no network. Replaces the `loadCollections` → `loadFields(null)` →
   * waterfall for the editor's initial load. `loadCollections` now refreshes
   * through the same server loader.
   */
  hydrateFromBootstrap: (data: CollectionsBootstrapData) => void;
  /** The bootstrap's collections section failed — surface it, show nothing stale. */
  setLoadError: (message: string) => void;
  setCmsSection: (val: "collections" | "globals") => void;
  /** Back to the empty state (campaign switch). */
  reset: () => void;
  createCollection: (data: CreateCollectionData) => Promise<Collection>;
  createSampleCollection: (sampleId: string) => Promise<Collection>;
  updateCollection: (id: string, data: UpdateCollectionData) => Promise<void>;
  deleteCollection: (id: string) => Promise<void>;
  reorderCollections: (collectionIds: string[]) => Promise<void>;
  setSelectedCollectionId: (id: string | null) => void;

  // Fields
  loadFields: (collectionId: string | null, search?: string) => Promise<void>;
  createField: (
    collectionId: string,
    data: Omit<CreateCollectionFieldData, "collection_id">,
  ) => Promise<CollectionField>;
  updateField: (
    collectionId: string,
    fieldId: string,
    data: UpdateCollectionFieldData,
  ) => Promise<void>;
  deleteField: (collectionId: string, fieldId: string) => Promise<void>;
  reorderFields: (collectionId: string, orderedIds: string[]) => Promise<void>;

  // Items
  loadItems: (
    collectionId: string,
    page?: number,
    limit?: number,
    sortBy?: string,
    sortOrder?: string,
  ) => Promise<void>;
  getDropdownItems: (
    collectionId: string,
  ) => Promise<Array<{ id: string; label: string }>>;
  searchAndMergeItems: (
    collectionId: string,
    query: string,
    limit?: number,
  ) => Promise<Array<{ id: string; label: string }>>;
  ensureItemLoaded: (collectionId: string, itemId: string) => Promise<void>;
  loadMissingItemSlugs: (itemIds: string[]) => Promise<void>;
  /** Server-confirmed. Rejects with the server's message (validation etc.). */
  createItem: (
    collectionId: string,
    values: Record<string, unknown>,
  ) => Promise<CollectionItemWithValues>;
  /** Server-confirmed. Resolves with the persisted item. */
  updateItem: (
    collectionId: string,
    itemId: string,
    values: Record<string, unknown>,
  ) => Promise<CollectionItemWithValues>;
  deleteItem: (collectionId: string, itemId: string) => Promise<void>;
  deleteItems: (collectionId: string, itemIds: string[]) => Promise<void>;
  duplicateItem: (
    collectionId: string,
    itemId: string,
  ) => Promise<CollectionItemWithValues | undefined>;
  searchItems: (
    collectionId: string,
    query: string,
    page?: number,
    limit?: number,
    sortBy?: string,
    sortOrder?: string,
  ) => Promise<void>;

  // Sorting
  updateCollectionSorting: (
    collectionId: string,
    sorting: { field: string; direction: "asc" | "desc" | "manual" },
  ) => Promise<void>;
  reorderItems: (
    collectionId: string,
    updates: Array<{ id: string; manual_order: number }>,
  ) => Promise<void>;

  // Utility
  reloadCurrentItems: () => Promise<void>;
  /** Re-run the last items query (page / sort / search) for one collection. */
  reloadItemsFor: (collectionId: string) => Promise<void>;
  clearError: () => void;
}

type CollectionsStore = CollectionsState & CollectionsActions;

/**
 * Monotonic request counter per collection for items queries. Page / search /
 * sort changes fire overlapping requests; without this a slow, older response
 * could land after a newer one and overwrite the table with stale rows.
 */
const itemsRequestSeq = new Map<string, number>();

/** Copy of `record` without `key`. */
function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

function nextItemsRequest(collectionId: string): number {
  const seq = (itemsRequestSeq.get(collectionId) ?? 0) + 1;
  itemsRequestSeq.set(collectionId, seq);
  return seq;
}

const emptyState: CollectionsState = {
  collections: [],
  fields: {},
  items: {},
  itemsTotalCount: {},
  lastItemsQuery: {},
  selectedCollectionId: null,
  crossCollectionSlugs: {},
  cmsSection: "collections",
  isLoading: false,
  error: null,
};

export const useCollectionsStore = create<CollectionsStore>((set, get) => ({
  // Initial state
  ...emptyState,

  // Collections
  hydrateFromBootstrap: (data) => {
    set({
      ...emptyState,
      collections: sortCollectionsByOrder(data.collections),
      fields: data.fields,
      items: data.items,
      itemsTotalCount: data.itemsTotalCount,
      lastItemsQuery: data.lastItemsQuery,
    });
  },

  setLoadError: (message) => {
    set({ ...emptyState, error: message });
  },
  setCmsSection: (val) => {
    // Only the section flag changes — collections, fields and items stay.
    set({ cmsSection: val });
  },

  reset: () => {
    itemsRequestSeq.clear();
    set(emptyState);
  },

  loadCollections: async () => {
    set({ isLoading: true, error: null });

    try {
      // One server round trip runs the same loader as the initial bootstrap
      // (collections + fields + first page of items), replacing the old
      // getAll → getAllFields → getTopItems client waterfall.
      const response = await collectionsReadApi.refresh();

      if (response.error || !response.data) {
        throw new Error(response.error || "Failed to load collections");
      }

      const data = response.data;
      set((state) => ({
        collections: sortCollectionsByOrder(data.collections),
        fields: data.fields,
        items: data.items,
        itemsTotalCount: data.itemsTotalCount,
        lastItemsQuery: data.lastItemsQuery,
        // A refresh must not drop the user's selection unless it no longer exists.
        selectedCollectionId: data.collections.some(
          (c) => c.id === state.selectedCollectionId,
        )
          ? state.selectedCollectionId
          : null,
        isLoading: false,
        error: null,
      }));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to load collections";
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  createCollection: async (data) => {
    set({ isLoading: true, error: null });

    try {
      // The server creates the collection AND its built-in fields in one
      // transaction and returns both — no client-side field fan-out.
      const response = await collectionsWriteApi.create(data.name);
      if (response.error || !response.data) {
        throw new Error(response.error || "Failed to create collection");
      }
      const { collection: created, fields } = response.data;

      set((state) => ({
        collections: sortCollectionsByOrder([...state.collections, created]),
        fields: { ...state.fields, [created.id]: fields },
        items: { ...state.items, [created.id]: [] },
        itemsTotalCount: { ...state.itemsTotalCount, [created.id]: 0 },
        isLoading: false,
      }));
      return created;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to create collection";
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  createSampleCollection: async (sampleId) => {
    set({ isLoading: true, error: null });

    try {
      const response = await collectionsWriteApi.createSample(sampleId);
      if (response.error || !response.data) {
        throw new Error(response.error || "Failed to create sample collection");
      }
      const { collection: created, fields, items } = response.data;

      set((state) => ({
        collections: sortCollectionsByOrder([...state.collections, created]),
        fields: { ...state.fields, [created.id]: fields },
        items: { ...state.items, [created.id]: items },
        itemsTotalCount: { ...state.itemsTotalCount, [created.id]: items.length },
        isLoading: false,
      }));
      return created;
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to create sample collection";
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  updateCollection: async (id, data) => {
    set({ isLoading: true, error: null });

    try {
      const response = await collectionsWriteApi.update(id, {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.sorting !== undefined ? { sorting: data.sorting } : {}),
      });
      if (response.error || !response.data) {
        throw new Error(response.error || "Failed to update collection");
      }
      const updated = response.data;

      set((state) => ({
        collections: sortCollectionsByOrder(
          state.collections.map((c) =>
            c.id === id
              ? { ...c, ...updated, has_published_version: c.has_published_version }
              : c,
          ),
        ),
        isLoading: false,
      }));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to update collection";
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  deleteCollection: async (id) => {
    set({ isLoading: true, error: null });

    try {
      // The server refuses (with a user-facing message) when the collection is
      // still referenced by a page, component or another collection's field.
      const response = await collectionsWriteApi.delete(id);
      if (response.error) throw new Error(response.error);

      set((state) => {
        return {
          collections: state.collections.filter((c) => c.id !== id),
          fields: omitKey(state.fields, id),
          items: omitKey(state.items, id),
          itemsTotalCount: omitKey(state.itemsTotalCount, id),
          lastItemsQuery: omitKey(state.lastItemsQuery, id),
          selectedCollectionId:
            state.selectedCollectionId === id ? null : state.selectedCollectionId,
          isLoading: false,
        };
      });

      // Reset CMS bindings that pointed at the deleted collection.
      usePagesStore.getState().cleanupDeletedCollection(id);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to delete collection";
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  reorderCollections: async (collectionIds: string[]) => {
    const previous = get().collections;
    // Optimistic: apply the new order immediately, roll back on failure.
    set((state) => {
      const byId = new Map(state.collections.map((c) => [c.id, c]));
      const reordered = collectionIds
        .map((id, index) => {
          const c = byId.get(id);
          return c ? { ...c, order: index } : null;
        })
        .filter((c): c is Collection => c !== null);
      return { collections: sortCollectionsByOrder(reordered), error: null };
    });

    const response = await collectionsWriteApi.reorder(collectionIds);
    if (response.error) {
      set({ collections: previous, error: response.error });
      throw new Error(response.error);
    }
  },


  setSelectedCollectionId: (id) => {
    set({ selectedCollectionId: id });
  },

  // Fields
  loadFields: async (collectionId: string | null, search?: string) => {
    // Skip virtual collections (multi-asset)
    if (collectionId === MULTI_ASSET_COLLECTION_ID) {
      return;
    }

    set({ isLoading: true, error: null });

    try {
      // If collectionId is null, load all fields for all collections in one query
      if (collectionId === null) {
        const response = await collectionsReadApi.getAllFields();

        if (response.error) {
          throw new Error(response.error);
        }

        // Group fields by collection_id
        const allFields = response.data || [];
        const fieldsMap: Record<string, CollectionField[]> = {};

        allFields.forEach((field) => {
          if (!fieldsMap[field.collection_id]) {
            fieldsMap[field.collection_id] = [];
          }
          fieldsMap[field.collection_id].push(field);
        });

        set((state) => ({
          fields: {
            ...state.fields,
            ...fieldsMap,
          },
          isLoading: false,
        }));
      } else {
        // Load fields for a specific collection
        const response = await collectionsReadApi.getFields(
          collectionId,
          search,
        );

        if (response.error) {
          throw new Error(response.error);
        }

        set((state) => ({
          fields: {
            ...state.fields,
            [collectionId]: response.data || [],
          },
          isLoading: false,
        }));
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to load fields";
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  createField: async (collectionId, data) => {
    set({ isLoading: true, error: null });

    try {
      const response = await collectionsWriteApi.createField(collectionId, {
        name: data.name,
        type: data.type,
        default: data.default ?? null,
        reference_collection_id: data.reference_collection_id ?? null,
        data: data.data,
      });
      if (response.error || !response.data) {
        throw new Error(response.error || "Failed to create field");
      }
      const newField = response.data;

      // The server inserts custom fields before the trailing built-ins and
      // shifts their order — reload this collection's fields to stay in step.
      const refreshed = await collectionsReadApi.getFields(collectionId);
      set((state) => ({
        fields: {
          ...state.fields,
          [collectionId]: refreshed.data ?? [
            ...(state.fields[collectionId] || []),
            newField,
          ],
        },
        isLoading: false,
      }));

      return newField;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to create field";
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  updateField: async (collectionId, fieldId, data) => {
    set({ isLoading: true, error: null });

    try {
      const response = await collectionsWriteApi.updateField(fieldId, {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.default !== undefined ? { default: data.default } : {}),
        ...(data.reference_collection_id !== undefined
          ? { reference_collection_id: data.reference_collection_id }
          : {}),
        ...(data.hidden !== undefined ? { hidden: data.hidden } : {}),
        ...(data.data !== undefined ? { data: data.data } : {}),
      });
      if (response.error || !response.data) {
        throw new Error(response.error || "Failed to update field");
      }
      const updated = response.data;

      set((state) => ({
        fields: {
          ...state.fields,
          [collectionId]: (state.fields[collectionId] || []).map((f) =>
            f.id === fieldId ? updated : f,
          ),
        },
        isLoading: false,
      }));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to update field";
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  deleteField: async (collectionId, fieldId) => {
    set({ isLoading: true, error: null });

    try {
      // The server refuses when the field is still bound on a page / component
      // or counted by another field, and falls the collection's sort back to
      // manual order when it was sorted by this field.
      const response = await collectionsWriteApi.deleteField(fieldId);
      if (response.error) throw new Error(response.error);

      set((state) => ({
        fields: {
          ...state.fields,
          [collectionId]: (state.fields[collectionId] || []).filter(
            (f) => f.id !== fieldId,
          ),
        },
        collections: state.collections.map((c) =>
          c.id === collectionId && c.sorting?.field === fieldId
            ? { ...c, sorting: null }
            : c,
        ),
        isLoading: false,
      }));

      // Reset CMS bindings referencing the deleted field across every page's layer tree
      usePagesStore.getState().cleanupDeletedField(fieldId);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to delete field";
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  reorderFields: async (collectionId, orderedIds) => {
    const previous = get().fields[collectionId] || [];
    set((state) => {
      const byId = new Map(previous.map((f) => [f.id, f]));
      const reordered = orderedIds
        .map((id, order) => {
          const f = byId.get(id);
          return f ? { ...f, order } : null;
        })
        .filter((f): f is CollectionField => f !== null);
      return { fields: { ...state.fields, [collectionId]: reordered }, error: null };
    });
    const response = await collectionsWriteApi.reorderFields(collectionId, orderedIds);
    if (response.error) {
      set((state) => ({
        fields: { ...state.fields, [collectionId]: previous },
        error: response.error,
      }));
      throw new Error(response.error);
    }
  },


  // Items
  loadItems: async (
    collectionId: string,
    page?: number,
    limit?: number,
    sortBy?: string,
    sortOrder?: string,
  ) => {
    // Skip virtual collections (multi-asset)
    if (collectionId === MULTI_ASSET_COLLECTION_ID) {
      return;
    }

    // Remember query params for reloadCurrentItems
    const seq = nextItemsRequest(collectionId);
    set((state) => ({
      isLoading: true,
      error: null,
      lastItemsQuery: {
        ...state.lastItemsQuery,
        [collectionId]: { page, limit, sortBy, sortOrder },
      },
    }));

    try {
      const response = await collectionsReadApi.getItems(collectionId, {
        page,
        limit,
        sortBy,
        sortOrder,
        includeAssets: true,
      });

      // A newer query for this collection superseded this one — drop it.
      if (itemsRequestSeq.get(collectionId) !== seq) return;

      if (response.error) {
        throw new Error(response.error);
      }

      if (response.data?.referencedAssets?.length) {
        useAssetsStore
          .getState()
          .addAssetsToCache(response.data.referencedAssets);
      }

      set((state) => ({
        items: {
          ...state.items,
          [collectionId]: response.data?.items || [],
        },
        itemsTotalCount: {
          ...state.itemsTotalCount,
          [collectionId]: response.data?.total || 0,
        },
        isLoading: false,
      }));
    } catch (error) {
      if (itemsRequestSeq.get(collectionId) !== seq) return;
      const errorMessage =
        error instanceof Error ? error.message : "Failed to load items";
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  createItem: async (collectionId, values) => {
    set({ error: null });

    // Server-confirmed (no optimistic row): validation (required name, unique
    // slug, reference integrity) lives on the server, and the caller keeps the
    // form open on failure so the user's input is never lost.
    const response = await collectionsWriteApi.createItem(collectionId, values);
    if (response.error || !response.data) {
      const message = response.error || "Failed to create item";
      set({ error: message });
      throw new Error(message);
    }
    const created = response.data;

    set((state) => ({
      itemsTotalCount: {
        ...state.itemsTotalCount,
        [collectionId]: (state.itemsTotalCount[collectionId] || 0) + 1,
      },
    }));
    // Re-run the table's current query so the new row lands where the active
    // sort / page / search says it belongs.
    await get().reloadItemsFor(collectionId);
    return created;
  },

  updateItem: async (collectionId, itemId, values) => {
    set({ error: null });

    const response = await collectionsWriteApi.updateItem(
      collectionId,
      itemId,
      values,
    );
    if (response.error || !response.data) {
      const message = response.error || "Failed to save item";
      set({ error: message });
      throw new Error(message);
    }
    const updated = response.data;

    set((state) => ({
      items: {
        ...state.items,
        [collectionId]: (state.items[collectionId] || []).map((item) =>
          item.id === itemId ? updated : item,
        ),
      },
    }));
    return updated;
  },

  deleteItem: async (collectionId, itemId) => {
    await get().deleteItems(collectionId, [itemId]);
  },

  deleteItems: async (collectionId, itemIds) => {
    set({ error: null });

    const response = await collectionsWriteApi.deleteItems(collectionId, itemIds);
    if (response.error) {
      set({ error: response.error });
      throw new Error(response.error);
    }

    const gone = new Set(itemIds);
    set((state) => ({
      items: {
        ...state.items,
        [collectionId]: (state.items[collectionId] || []).filter(
          (item) => !gone.has(item.id),
        ),
      },
      itemsTotalCount: {
        ...state.itemsTotalCount,
        [collectionId]: Math.max(
          0,
          (state.itemsTotalCount[collectionId] || 0) - (response.data?.deleted ?? 0),
        ),
      },
    }));
  },

  duplicateItem: async (collectionId, itemId) => {
    set({ error: null });

    const response = await collectionsWriteApi.duplicateItem(collectionId, itemId);
    if (response.error || !response.data) {
      const message = response.error || "Failed to duplicate item";
      set({ error: message });
      throw new Error(message);
    }
    const copy = response.data;

    set((state) => ({
      itemsTotalCount: {
        ...state.itemsTotalCount,
        [collectionId]: (state.itemsTotalCount[collectionId] || 0) + 1,
      },
    }));
    await get().reloadItemsFor(collectionId);
    return copy;
  },


  searchItems: async (
    collectionId: string,
    query: string,
    page?: number,
    limit?: number,
    sortBy?: string,
    sortOrder?: string,
  ) => {
    const seq = nextItemsRequest(collectionId);
    set((state) => ({
      isLoading: true,
      error: null,
      lastItemsQuery: {
        ...state.lastItemsQuery,
        [collectionId]: { page, limit, sortBy, sortOrder, search: query },
      },
    }));

    try {
      const response = await collectionsReadApi.searchItems(
        collectionId,
        query,
        {
          page,
          limit,
          sortBy,
          sortOrder,
          includeAssets: true,
        },
      );

      if (itemsRequestSeq.get(collectionId) !== seq) return;

      if (response.error) {
        throw new Error(response.error);
      }

      if (response.data?.referencedAssets?.length) {
        useAssetsStore
          .getState()
          .addAssetsToCache(response.data.referencedAssets);
      }

      set((state) => ({
        items: {
          ...state.items,
          [collectionId]: response.data?.items || [],
        },
        itemsTotalCount: {
          ...state.itemsTotalCount,
          [collectionId]: response.data?.total || 0,
        },
        isLoading: false,
      }));
    } catch (error) {
      if (itemsRequestSeq.get(collectionId) !== seq) return;
      const errorMessage =
        error instanceof Error ? error.message : "Failed to search items";
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  // Sorting
  updateCollectionSorting: async (
    collectionId: string,
    sorting: { field: string; direction: "asc" | "desc" | "manual" },
  ) => {
    set({ isLoading: true, error: null });

    try {
      // Optimistically update the collection sorting
      set((state) => {
        const updatedCollections = state.collections.map((c) =>
          c.id === collectionId ? { ...c, sorting } : c,
        );
        const sortedCollections = sortCollectionsByOrder(updatedCollections);
        return {
          collections: sortedCollections,
        };
      });
      const response = await collectionsWriteApi.update(collectionId, { sorting });

      if (response.error) {
        throw new Error(response.error);
      }

      set({ isLoading: false });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to update sorting";
      set({ error: errorMessage, isLoading: false });
      // Reload to revert optimistic update
      await get().loadCollections();
      throw error;
    }
  },

  reorderItems: async (
    collectionId: string,
    updates: Array<{ id: string; manual_order: number }>,
  ) => {
    set({ isLoading: true, error: null });

    try {
      // Optimistically update items order and sort by new manual_order
      set((state) => {
        const items = state.items[collectionId] || [];
        const updateMap = new Map(updates.map((u) => [u.id, u.manual_order]));

        const updatedItems = items
          .map((item) => {
            const newOrder = updateMap.get(item.id);
            return newOrder !== undefined
              ? { ...item, manual_order: newOrder }
              : item;
          })
          .sort((a, b) => a.manual_order - b.manual_order);

        return {
          items: {
            ...state.items,
            [collectionId]: updatedItems,
          },
        };
      });

      const response = await collectionsWriteApi.reorderItems(collectionId, updates);

      if (response.error) {
        throw new Error(response.error);
      }

      set({ isLoading: false });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to reorder items";
      set({ error: errorMessage, isLoading: false });
      // Reload to revert optimistic update
      await get().loadItems(collectionId);
      throw error;
    }
  },

  // Utility
  reloadCurrentItems: async () => {
    const { selectedCollectionId } = get();
    if (!selectedCollectionId) return;
    await get().reloadItemsFor(selectedCollectionId);
  },

  reloadItemsFor: async (collectionId) => {
    const q = get().lastItemsQuery[collectionId] || {};
    if (q.search) {
      await get().searchItems(
        collectionId,
        q.search,
        q.page,
        q.limit,
        q.sortBy,
        q.sortOrder,
      );
    } else {
      await get().loadItems(collectionId, q.page, q.limit, q.sortBy, q.sortOrder);
    }
  },

  clearError: () => {
    set({ error: null });
  },

  getDropdownItems: async (collectionId: string) => {
    try {
      const state = get();
      const collectionFields = state.fields[collectionId] || [];
      const items = state.items[collectionId] || [];

      const nameField = collectionFields.find((field) => field.key === "name");
      if (!nameField) {
        console.warn(
          `Name field not found for collection ${collectionId}. Available fields:`,
          collectionFields.map((f) => ({ id: f.id, key: f.key, name: f.name })),
        );
      }

      return items.map((item) => ({
        id: item.id,
        label: getCollectionItemLabel(item, collectionFields),
      }));
    } catch (error) {
      console.error("Failed to get dropdown items:", error);
      return [];
    }
  },

  searchAndMergeItems: async (
    collectionId: string,
    query: string,
    limit = 50,
  ) => {
    try {
      const response = await collectionsReadApi.getItems(collectionId, {
        search: query,
        limit,
        includeAssets: true,
      });

      if (response.error) throw new Error(response.error);

      const fetched = response.data?.items || [];

      if (response.data?.referencedAssets?.length) {
        useAssetsStore
          .getState()
          .addAssetsToCache(response.data.referencedAssets);
      }

      // Merge fetched items into the store (dedupe by id) so the canvas can
      // resolve them for slug/preview rendering when the user picks an item
      // that wasn't part of the initial preload.
      set((state) => {
        const existing = state.items[collectionId] || [];
        const existingIds = new Set(existing.map((item) => item.id));
        const newItems = fetched.filter((item) => !existingIds.has(item.id));
        if (newItems.length === 0) return state;
        return {
          items: {
            ...state.items,
            [collectionId]: [...existing, ...newItems],
          },
        };
      });

      const fields = get().fields[collectionId] || [];
      return fetched.map((item) => ({
        id: item.id,
        label: getCollectionItemLabel(item, fields),
      }));
    } catch (error) {
      console.error("Failed to search collection items:", error);
      return [];
    }
  },

  ensureItemLoaded: async (collectionId: string, itemId: string) => {
    if (!collectionId || !itemId) return;
    const existing = get().items[collectionId] || [];
    if (existing.some((item) => item.id === itemId)) return;

    try {
      const response = await collectionsReadApi.getItemById(
        collectionId,
        itemId,
      );
      if (response.error || !response.data) return;
      const item = response.data;

      set((state) => {
        const current = state.items[collectionId] || [];
        if (current.some((i) => i.id === item.id)) return state;
        return {
          items: {
            ...state.items,
            [collectionId]: [...current, item],
          },
        };
      });
    } catch (error) {
      console.error("Failed to hydrate collection item:", error);
    }
  },

  loadMissingItemSlugs: async (itemIds: string[]) => {
    if (itemIds.length === 0) return;

    const { crossCollectionSlugs } = get();
    const idsToFetch = itemIds.filter((id) => !(id in crossCollectionSlugs));
    if (idsToFetch.length === 0) return;

    try {
      const response = await collectionsReadApi.getItemSlugs(idsToFetch);
      if (response.error || !response.data) return;

      const fetchedSlugs = response.data.slugs;
      set((state) => {
        const next: Record<string, string | null> = {
          ...state.crossCollectionSlugs,
        };
        // Mark every requested id so we never re-fetch — items without a slug
        // are recorded as null instead of being omitted from the cache.
        for (const id of idsToFetch) {
          next[id] = fetchedSlugs[id] ?? null;
        }
        return { crossCollectionSlugs: next };
      });
    } catch (error) {
      console.error("Failed to load missing item slugs:", error);
    }
  },
}));

/**
 * Resolve a human-readable label for a collection item using the `name` field
 * when present, falling back to a short id-based placeholder.
 */
function getCollectionItemLabel(
  item: CollectionItemWithValues,
  fields: CollectionField[],
): string {
  const nameField = fields.find((field) => field.key === "name");
  if (nameField) {
    const nameValue = item.values?.[nameField.id];
    if (
      nameValue !== null &&
      nameValue !== undefined &&
      String(nameValue).trim() !== ""
    ) {
      return String(nameValue);
    }
  }
  return `Item ${item.id.slice(0, 8)}`;
}
