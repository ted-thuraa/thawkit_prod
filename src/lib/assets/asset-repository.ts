// path: src/lib/assets/asset-repository.ts

import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { asset, assetFolder } from "@/drizzle/schemas/assets-schema";
import { isUuid } from "@/lib/editor/bootstrap/collect-asset-ids";
import { assetFolderFromRow, assetFromRow } from "@/lib/editor/bootstrap/mappers";
import type { Asset, AssetFolder } from "@/types/funnel";
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

// ─── Folders & asset mutations (media-library management) ──────────────────

const liveFolder = (organizationId: string) =>
  and(
    eq(assetFolder.organizationId, organizationId),
    eq(assetFolder.isPublished, false),
    isNull(assetFolder.deletedAt),
  );

/** Every live draft folder of the organization (a library has few; the tree is built client-side). */
export async function listDraftFolders(organizationId: string): Promise<AssetFolder[]> {
  const rows = await db.select().from(assetFolder).where(liveFolder(organizationId));
  return rows.map(assetFolderFromRow);
}

export async function getDraftFolder(
  organizationId: string,
  folderId: string,
): Promise<AssetFolder | null> {
  if (!isUuid(folderId)) return null;
  const [row] = await db
    .select()
    .from(assetFolder)
    .where(and(eq(assetFolder.id, folderId.toLowerCase()), liveFolder(organizationId)))
    .limit(1);
  return row ? assetFolderFromRow(row) : null;
}

export async function insertFolder(
  organizationId: string,
  input: { name: string; parentId: string | null; depth: number; order: number },
): Promise<AssetFolder> {
  const [row] = await db
    .insert(assetFolder)
    .values({
      organizationId,
      name: input.name,
      assetFolderId: input.parentId,
      depth: input.depth,
      order: input.order,
      isPublished: false,
    })
    .returning();
  return assetFolderFromRow(row);
}

/**
 * Renames and/or re-parents one folder and rewrites the stored `depth` of the
 * folder and its descendants in ONE transaction (depth is persisted, so a
 * partial update would corrupt the tree).
 */
export async function updateFolderAndDepths(
  organizationId: string,
  folderId: string,
  patch: { name?: string; parentId?: string | null },
  depths: ReadonlyMap<string, number>,
): Promise<void> {
  await db.transaction(async (tx) => {
    const set: Partial<typeof assetFolder.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.parentId !== undefined) set.assetFolderId = patch.parentId;
    const updated = await tx
      .update(assetFolder)
      .set(set)
      .where(and(eq(assetFolder.id, folderId), liveFolder(organizationId)))
      .returning({ id: assetFolder.id });
    if (updated.length === 0) throw new Error("Folder row not found for update");

    for (const [id, depth] of depths) {
      await tx
        .update(assetFolder)
        .set({ depth })
        .where(and(eq(assetFolder.id, id), liveFolder(organizationId)));
    }
  });
}

/** Logical deletion of folders (ids must already be org-validated). */
export async function markFoldersDeleted(
  organizationId: string,
  folderIds: readonly string[],
): Promise<void> {
  if (folderIds.length === 0) return;
  await db
    .update(assetFolder)
    .set({ deletedAt: new Date() })
    .where(and(inArray(assetFolder.id, [...folderIds]), liveFolder(organizationId)));
}

export async function listDraftAssetsInFolders(
  organizationId: string,
  folderIds: readonly string[],
): Promise<Asset[]> {
  if (folderIds.length === 0) return [];
  const rows = await db
    .select()
    .from(asset)
    .where(and(inArray(asset.assetFolderId, [...folderIds]), liveDraft(organizationId)));
  return rows.map(assetFromRow);
}

/** Inline-only SVG asset (no stored object): `content` is the sanitized markup. */
export async function insertInlineSvgAsset(
  organizationId: string,
  input: {
    filename: string;
    folderId: string | null;
    content: string;
    contentHash: string;
    fileSize: number;
    width: number | null;
    height: number | null;
  },
): Promise<Asset> {
  const [row] = await db
    .insert(asset)
    .values({
      organizationId,
      assetFolderId: input.folderId,
      source: "library",
      filename: input.filename,
      storagePath: null,
      publicUrl: null,
      fileSize: input.fileSize,
      mimeType: "image/svg+xml",
      width: input.width,
      height: input.height,
      content: input.content,
      contentHash: input.contentHash,
      isPublished: false,
    })
    .returning();
  return assetFromRow(row);
}

export async function updateDraftAsset(
  organizationId: string,
  assetId: string,
  patch: Partial<{
    filename: string;
    assetFolderId: string | null;
    content: string;
    contentHash: string;
    fileSize: number;
    width: number | null;
    height: number | null;
  }>,
): Promise<Asset | null> {
  if (!isUuid(assetId)) return null;
  const [row] = await db
    .update(asset)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(asset.id, assetId.toLowerCase()), liveDraft(organizationId)))
    .returning();
  return row ? assetFromRow(row) : null;
}

/** Moves the org's live assets among `ids` to a folder; returns the ids actually moved. */
export async function moveDraftAssets(
  organizationId: string,
  ids: readonly string[],
  folderId: string | null,
): Promise<string[]> {
  const valid = ids.filter(isUuid).map((i) => i.toLowerCase());
  if (valid.length === 0) return [];
  const rows = await db
    .update(asset)
    .set({ assetFolderId: folderId, updatedAt: new Date() })
    .where(and(inArray(asset.id, valid), liveDraft(organizationId)))
    .returning({ id: asset.id });
  return rows.map((r) => r.id);
}

/**
 * Number of live draft assets per folder, for the sidebar badges. Assets that
 * belong to no regular folder are counted under the key `"root"` — exactly the
 * set the virtual "All files" root displays (`asset_folder_id IS NULL`).
 */
export async function countDraftAssetsByFolder(
  organizationId: string,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ folderId: asset.assetFolderId, count: sql<number>`count(*)::int` })
    .from(asset)
    .where(liveDraft(organizationId))
    .groupBy(asset.assetFolderId);
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.folderId ?? "root"] = row.count;
  return counts;
}
