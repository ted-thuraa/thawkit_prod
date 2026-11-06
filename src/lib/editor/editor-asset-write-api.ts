// path: src/lib/editor/editor-asset-write-api.ts

import {
  bulkDeleteAssetsAction,
  createFolderAction,
  createSvgAssetAction,
  deleteAssetAction,
  deleteFolderAction,
  getAssetFolderCountsAction,
  getAssetUsageAction,
  moveAssetsAction,
  updateAssetAction,
  updateFolderAction,
} from "@/actions/editor/asset-actions";
import type { AssetUsageSummary } from "@/lib/assets/asset-usage-summary";
import type { AssetUsage } from "@/lib/assets/delete-asset";
import type { BulkDeleteOutcome, FolderUpdateResult } from "@/lib/assets/library-service";
import type { Asset, AssetFolder } from "@/types/funnel";
import { useEditorBootstrapStore } from "@/stores/editor/useEditorBootstrapStore";

/**
 * Client adapter for the asset WRITE actions (the read adapter lives in
 * `editor-read-api.ts`). Takes the campaign from the bootstrap store, like the
 * read adapter, so callers never pass tenant identifiers around.
 */

export type DeleteAssetResponse =
  | { ok: true }
  | {
      ok: false;
      error: string;
      /** The asset still exists because something references it. */
      inUse: boolean;
      usages?: AssetUsage[];
    };

export const assetsWriteApi = {
  async delete(assetId: string): Promise<DeleteAssetResponse> {
    const campaignId = useEditorBootstrapStore.getState().campaignId;
    if (!campaignId) {
      return { ok: false, error: "The editor is still loading.", inUse: false };
    }
    try {
      const result = await deleteAssetAction(campaignId, assetId);
      if (result.success) return { ok: true };
      return {
        ok: false,
        error: result.error,
        inUse: result.code === "IN_USE",
        usages: result.usages,
      };
    } catch (error) {
      // The RPC itself failed (offline, deploy mismatch, server crash).
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Request failed.",
        inUse: false,
      };
    }
  },
};


// ─── Library management (folders, SVG icons, edits, bulk) ───────────────────

/** `{data}` on success, `{error}` on any failure (server refusal, validation, network). */
export type ApiResult<T> = { data: T; error?: undefined } | { data?: undefined; error: string };

async function call<T>(
  run: (campaignId: string) => Promise<{ success: true; data: T } | { success: false; error: string }>,
): Promise<ApiResult<T>> {
  const campaignId = useEditorBootstrapStore.getState().campaignId;
  if (!campaignId) return { error: "The editor is still loading." };
  try {
    const result = await run(campaignId);
    return result.success ? { data: result.data } : { error: result.error };
  } catch (error) {
    // The RPC itself failed (offline, deploy mismatch, server crash).
    return { error: error instanceof Error ? error.message : "Request failed." };
  }
}

export const assetFoldersApi = {
  create: (input: { name: string; parentId: string | null }): Promise<ApiResult<AssetFolder>> =>
    call((id) => createFolderAction(id, input)),

  update: (
    folderId: string,
    patch: { name?: string; parentId?: string | null },
  ): Promise<ApiResult<FolderUpdateResult>> => call((id) => updateFolderAction(id, folderId, patch)),

  /** `inUse` = nothing was deleted because a contained file is still referenced. */
  async delete(
    folderId: string,
  ): Promise<ApiResult<{ folderIds: string[]; assetIds: string[] }> & { inUse?: boolean }> {
    const campaignId = useEditorBootstrapStore.getState().campaignId;
    if (!campaignId) return { error: "The editor is still loading." };
    try {
      const result = await deleteFolderAction(campaignId, folderId);
      if (result.success) return { data: result.data };
      return { error: result.error, inUse: result.code === "IN_USE" };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Request failed." };
    }
  },
};

export const assetsApi = {
  createSvg: (input: {
    name: string;
    folderId: string | null;
    content: string;
  }): Promise<ApiResult<Asset>> => call((id) => createSvgAssetAction(id, input)),

  update: (
    assetId: string,
    patch: { filename?: string; folderId?: string | null; content?: string },
  ): Promise<ApiResult<Asset>> => call((id) => updateAssetAction(id, assetId, patch)),

  move: (assetIds: string[], folderId: string | null): Promise<ApiResult<{ movedIds: string[] }>> =>
    call((id) => moveAssetsAction(id, assetIds, folderId)),

  bulkDelete: (assetIds: string[]): Promise<ApiResult<BulkDeleteOutcome>> =>
    call((id) => bulkDeleteAssetsAction(id, assetIds)),

  getFolderCounts: (): Promise<ApiResult<Record<string, number>>> =>
    call((id) => getAssetFolderCountsAction(id)),

  getUsage: (assetId: string): Promise<ApiResult<AssetUsageSummary>> =>
    call((id) => getAssetUsageAction(id, assetId)),
};
