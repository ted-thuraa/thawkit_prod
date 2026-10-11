// path: src/lib/editor/read/collection-queries.ts

import "server-only";
import { alias } from "drizzle-orm/pg-core";
import {
  and,
  asc,
  count,
  eq,
  exists,
  getTableColumns,
  ilike,
  inArray,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/drizzle/db";
import {
  collection,
  collectionField,
  collectionItem,
  collectionItemValue,
} from "@/drizzle/schemas/collections-schema";
import { isUuid, collectReferencedAssetIds } from "@/lib/editor/bootstrap/collect-asset-ids";
import { loadAssetsByIds } from "@/lib/editor/bootstrap/load-assets";
import { collectionFieldFromRow, collectionItemFromRow } from "@/lib/editor/bootstrap/mappers";
import {
  compareManual,
  fieldSortValueExpr,
  loadItemValues,
  topItemsWindowed,
} from "@/lib/editor/collection-sql";
import { NotFoundError } from "@/lib/errors";
import type { CollectionField, CollectionItemWithValues } from "@/types/funnel";
import { escapeLike } from "./asset-queries";
import { requireCollectionInFunnel, type CampaignScope } from "./guards";
import type { CollectionItemsPage } from "./types";

/**
 * On-demand CMS reads. TENANCY: collections are scoped by `funnelId`, derived
 * from the authorized campaign. Every public function here first proves the
 * collection(s) belong to that funnel — a collection or item id from the
 * client is never trusted on its own. Draft + live rows only.
 */

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

function clampInt(value: number | undefined, min: number, max: number, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

// ─── Filters ────────────────────────────────────────────────────────────────

export interface ItemFilter {
  fieldId: string;
  operator: string;
  value: string;
}

/**
 * One dynamic filter as a SQL condition on `collection_items`.
 *
 * Semantics match Ycode's `applyDynamicFilter` — compare the item's value
 * for the field, lowercased, with a missing value treated as `''` — but the
 * condition is applied IN THE WHERE CLAUSE, before pagination. Ycode filters
 * the already-paginated page in JS, so a filtered collection layer shows
 * fewer items than it should whenever the collection spans more than one
 * page, and `total` ignores the filter entirely.
 *
 * Deviation: numeric operators (gt/gte/lt/lte) parse the stored text
 * strictly (`-?digits[.digits]`) instead of JS `parseFloat`, so "12px" is
 * not-a-number rather than 12.
 */
function filterCondition(filter: ItemFilter): SQL {
  const lv = filter.value.toLowerCase();
  // No alias: inside a raw `sql` template an aliased table interpolates as
  // just its alias, leaving the subquery without a FROM table. The outer
  // query is over `collection_items`, so the unaliased value table can't clash.
  const v = collectionItemValue;

  // A field id that isn't a UUID can't match any field: every item has no
  // value for it, exactly as if the field were unset (and, unlike binding the
  // string into a uuid comparison, it can't make Postgres throw).
  const fv = isUuid(filter.fieldId)
    ? sql`coalesce((select lower(${v.value}) from ${v} where ${v.itemId} = ${collectionItem.id} and ${v.fieldId} = ${filter.fieldId} and ${v.isPublished} = false and ${v.deletedAt} is null limit 1), '')`
    : sql`''::text`;

  const numeric = (op: ">" | ">=" | "<" | "<="): SQL => {
    const n = parseFloat(lv);
    if (!Number.isFinite(n)) return sql`false`;
    const fieldNumber = sql`(case when ${fv} ~ '^-?[0-9]+([.][0-9]+)?$' then (${fv})::numeric end)`;
    return sql`${fieldNumber} ${sql.raw(op)} ${String(n)}::numeric`;
  };

  switch (filter.operator) {
    case "contains":
    default: // Ycode falls back to `contains` for unknown operators.
      return sql`position(${lv}::text in ${fv}) > 0`;
    case "does_not_contain":
      return sql`position(${lv}::text in ${fv}) = 0`;
    case "is":
      return sql`${fv} = ${lv}::text`;
    case "is_not":
      return sql`${fv} <> ${lv}::text`;
    case "starts_with":
      return sql`starts_with(${fv}, ${lv}::text)`;
    case "ends_with":
      return sql`right(${fv}, length(${lv}::text)) = ${lv}::text`;
    case "is_empty":
      return sql`${fv} = ''`;
    case "is_not_empty":
      return sql`${fv} <> ''`;
    case "gt":
      return numeric(">");
    case "gte":
      return numeric(">=");
    case "lt":
      return numeric("<");
    case "lte":
      return numeric("<=");
  }
}

// ─── Items (paged / searched / filtered / sorted) ───────────────────────────

export interface CollectionItemsOptions {
  page?: number;
  limit?: number;
  offset?: number;
  search?: string;
  /** A field id, or `manual` / `none` / `random`. */
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  filters?: readonly ItemFilter[];
  includeAssets?: boolean;
}

async function loadDraftFields(collectionId: string): Promise<CollectionField[]> {
  const rows = await db.query.collectionField.findMany({
    where: { collectionId, isPublished: false, deletedAt: { isNull: true } },
    orderBy: { order: "asc", id: "asc" },
  });
  return rows.map(collectionFieldFromRow);
}

export async function queryCollectionItemsPage(
  scope: CampaignScope,
  collectionId: string,
  options: CollectionItemsOptions,
): Promise<CollectionItemsPage> {
  await requireCollectionInFunnel(scope.funnelId, collectionId);

  const limit = clampInt(options.limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
  const page = clampInt(options.page, 1, 10_000, 1);
  const offset =
    options.offset !== undefined
      ? clampInt(options.offset, 0, 1_000_000, 0)
      : (page - 1) * limit;

  const sortBy = options.sortBy;
  const direction = options.sortOrder === "desc" ? "desc" : "asc";
  const randomOrder = sortBy === "random";
  // Anything that isn't a real field id (manual, none, junk) sorts manually.
  const sortFieldId = sortBy && isUuid(sortBy) ? sortBy : null;

  const fields =
    sortFieldId || options.includeAssets
      ? await loadDraftFields(collectionId)
      : [];

  // ── WHERE: scope + search + filters, shared by the data and count queries
  const conditions: SQL[] = [
    eq(collectionItem.collectionId, collectionId),
    eq(collectionItem.isPublished, false),
    isNull(collectionItem.deletedAt),
  ];

  const term = options.search?.trim();
  if (term) {
    // Matches any of the item's values — same as Ycode — but with literal
    // `%` / `_` / `\` in the term instead of wildcards.
    const s = alias(collectionItemValue, "srch");
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(s)
          .where(
            and(
              eq(s.itemId, collectionItem.id),
              eq(s.isPublished, false),
              isNull(s.deletedAt),
              ilike(s.value, `%${escapeLike(term)}%`),
            ),
          ),
      ),
    );
  }

  for (const filter of options.filters ?? []) {
    conditions.push(filterCondition(filter));
  }

  const where = and(...conditions);

  // ── Data query
  let dataQuery = db
    .select(getTableColumns(collectionItem))
    .from(collectionItem)
    .$dynamic();

  if (sortFieldId && !randomOrder) {
    const civ = alias(collectionItemValue, "civ");
    const sortField = fields.find((field) => field.id === sortFieldId);
    const sortExpr = fieldSortValueExpr(civ.value, sortField?.type);

    dataQuery = dataQuery
      .leftJoin(
        civ,
        and(
          eq(civ.itemId, collectionItem.id),
          eq(civ.isPublished, false),
          eq(civ.fieldId, sortFieldId),
          isNull(civ.deletedAt),
        ),
      )
      .where(where)
      .orderBy(
        // Empty values are the SMALLEST: first ascending, last descending.
        // This is what the editor's client-side comparator has always done,
        // so a collection does not flip its empties when it grows past one
        // page and moves from a JS sort to this one.
        direction === "desc"
          ? sql`${sortExpr} DESC NULLS LAST`
          : sql`${sortExpr} ASC NULLS FIRST`,
        asc(collectionItem.manualOrder),
        asc(collectionItem.id),
      );
  } else if (randomOrder) {
    dataQuery = dataQuery.where(where).orderBy(sql`random()`);
  } else {
    dataQuery = dataQuery
      .where(where)
      .orderBy(
        asc(collectionItem.manualOrder),
        sql`${collectionItem.createdAt} DESC`,
        asc(collectionItem.id),
      );
  }

  const [itemRows, [countRow]] = await Promise.all([
    dataQuery.limit(limit).offset(offset),
    db.select({ total: count() }).from(collectionItem).where(where),
  ]);

  const valuesByItem = await loadItemValues(itemRows.map((row) => row.id));
  const items = itemRows.map((row) =>
    collectionItemFromRow(row, valuesByItem.get(row.id) ?? {}),
  );

  const result: CollectionItemsPage = {
    items,
    total: Number(countRow?.total ?? 0),
    page,
    limit,
  };

  if (options.includeAssets) {
    const assetIds = collectReferencedAssetIds({
      json: [],
      fields: { [collectionId]: fields },
      items: { [collectionId]: items },
    });
    if (assetIds.length > 0) {
      const referencedAssets = await loadAssetsByIds(scope.organizationId, assetIds);
      if (referencedAssets.length > 0) result.referencedAssets = referencedAssets;
    }
  }

  return result;
}

// ─── Fields ─────────────────────────────────────────────────────────────────

/**
 * Fields of one collection (optionally name-searched), or — with
 * `collectionId === null` — of every live collection in the funnel.
 */
export async function queryCollectionFields(
  scope: CampaignScope,
  collectionId: string | null,
  search?: string,
): Promise<CollectionField[]> {
  const conditions: SQL[] = [
    eq(collectionField.isPublished, false),
    isNull(collectionField.deletedAt),
  ];

  if (collectionId === null) {
    conditions.push(
      inArray(
        collectionField.collectionId,
        db
          .select({ id: collection.id })
          .from(collection)
          .where(
            and(
              eq(collection.funnelId, scope.funnelId),
              eq(collection.isPublished, false),
              isNull(collection.deletedAt),
            ),
          ),
      ),
    );
  } else {
    await requireCollectionInFunnel(scope.funnelId, collectionId);
    conditions.push(eq(collectionField.collectionId, collectionId));
  }

  const term = search?.trim();
  if (term) conditions.push(ilike(collectionField.name, `%${escapeLike(term)}%`));

  const rows = await db
    .select()
    .from(collectionField)
    .where(and(...conditions))
    .orderBy(asc(collectionField.order), asc(collectionField.id));

  return rows.map(collectionFieldFromRow);
}

// ─── Batch / single lookups ─────────────────────────────────────────────────

/**
 * First `limit` items per collection for many collections in one round trip
 * (reference-field display lookups). Only collections that belong to this
 * funnel are served; unknown or foreign ids are silently absent from the
 * result, same as "no such collection". Raw `values` only — no enrichment.
 */
export async function queryReferencedItemsBatch(
  scope: CampaignScope,
  collectionIds: readonly string[],
  limit: number,
): Promise<Record<string, { items: CollectionItemWithValues[] }>> {
  const candidates = [...new Set(collectionIds.filter(isUuid).map((id) => id.toLowerCase()))];
  if (candidates.length === 0) return {};

  const owned = await db
    .select({ id: collection.id })
    .from(collection)
    .where(
      and(
        inArray(collection.id, candidates),
        eq(collection.funnelId, scope.funnelId),
        eq(collection.isPublished, false),
        isNull(collection.deletedAt),
      ),
    );
  const ids = owned.map((row) => row.id);
  if (ids.length === 0) return {};

  const rows = await topItemsWindowed(ids, clampInt(limit, 1, MAX_LIMIT, 100));
  const valuesByItem = await loadItemValues(rows.map((row) => row.id));

  const result: Record<string, { items: CollectionItemWithValues[] }> = {};
  for (const id of ids) result[id] = { items: [] };

  rows.sort(compareManual);
  for (const row of rows) {
    result[row.collectionId].items.push(
      collectionItemFromRow(row, valuesByItem.get(row.id) ?? {}),
    );
  }
  return result;
}

export async function queryCollectionItemById(
  scope: CampaignScope,
  collectionId: string,
  itemId: string,
): Promise<CollectionItemWithValues> {
  await requireCollectionInFunnel(scope.funnelId, collectionId);
  if (!isUuid(itemId)) throw new NotFoundError("Item not found.", { itemId });

  const row = await db.query.collectionItem.findFirst({
    where: { id: itemId, collectionId, isPublished: false, deletedAt: { isNull: true } },
  });
  if (!row) throw new NotFoundError("Item not found.", { itemId });

  const values = await loadItemValues([row.id]);
  return collectionItemFromRow(row, values.get(row.id) ?? {});
}

/**
 * `item id → slug` for items of ANY collection in this funnel (cross-collection
 * reference links). One join; only items whose collection has a `slug` field
 * with a non-empty value appear, and items of other funnels never do.
 */
export async function queryItemSlugs(
  scope: CampaignScope,
  itemIds: readonly string[],
): Promise<Record<string, string>> {
  const ids = [...new Set(itemIds.filter(isUuid).map((id) => id.toLowerCase()))];
  if (ids.length === 0) return {};

  const rows = await db
    .select({ itemId: collectionItem.id, slug: collectionItemValue.value })
    .from(collectionItem)
    .innerJoin(
      collection,
      and(
        eq(collection.id, collectionItem.collectionId),
        eq(collection.funnelId, scope.funnelId),
        eq(collection.isPublished, false),
        isNull(collection.deletedAt),
      ),
    )
    .innerJoin(
      collectionField,
      and(
        eq(collectionField.collectionId, collectionItem.collectionId),
        eq(collectionField.key, "slug"),
        eq(collectionField.isPublished, false),
        isNull(collectionField.deletedAt),
      ),
    )
    .innerJoin(
      collectionItemValue,
      and(
        eq(collectionItemValue.itemId, collectionItem.id),
        eq(collectionItemValue.fieldId, collectionField.id),
        eq(collectionItemValue.isPublished, false),
        isNull(collectionItemValue.deletedAt),
      ),
    )
    .where(
      and(
        inArray(collectionItem.id, ids),
        eq(collectionItem.isPublished, false),
        isNull(collectionItem.deletedAt),
      ),
    );

  const slugs: Record<string, string> = {};
  for (const { itemId, slug } of rows) {
    if (slug) slugs[itemId] = slug;
  }
  return slugs;
}
