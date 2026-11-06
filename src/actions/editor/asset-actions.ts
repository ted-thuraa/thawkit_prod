"use server";

// path: src/actions/editor/asset-actions.ts

import { z } from "zod";
import { countDraftAssetsByFolder, getDraftAsset } from "@/lib/assets/asset-repository";
import {
  summarizeUsages,
  type AssetUsageSummary,
} from "@/lib/assets/asset-usage-summary";
import { findAssetUsages } from "@/lib/assets/asset-usage";
import {
  AssetDeleteError,
  deleteAsset,
  describeUsages,
  type AssetUsage,
} from "@/lib/assets/delete-asset";
import { deleteAssetDeps } from "@/lib/assets/delete-asset-deps";
import {
  bulkDeleteAssets,
  createFolder,
  createSvgAsset,
  deleteFolder,
  moveAssets,
  updateAssetDetails,
  updateFolder,
  type BulkDeleteOutcome,
  type FolderUpdateResult,
} from "@/lib/assets/library-service";
import { NotFoundError } from "@/lib/errors";
import type { ActionResult } from "@/lib/editor/read/types";
import type { Asset, AssetFolder } from "@/types/funnel";
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


// ─── Media-library management ───────────────────────────────────────────────
//
// Folders, custom-SVG assets, edits and bulk operations used by the File
// Manager. All of them: authorize via the campaign FIRST (tenant derived
// server-side), validate input with zod, and return structured results.

const uuidSchema = z.string().uuid();
const folderIdSchema = uuidSchema.nullable();

/** Creates a regular folder. `parentId: null` = directly under the virtual "All files" root. */
export async function createFolderAction(
  campaignId: string,
  input: { name: string; parentId: string | null },
): Promise<ActionResult<AssetFolder>> {
  try {
    const scope = await requireCampaignScope(idSchema.parse(campaignId));
    const parsed = z
      .object({ name: z.string().max(500), parentId: folderIdSchema })
      .parse(input);
    return { success: true, data: await createFolder(scope.organizationId, parsed) };
  } catch (error) {
    return toErrorResult(error, "Failed to create the folder.");
  }
}

/** Renames and/or moves a folder; returns the new stored depths of the affected branch. */
export async function updateFolderAction(
  campaignId: string,
  folderId: string,
  patch: { name?: string; parentId?: string | null },
): Promise<ActionResult<FolderUpdateResult>> {
  try {
    const scope = await requireCampaignScope(idSchema.parse(campaignId));
    const id = uuidSchema.parse(folderId);
    const parsed = z
      .object({ name: z.string().max(500).optional(), parentId: folderIdSchema.optional() })
      .parse(patch);
    return { success: true, data: await updateFolder(scope.organizationId, id, parsed) };
  } catch (error) {
    return toErrorResult(error, "Failed to update the folder.");
  }
}

export type DeleteFolderResult =
  | { success: true; data: { folderIds: string[]; assetIds: string[] } }
  | {
      success: false;
      error: string;
      code?: "IN_USE";
      blocked?: Array<{ assetId: string; filename: string; usages: AssetUsage[] }>;
    };

/**
 * Deletes a folder, its subfolders and their files. Refuses (nothing deleted)
 * while any contained file is still referenced; see `deleteFolder`.
 */
export async function deleteFolderAction(
  campaignId: string,
  folderId: string,
): Promise<DeleteFolderResult> {
  try {
    const scope = await requireCampaignScope(idSchema.parse(campaignId));
    const id = uuidSchema.parse(folderId);
    const outcome = await deleteFolder(scope.organizationId, id, deleteAssetDeps);
    if (outcome.status === "in_use") {
      const first = outcome.blocked[0];
      return {
        success: false,
        code: "IN_USE",
        blocked: outcome.blocked,
        error: `“${first.filename}”${
          outcome.blocked.length > 1 ? ` and ${outcome.blocked.length - 1} more file(s)` : ""
        } in this folder ${outcome.blocked.length > 1 ? "are" : "is"} still used by ${describeUsages(
          first.usages,
        )}. Remove ${outcome.blocked.length > 1 ? "them" : "it"} there first, then delete the folder.`,
      };
    }
    return { success: true, data: { folderIds: outcome.folderIds, assetIds: outcome.assetIds } };
  } catch (error) {
    if (error instanceof AssetDeleteError) {
      logger.error("Folder deletion stopped on a file", { stage: error.stage, error });
      return {
        success: false,
        error: `${error.message} Some files in the folder may already have been deleted.`,
      };
    }
    return toErrorResult(error, "Failed to delete the folder.");
  }
}

/** Creates a custom SVG icon asset (inline markup, sanitized; no stored file). */
export async function createSvgAssetAction(
  campaignId: string,
  input: { name: string; folderId: string | null; content: string },
): Promise<ActionResult<Asset>> {
  try {
    const scope = await requireCampaignScope(idSchema.parse(campaignId));
    const parsed = z
      .object({
        name: z.string().max(500),
        folderId: folderIdSchema,
        content: z.string().max(600_000),
      })
      .parse(input);
    return { success: true, data: await createSvgAsset(scope.organizationId, parsed) };
  } catch (error) {
    return toErrorResult(error, "Failed to create the SVG icon.");
  }
}

/** Renames / moves a file, or edits an inline SVG icon's markup. */
export async function updateAssetAction(
  campaignId: string,
  assetId: string,
  patch: { filename?: string; folderId?: string | null; content?: string },
): Promise<ActionResult<Asset>> {
  try {
    const scope = await requireCampaignScope(idSchema.parse(campaignId));
    const id = uuidSchema.parse(assetId);
    const parsed = z
      .object({
        filename: z.string().max(500).optional(),
        folderId: folderIdSchema.optional(),
        content: z.string().max(600_000).optional(),
      })
      .parse(patch);
    return { success: true, data: await updateAssetDetails(scope.organizationId, id, parsed) };
  } catch (error) {
    return toErrorResult(error, "Failed to update the file.");
  }
}

export async function moveAssetsAction(
  campaignId: string,
  assetIds: string[],
  folderId: string | null,
): Promise<ActionResult<{ movedIds: string[] }>> {
  try {
    const scope = await requireCampaignScope(idSchema.parse(campaignId));
    const ids = z.array(uuidSchema).min(1).max(200).parse(assetIds);
    const target = folderIdSchema.parse(folderId);
    return {
      success: true,
      data: { movedIds: await moveAssets(scope.organizationId, ids, target) },
    };
  } catch (error) {
    return toErrorResult(error, "Failed to move the files.");
  }
}

/** Deletes several files; every file is checked/removed on its own and reported individually. */
export async function bulkDeleteAssetsAction(
  campaignId: string,
  assetIds: string[],
): Promise<ActionResult<BulkDeleteOutcome>> {
  try {
    const scope = await requireCampaignScope(idSchema.parse(campaignId));
    const ids = z.array(uuidSchema).min(1).max(200).parse(assetIds);
    return {
      success: true,
      data: await bulkDeleteAssets(scope.organizationId, ids, deleteAssetDeps),
    };
  } catch (error) {
    return toErrorResult(error, "Failed to delete the files.");
  }
}

/** Where is this file used? (drives the delete confirmation) */
export async function getAssetUsageAction(
  campaignId: string,
  assetId: string,
): Promise<ActionResult<AssetUsageSummary>> {
  try {
    const scope = await requireCampaignScope(idSchema.parse(campaignId));
    const id = uuidSchema.parse(assetId);
    const asset = await getDraftAsset(scope.organizationId, id);
    if (!asset) throw new NotFoundError("That file no longer exists.", { assetId: id });
    return {
      success: true,
      data: summarizeUsages(await findAssetUsages(scope.organizationId, asset.id)),
    };
  } catch (error) {
    return toErrorResult(error, "Failed to check where this file is used.");
  }
}

/** Authoritative per-folder file counts for the sidebar (`"root"` = All files). */
export async function getAssetFolderCountsAction(
  campaignId: string,
): Promise<ActionResult<Record<string, number>>> {
  try {
    const scope = await requireCampaignScope(idSchema.parse(campaignId));
    return { success: true, data: await countDraftAssetsByFolder(scope.organizationId) };
  } catch (error) {
    return toErrorResult(error, "Failed to load folder counts.");
  }
}
