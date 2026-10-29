// path: src/lib/assets/asset-repository.ts

import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { asset, assetFolder } from "@/drizzle/schemas/assets-schema";
import { isUuid } from "@/lib/editor/bootstrap/collect-asset-ids";
import { assetFromRow } from "@/lib/editor/bootstrap/mappers";
import type { Asset } from "@/types/funnel";
import type { NewAssetInput } from "./process-upload";

/**
 * Write-side persistence for the media library. Every function takes the
 * `organizationId` derived from the authorized campaign and puts it in the
 * WHERE clause, so a foreign id matches nothing (indistinguishable from a
 * missing row). Only DRAFT rows (`is_published = false`) are touched: there
 * is no publish-time asset sync in ThawKit (see the implementation plan).
 */

const liveDraft = (organizationId: string) =>
  and(
    eq(asset.organizationId, organizationId),
    eq(asset.isPublished, false),
    isNull(asset.deletedAt),
  );

/** By UploadThing key. Keys are globally unique, so no org filter is needed for idempotency. */
export async function findAssetByStorageKey(key: string): Promise<Asset | null> {
  const [row] = await db
    .select()
    .from(asset)
    .where(
      and(
        eq(asset.storagePath, key),
        eq(asset.isPublished, false),
        isNull(asset.deletedAt),
      ),
    )
    .limit(1);
  return row ? assetFromRow(row) : null;
}

/**
 * Inserts the row; if the unique index on `storage_path` already holds one
 * (callback redelivery / race) returns the existing row with `created:false`.
 */
export async function insertAssetIdempotent(
  input: NewAssetInput,
): Promise<{ asset: Asset; created: boolean }> {
  const [row] = await db
    .insert(asset)
    .values({
      organizationId: input.organizationId,
      assetFolderId: input.assetFolderId,
      source: "library",
      filename: input.filename,
      storagePath: input.storagePath,
      publicUrl: input.publicUrl,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      width: input.width,
      height: input.height,
      content: input.content,
      contentHash: input.contentHash,
      isPublished: false,
    })
    .onConflictDoNothing()
    .returning();

  if (row) return { asset: assetFromRow(row), created: true };

  const existing = await findAssetByStorageKey(input.storagePath);
  if (!existing) {
    // Conflict with a soft-deleted row for the same key: should be impossible
    // (keys are never reused) — surface it rather than pretend success.
    throw new Error(`Asset row conflict for storage key ${input.storagePath}`);
  }
  return { asset: existing, created: false };
}

/** The live draft asset of this organization, or null. */
export async function getDraftAsset(
  organizationId: string,
  assetId: string,
): Promise<Asset | null> {
  if (!isUuid(assetId)) return null;
  const [row] = await db
    .select()
    .from(asset)
    .where(and(eq(asset.id, assetId.toLowerCase()), liveDraft(organizationId)))
    .limit(1);
  return row ? assetFromRow(row) : null;
}

/** Logical deletion. Returns false when no live row matched (already deleted / foreign). */
export async function markAssetDeleted(
  organizationId: string,
  assetId: string,
): Promise<boolean> {
  if (!isUuid(assetId)) return false;
  const rows = await db
    .update(asset)
    .set({ deletedAt: new Date() })
    .where(and(eq(asset.id, assetId.toLowerCase()), liveDraft(organizationId)))
    .returning({ id: asset.id });
  return rows.length > 0;
}

/** True when `folderId` is a live draft folder of this organization. */
export async function folderBelongsToOrganization(
  organizationId: string,
  folderId: string,
): Promise<boolean> {
  if (!isUuid(folderId)) return false;
  const [row] = await db
    .select({ id: assetFolder.id })
    .from(assetFolder)
    .where(
      and(
        eq(assetFolder.id, folderId.toLowerCase()),
        eq(assetFolder.organizationId, organizationId),
        eq(assetFolder.isPublished, false),
        isNull(assetFolder.deletedAt),
      ),
    )
    .limit(1);
  return !!row;
}
