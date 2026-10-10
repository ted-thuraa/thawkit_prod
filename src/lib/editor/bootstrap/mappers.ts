// path: src/lib/editor/bootstrap/mappers.ts

/**
 * Pure, isomorphic row → domain mappers for the assets and collections
 * bootstrap sections. No I/O, no `server-only`, so they are unit-testable
 * and safe to import anywhere.
 *
 * Why they exist: the Drizzle rows are camelCase with `Date` timestamps and
 * nullable columns, while the editor's `Asset` / `AssetFolder` / `Collection*`
 * domain types are snake_case with ISO-string timestamps and a few
 * non-nullable fields that the database allows to be NULL (inline-SVG assets
 * have no file size or mime type). All of that reconciliation lives here.
 */

import type {
  Asset,
  AssetFolder,
  Collection,
  CollectionField,
  CollectionItemWithValues,
} from "@/types/funnel";
import type {
  AssetFolderRow,
  AssetRow,
} from "@/drizzle/schemas/assets-schema";
import type {
  CollectionFieldRow,
  CollectionItemRow,
  CollectionRow,
} from "@/drizzle/schemas/collections-schema";

// Columns are `timestamp ... DEFAULT now()` and therefore nullable in the
// schema; the domain types require a string. Epoch keeps the value a valid
// ISO date instead of leaking `null`/"" into date formatting code.
const EPOCH_ISO = new Date(0).toISOString();

function iso(value: Date | null | undefined): string {
  return value ? value.toISOString() : EPOCH_ISO;
}

function isoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

// ─── Assets ─────────────────────────────────────────────────────────────────

export function assetFromRow(row: AssetRow): Asset {
  // Inline-SVG icon assets have `content` and no file; give them the mime
  // type the rest of the editor expects instead of a generic fallback.
  const mimeType =
    row.mimeType ?? (row.content ? "image/svg+xml" : "application/octet-stream");

  return {
    id: row.id,
    filename: row.filename,
    storage_path: row.storagePath,
    public_url: row.publicUrl,
    file_size: row.fileSize ?? 0,
    mime_type: mimeType,
    width: row.width,
    height: row.height,
    source: row.source,
    asset_folder_id: row.assetFolderId,
    content: row.content,
    content_hash: row.contentHash,
    is_published: row.isPublished,
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
    deleted_at: isoOrNull(row.deletedAt),
  };
}

export function assetFolderFromRow(row: AssetFolderRow): AssetFolder {
  return {
    id: row.id,
    asset_folder_id: row.assetFolderId,
    name: row.name,
    depth: row.depth,
    order: row.order,
    is_published: row.isPublished,
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
    deleted_at: isoOrNull(row.deletedAt),
  };
}

// ─── Collections ────────────────────────────────────────────────────────────

export function collectionFromRow(
  row: CollectionRow,
  extras: { draftItemsCount: number; hasPublishedVersion: boolean },
): Collection {
  return {
    id: row.id,
    name: row.name,
    uuid: row.uuid,
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
    deleted_at: isoOrNull(row.deletedAt),
    sorting: row.sorting ?? null,
    order: row.order,
    is_published: row.isPublished,
    draft_items_count: extras.draftItemsCount,
    has_published_version: extras.hasPublishedVersion,
  };
}

export function collectionFieldFromRow(row: CollectionFieldRow): CollectionField {
  return {
    id: row.id,
    name: row.name,
    key: row.key,
    type: row.type,
    default: row.defaultValue,
    fillable: row.fillable,
    order: row.order,
    collection_id: row.collectionId,
    reference_collection_id: row.referenceCollectionId,
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
    deleted_at: isoOrNull(row.deletedAt),
    hidden: row.hidden,
    is_computed: row.isComputed,
    data: row.data ?? {},
    is_published: row.isPublished,
  };
}

export function collectionItemFromRow(
  row: CollectionItemRow,
  values: Record<string, string>,
): CollectionItemWithValues {
  return {
    id: row.id,
    collection_id: row.collectionId,
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
    deleted_at: isoOrNull(row.deletedAt),
    manual_order: row.manualOrder,
    is_published: row.isPublished,
    is_publishable: row.isPublishable,
    content_hash: row.contentHash,
    values,
  };
}

/**
 * Folds EAV value rows into the `field_id → value` map the editor reads.
 * NULL values are dropped (the domain type is `Record<string, string>` and an
 * absent key already means "no value"). Rows are expected to be draft + live
 * only; the partial unique index guarantees one row per (item, field).
 */
export function foldItemValues(
  rows: ReadonlyArray<{ itemId: string; fieldId: string; value: string | null }>,
): Map<string, Record<string, string>> {
  const byItem = new Map<string, Record<string, string>>();
  for (const { itemId, fieldId, value } of rows) {
    if (value === null) continue;
    let values = byItem.get(itemId);
    if (!values) {
      values = {};
      byItem.set(itemId, values);
    }
    values[fieldId] = value;
  }
  return byItem;
}
