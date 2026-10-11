// path: src/lib/editor/read/asset-queries.ts

import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, type SQL } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { asset } from "@/drizzle/schemas/assets-schema";
import { isUuid } from "@/lib/editor/bootstrap/collect-asset-ids";
import { assertTenantId } from "@/lib/editor/bootstrap/instrument";
import { loadAssetsByIds } from "@/lib/editor/bootstrap/load-assets";
import { assetFromRow } from "@/lib/editor/bootstrap/mappers";
import type { Asset } from "@/types/funnel";
import type { AssetsPage } from "./types";

/**
 * On-demand media-library reads. TENANCY: every query carries the
 * `organizationId` derived from the authorized campaign, so a folder id or
 * asset id from another organization simply matches nothing. Draft + live
 * rows only (`is_published = false`, `deleted_at IS NULL`).
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function clampInt(value: number | undefined, min: number, max: number, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

/**
 * Escapes LIKE/ILIKE metacharacters so a user typing `100%` or `a_b` searches
 * for that literal text. (Ycode passes the term through raw, so `%` and `_`
 * act as wildcards and `\` is an escape.)
 */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, "\\$&");
}

export interface AssetsPageParams {
  /** `null` = library root; `undefined` = no folder filter. */
  folderId?: string | null;
  /** Several folders at once (search across descendants); `"root"` = root. */
  folderIds?: readonly string[];
  search?: string;
  page?: number;
  limit?: number;
}

export async function queryAssetsPage(
  organizationId: string,
  params: AssetsPageParams,
): Promise<AssetsPage> {
  const orgId = assertTenantId("organizationId", organizationId);
  const limit = clampInt(params.limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
  const page = clampInt(params.page, 1, 10_000, 1);
  const empty: AssetsPage = { assets: [], total: 0, page, limit, hasMore: false };

  const conditions: SQL[] = [
    eq(asset.organizationId, orgId),
    eq(asset.isPublished, false),
    isNull(asset.deletedAt),
  ];

  // Folder filter. A folder id that is not a UUID can never match, so it
  // yields an empty page rather than a database error.
  if (params.folderIds && params.folderIds.length > 0) {
    const includesRoot = params.folderIds.includes("root");
    const folderIds = params.folderIds.filter(isUuid);

    if (includesRoot && folderIds.length > 0) {
      conditions.push(or(isNull(asset.assetFolderId), inArray(asset.assetFolderId, folderIds))!);
    } else if (includesRoot) {
      conditions.push(isNull(asset.assetFolderId));
    } else if (folderIds.length > 0) {
      conditions.push(inArray(asset.assetFolderId, folderIds));
    } else {
      return empty;
    }
  } else if (params.folderId !== undefined) {
    if (params.folderId === null) {
      conditions.push(isNull(asset.assetFolderId));
    } else if (isUuid(params.folderId)) {
      conditions.push(eq(asset.assetFolderId, params.folderId));
    } else {
      return empty;
    }
  }

  const term = params.search?.trim();
  if (term) conditions.push(ilike(asset.filename, `%${escapeLike(term)}%`));

  const where = and(...conditions);
  const offset = (page - 1) * limit;

  const [rows, [countRow]] = await Promise.all([
    db
      .select()
      .from(asset)
      .where(where)
      // id tiebreaker keeps page boundaries stable for identical timestamps.
      .orderBy(desc(asset.createdAt), asc(asset.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(asset).where(where),
  ]);

  const total = Number(countRow?.total ?? 0);
  return {
    assets: rows.map(assetFromRow),
    total,
    page,
    limit,
    hasMore: offset + rows.length < total,
  };
}

/**
 * Batch lookup by id. Non-UUID ids are dropped and duplicates collapsed —
 * the editor probes with whatever a layer holds, which is not always an id.
 */
export async function queryAssetsByIds(
  organizationId: string,
  ids: readonly string[],
): Promise<Asset[]> {
  const valid = [...new Set(ids.filter(isUuid).map((id) => id.toLowerCase()))];
  return loadAssetsByIds(organizationId, valid);
}

// Re-exported so the actions file has one import surface for folders.
export { loadAssetFolders } from "@/lib/editor/bootstrap/load-assets";

