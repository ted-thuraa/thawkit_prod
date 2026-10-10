// path: src/lib/editor/bootstrap/load-assets.ts

import "server-only";
import { db } from "@/drizzle/db";
import type { Asset, AssetFolder } from "@/types/funnel";
import { assertTenantId } from "./instrument";
import { assetFolderFromRow, assetFromRow } from "./mappers";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Media-library bootstrap loaders. TENANCY: assets and folders are scoped
 * directly by `organizationId` (see assets-schema.ts) — every query below
 * carries it, including the by-id lookup, so a layer that references another
 * organization's asset id can never resolve it.
 *
 * Every query also pins `is_published = false` (the editor only ever works
 * on draft rows; the composite key means a published copy shares the id) and
 * `deleted_at IS NULL`.
 *
 * Unlike Ycode's `getAllAssets` (the whole library, 1000 rows per round
 * trip), the bootstrap loads a bounded subset: referenced assets + the first
 * page of the library root + all folders. Folders are small and form a tree
 * the panel needs whole; assets are unbounded per organization.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** First page of the library root shown when the Assets panel opens. */
export const ASSET_LIBRARY_PAGE_SIZE = 50;

// Postgres caps bind parameters at 65,535; chunk far below that so one huge
// funnel cannot build a pathological IN-list.
const ID_CHUNK_SIZE = 1000;

export interface AssetFoldersAndLibrary {
  folders: AssetFolder[];
  assets: Asset[];
}

/** Independent of page content — safe to start before pages have loaded. */
export async function loadAssetFoldersAndLibraryPage(
  organizationId: string,
): Promise<AssetFoldersAndLibrary> {
  const orgId = assertTenantId("organizationId", organizationId);

  const [folderRows, assetRows] = await Promise.all([
    db.query.assetFolder.findMany({
      where: {
        organizationId: orgId,
        isPublished: false,
        deletedAt: { isNull: true },
      },
      orderBy: { order: "asc", name: "asc", id: "asc" },
    }),
    db.query.asset.findMany({
      where: {
        organizationId: orgId,
        isPublished: false,
        deletedAt: { isNull: true },
        assetFolderId: { isNull: true },
      },
      orderBy: { createdAt: "desc", id: "asc" },
      limit: ASSET_LIBRARY_PAGE_SIZE,
    }),
  ]);

  return {
    folders: folderRows.map(assetFolderFromRow),
    assets: assetRows.map(assetFromRow),
  };
}

/**
 * Loads the assets a funnel's content references. `ids` must already be
 * UUID-validated (collect-asset-ids.ts does this) — `assets.id` is a uuid
 * column and a malformed value would make the query throw.
 */
export async function loadAssetsByIds(
  organizationId: string,
  ids: readonly string[],
): Promise<Asset[]> {
  const orgId = assertTenantId("organizationId", organizationId);
  if (ids.length === 0) return [];

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + ID_CHUNK_SIZE));
  }

  const results = await Promise.all(
    chunks.map((chunk) =>
      db.query.asset.findMany({
        where: {
          organizationId: orgId,
          isPublished: false,
          deletedAt: { isNull: true },
          id: { in: chunk },
        },
      }),
    ),
  );

  return results.flat().map(assetFromRow);
}

/** Merges asset lists by id (first occurrence wins), preserving order. */
export function mergeAssets(...lists: readonly Asset[][]): Asset[] {
  const seen = new Set<string>();
  const merged: Asset[] = [];
  for (const list of lists) {
    for (const asset of list) {
      if (seen.has(asset.id)) continue;
      seen.add(asset.id);
      merged.push(asset);
    }
  }
  return merged;
}
