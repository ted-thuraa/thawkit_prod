// path: src/lib/editor/editor-asset-write-api.ts

import { deleteAssetAction } from "@/actions/editor/asset-actions";
import type { AssetUsage } from "@/lib/assets/delete-asset";
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
