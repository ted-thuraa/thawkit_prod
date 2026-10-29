"use server";

// path: src/actions/editor/asset-actions.ts

import { z } from "zod";
import {
  AssetDeleteError,
  deleteAsset,
  describeUsages,
  type AssetUsage,
} from "@/lib/assets/delete-asset";
import { deleteAssetDeps } from "@/lib/assets/delete-asset-deps";
import { toErrorResult } from "@/lib/editor/read/action-result";
import { requireCampaignScope } from "@/lib/editor/read/guards";
import { logger } from "@/lib/logger";

/**
 * Asset WRITE server actions (the read actions live in
 * `editor-read-actions.ts`). Same contract as those: authorize FIRST
 * (tenant derived from the campaign, never from the client), validate the
 * payload with zod (an action is a public endpoint), return `{success}`
 * results instead of throwing across the network boundary.
 *
 * Upload is NOT here: files go browser → UploadThing directly and are
 * persisted by the router's `onUploadComplete` (`app/api/uploadthing`).
 */

const idSchema = z.string().min(1).max(100);

export type DeleteAssetResult =
  | { success: true; data: { assetId: string } }
  | {
      success: false;
      error: string;
      /** Set when the asset was NOT deleted because something still references it. */
      code?: "IN_USE";
      usages?: AssetUsage[];
    };

/**
 * Deletes a library asset: refuses while referenced, otherwise removes the
 * UploadThing object and then the library record. See `deleteAsset` for the
 * lifecycle and failure semantics. Never reports success unless both
 * the stored object and the record are gone.
 */
export async function deleteAssetAction(
  campaignId: string,
  assetId: string,
): Promise<DeleteAssetResult> {
  try {
    const scope = await requireCampaignScope(idSchema.parse(campaignId));
    const id = idSchema.parse(assetId);

    const outcome = await deleteAsset(scope.organizationId, id, deleteAssetDeps);

    if (outcome.status === "in_use") {
      return {
        success: false,
        code: "IN_USE",
        error: `This file is still used by ${describeUsages(outcome.usages)}. Remove it there first, then delete it from the library.`,
        usages: outcome.usages,
      };
    }
    return { success: true, data: { assetId: outcome.assetId } };
  } catch (error) {
    if (error instanceof AssetDeleteError) {
      logger.error("Asset deletion failed", { stage: error.stage, error });
      return { success: false, error: error.message };
    }
    return toErrorResult(error, "Failed to delete the asset.");
  }
}
