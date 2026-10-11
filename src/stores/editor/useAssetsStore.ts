/**
 * Assets Store
 *
 * Global store for managing assets (images, files) with caching
 */

import { create } from "zustand";
import { getEditorImageUrl } from "@/lib/asset-utils";
import { isUuid } from "@/lib/editor/bootstrap/collect-asset-ids";
import { assetsReadApi } from "@/lib/editor/editor-read-api";
import { useEditorBootstrapStore } from "./useEditorBootstrapStore";
import type { Asset, AssetFolder } from "@/types/funnel";

/**
 * Rewrite bitmap image `public_url`s to the proxy URL with a `?width=` cap
 * so the canvas iframe doesn't decode multi-hundred-megabyte bitmaps. SVGs,
 * videos, documents, and any asset without a storage_path pass through.
 */
function normalizeAssetForEditor(asset: Asset): Asset {
  const rewritten = getEditorImageUrl(asset);
  if (rewritten === asset.public_url) return asset;
  return { ...asset, public_url: rewritten };
}

interface AssetsState {
  assets: Asset[];
  assetsById: Record<string, Asset>;
  folders: AssetFolder[];
  isLoading: boolean;
  isLoaded: boolean;
  error: string | null;
}

export interface FetchAssetsParams {
  folderId?: string | null;
  folderIds?: string[];
  search?: string;
  page?: number;
  limit?: number;
}

export interface FetchAssetsResult {
  assets: Asset[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

interface AssetsActions {
  loadAssets: () => Promise<void>;
  fetchAssets: (params: FetchAssetsParams) => Promise<FetchAssetsResult>;
  setAssets: (assets: Asset[]) => void;
  setFolders: (folders: AssetFolder[]) => void;
  /**
   * Atomically seed the store from the server bootstrap (one store update,
   * one subscriber notification). `assets` is a SUBSET of the library — the
   * referenced assets plus the first library page — not the whole library.
   */
  hydrateFromBootstrap: (data: {
    assets: Asset[];
    folders: AssetFolder[];
  }) => void;
  /**
   * The bootstrap's assets section failed. Leaves the store empty and marked
   * loaded-with-error; individual assets can still be looked up on demand
   * (`getAsset`, `fetchAssets`), which may succeed where the bootstrap didn't.
   */
  setLoadError: (message: string) => void;
  getAsset: (id: string) => Asset | null;
  addAsset: (asset: Asset) => void;
  addAssetsToCache: (assets: Asset[]) => void;
  updateAsset: (assetId: string, updates: Partial<Asset>) => void;
  removeAsset: (id: string) => void;
  addFolder: (folder: AssetFolder) => void;
  updateFolder: (folderId: string, updates: Partial<AssetFolder>) => void;
  deleteFolder: (folderId: string) => Promise<string[]>;
  batchReorderFolders: (updatedFolders: AssetFolder[]) => Promise<void>;
  reset: () => void;
}

type AssetsStore = AssetsState & AssetsActions;

const initialState: AssetsState = {
  assets: [],
  assetsById: {},
  folders: [],
  isLoading: false,
  isLoaded: false,
  error: null,
};

/**
 * On-demand asset lookup (the `getAsset` cache-miss path).
 *
 * `getAsset` is called synchronously during render — often for dozens of
 * layers at once — so a miss must NOT fire its own request. Misses are
 * queued and flushed as ONE batched Server Action call per tick.
 *
 * `pendingFetches` doubles as in-flight tracking and a NEGATIVE cache: an id
 * the server did not return (deleted, another organization's, never
 * existed) stays in the set so it is not requested again on every render.
 * After a transport/server failure the ids are released again following a
 * cool-down, so a transient outage doesn't blacklist assets forever but
 * a down server isn't hammered once per render either.
 */
const pendingFetches = new Set<string>();
let queuedLookups = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const LOOKUP_FLUSH_DELAY_MS = 20;
const LOOKUP_BATCH_SIZE = 100; // the action accepts at most 200 ids
const LOOKUP_RETRY_AFTER_MS = 30_000;

function scheduleLookupFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushAssetLookups();
  }, LOOKUP_FLUSH_DELAY_MS);
}

async function flushAssetLookups(): Promise<void> {
  const ids = [...queuedLookups];
  queuedLookups = new Set();

  for (let i = 0; i < ids.length; i += LOOKUP_BATCH_SIZE) {
    const batch = ids.slice(i, i + LOOKUP_BATCH_SIZE);
    const response = await assetsReadApi.getByIds(batch);

    if (response.error || !response.data) {
      setTimeout(() => {
        batch.forEach((id) => pendingFetches.delete(id));
      }, LOOKUP_RETRY_AFTER_MS);
      continue;
    }

    // Found ids leave the negative cache (they live in `assetsById` now);
    // ids the server didn't return stay in it.
    response.data.forEach((asset) => pendingFetches.delete(asset.id));
    useAssetsStore.getState().addAssetsToCache(response.data);
  }
}

export const useAssetsStore = create<AssetsStore>((set, get) => ({
  ...initialState,

  /**
   * Set assets directly (used during initial load)
   */
  setAssets: (assets: Asset[]) => {
    const normalized = assets.map(normalizeAssetForEditor);
    const assetsById: Record<string, Asset> = {};
    normalized.forEach((asset) => {
      assetsById[asset.id] = asset;
    });

    set({
      assets: normalized,
      assetsById,
      isLoaded: true,
    });
  },

  hydrateFromBootstrap: ({ assets, folders }) => {
    const normalized = assets.map(normalizeAssetForEditor);
    const assetsById: Record<string, Asset> = {};
    normalized.forEach((asset) => {
      assetsById[asset.id] = asset;
    });

    set({
      assets: normalized,
      assetsById,
      folders,
      isLoading: false,
      isLoaded: true,
      error: null,
    });
  },

  setLoadError: (message: string) => {
    set({ ...initialState, isLoaded: true, error: message });
  },

  /**
   * Set asset folders directly (used during initial load)
   */
  setFolders: (folders: AssetFolder[]) => {
    set({ folders });
  },

  /**
   * Load folders (assets are loaded on-demand via fetchAssets). The editor
   * seeds folders from the server bootstrap, so this only runs for callers
   * that need a fresh copy before hydration has finished.
   */
  loadAssets: async () => {
    // Don't reload if already loaded or currently loading
    if (get().isLoaded || get().isLoading) {
      return;
    }

    set({ isLoading: true, error: null });

    const response = await assetsReadApi.getFolders();

    if (response.error || !response.data) {
      set({
        isLoading: false,
        error: response.error ?? "Failed to load assets",
      });
      return;
    }

    set({
      folders: response.data,
      isLoading: false,
      isLoaded: true,
      error: null,
    });
  },

  /**
   * Fetch assets with pagination and search support
   * Results are also added to the global cache for quick lookups
   */
  fetchAssets: async (
    params: FetchAssetsParams,
  ): Promise<FetchAssetsResult> => {
    const { folderId, folderIds, search, page = 1, limit = 50 } = params;

    const response = await assetsReadApi.fetchPage({
      ...(folderIds && folderIds.length > 0
        ? { folderIds }
        : folderId !== undefined
          ? { folderId }
          : {}),
      ...(search ? { search } : {}),
      page,
      limit,
    });

    if (response.error || !response.data) {
      throw new Error(response.error ?? "Failed to fetch assets");
    }

    const result = response.data;
    const normalizedAssets: Asset[] = result.assets.map(
      normalizeAssetForEditor,
    );

    // Add fetched assets to the global cache
    if (normalizedAssets.length > 0) {
      const state = get();
      const newAssetsById = { ...state.assetsById };

      normalizedAssets.forEach((asset: Asset) => {
        newAssetsById[asset.id] = asset;
      });

      set({ assetsById: newAssetsById });
    }

    return {
      assets: normalizedAssets,
      total: result.total,
      page: result.page,
      limit: result.limit,
      hasMore: result.hasMore,
    };
  },

  /**
   * Add multiple assets to the cache (without affecting the assets array)
   */
  addAssetsToCache: (assets: Asset[]) => {
    set((state) => {
      const newAssetsById = { ...state.assetsById };
      assets.forEach((asset) => {
        newAssetsById[asset.id] = normalizeAssetForEditor(asset);
      });
      return { assetsById: newAssetsById };
    });
  },

  /**
   * Get asset by ID. Returns the cached asset, or `null` on a miss — and a
   * miss queues a background lookup (batched, de-duplicated, negative-cached;
   * see the notes above `pendingFetches`). The asset appears in `assetsById`
   * when the lookup lands, which re-renders subscribers.
   *
   * The store holds only a SUBSET of the library (referenced assets + the
   * first page, from the bootstrap), so a miss does NOT mean "doesn't exist".
   */
  getAsset: (id: string) => {
    const cached = get().assetsById[id];
    if (cached) {
      return cached;
    }

    // Server rendering: nothing to fetch, and no campaign to authorize against.
    if (typeof window === "undefined") {
      return null;
    }

    // Layers can hold values that merely look like asset ids (external URLs,
    // legacy ids). Only real UUIDs can name an asset.
    if (!isUuid(id)) {
      return null;
    }

    // Not hydrated yet (or mid campaign switch): nothing to authorize against.
    if (!useEditorBootstrapStore.getState().campaignId) {
      return null;
    }

    if (pendingFetches.has(id)) {
      return null;
    }

    pendingFetches.add(id);
    queuedLookups.add(id);
    scheduleLookupFlush();

    return null;
  },

  /**
   * Add new asset to store (after upload)
   */
  addAsset: (asset: Asset) => {
    const normalized = normalizeAssetForEditor(asset);
    set((state) => ({
      assets: [normalized, ...state.assets],
      assetsById: {
        ...state.assetsById,
        [normalized.id]: normalized,
      },
    }));
  },

  /**
   * Update asset in store
   */
  updateAsset: (assetId: string, updates: Partial<Asset>) => {
    set((state) => {
      const merged = { ...state.assetsById[assetId], ...updates } as Asset;
      const updatedAsset = normalizeAssetForEditor(merged);
      return {
        assets: state.assets.map((a) => (a.id === assetId ? updatedAsset : a)),
        assetsById: {
          ...state.assetsById,
          [assetId]: updatedAsset,
        },
      };
    });
  },

  /**
   * Remove asset from store (after delete)
   */
  removeAsset: (id: string) => {
    set((state) => {
      const { [id]: removed, ...restAssetsById } = state.assetsById;

      return {
        assets: state.assets.filter((a) => a.id !== id),
        assetsById: restAssetsById,
      };
    });
  },

  /**
   * Add folder to store
   */
  addFolder: (folder: AssetFolder) => {
    set((state) => {
      // Idempotent: skip if a folder with this id already exists so the list can
      // never hold a duplicate id (which crashes keyed tree/list renders). Guards
      // against double-invokes (React StrictMode, rapid retries) and any future
      // realtime create path that could deliver the same folder more than once.
      if (state.folders.some((existing) => existing.id === folder.id))
        return state;
      return { folders: [...state.folders, folder] };
    });
  },

  /**
   * Update folder in store
   */
  updateFolder: (folderId: string, updates: Partial<AssetFolder>) => {
    set((state) => ({
      folders: state.folders.map((f) =>
        f.id === folderId ? { ...f, ...updates } : f,
      ),
    }));
  },

  /**
   * Delete folder and all its descendants recursively
   * Returns array of all deleted folder IDs
   */
  deleteFolder: async (folderId: string): Promise<string[]> => {
    const state = get();

    // Helper to get all descendant folder IDs recursively
    const getDescendantFolderIds = (parentId: string): string[] => {
      const children = state.folders.filter(
        (f) => f.asset_folder_id === parentId,
      );
      const descendants: string[] = children.map((c) => c.id);

      for (const child of children) {
        descendants.push(...getDescendantFolderIds(child.id));
      }

      return descendants;
    };

    // Get all folders that will be deleted
    const descendantIds = getDescendantFolderIds(folderId);
    const allFolderIdsToDelete = [folderId, ...descendantIds];

    // Call API to delete folder (backend handles cascading deletion)
    const response = await fetch(`/ycode/api/asset-folders/${folderId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error("Failed to delete folder");
    }

    // Update state: remove deleted folders
    set((state) => ({
      folders: state.folders.filter(
        (f) => !allFolderIdsToDelete.includes(f.id),
      ),
    }));

    // Update state: remove assets that were in deleted folders
    set((state) => {
      const remainingAssets = state.assets.filter((asset) => {
        // Keep assets that are not in any of the deleted folders
        return (
          !asset.asset_folder_id ||
          !allFolderIdsToDelete.includes(asset.asset_folder_id)
        );
      });

      // Rebuild assetsById
      const assetsById: Record<string, Asset> = {};
      remainingAssets.forEach((asset) => {
        assetsById[asset.id] = asset;
      });

      return {
        assets: remainingAssets,
        assetsById,
      };
    });

    return allFolderIdsToDelete;
  },

  /**
   * Batch reorder folders after drag and drop
   * Optimistically updates UI then syncs with backend
   */
  batchReorderFolders: async (updatedFolders: AssetFolder[]) => {
    const { folders } = get();

    // Store original state for rollback
    const originalFolders = folders;

    try {
      // Optimistically update the UI
      set({
        folders: updatedFolders,
        isLoading: true,
      });

      // Batch update folders
      const updatePromises = updatedFolders.map(async (folder) => {
        const originalFolder = originalFolders.find((f) => f.id === folder.id);
        if (!originalFolder) return;

        // Only update if something changed
        if (
          originalFolder.asset_folder_id !== folder.asset_folder_id ||
          originalFolder.order !== folder.order ||
          originalFolder.depth !== folder.depth
        ) {
          const response = await fetch(
            `/ycode/api/asset-folders/${folder.id}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                asset_folder_id: folder.asset_folder_id,
                order: folder.order,
                depth: folder.depth,
              }),
            },
          );

          if (!response.ok) {
            throw new Error(`Failed to update folder ${folder.id}`);
          }
        }
      });

      // Wait for all updates to complete
      await Promise.all(updatePromises);

      set({ isLoading: false });
    } catch (error) {
      console.error("Failed to reorder folders:", error);

      // Rollback to original state on error
      set({
        folders: originalFolders,
        isLoading: false,
        error:
          error instanceof Error ? error.message : "Failed to reorder folders",
      });

      throw error;
    }
  },

  /**
   * Reset store to initial state
   */
  reset: () => {
    // The in-flight set is module-level, not store state — clear it too, or
    // a fetch started for the previous campaign blocks the same id here.
    pendingFetches.clear();
    queuedLookups = new Set();
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    set(initialState);
  },
}));
