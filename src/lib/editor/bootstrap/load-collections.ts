// path: src/lib/editor/bootstrap/load-collections.ts

import "server-only";
import { alias } from "drizzle-orm/pg-core";
import {
  and,
  asc,
  count,
  eq,
  getTableColumns,
  inArray,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import { db } from "@/drizzle/db";
import {
  collection,
  collectionItem,
  collectionItemValue,
  type CollectionFieldRow,
  type CollectionItemRow,
} from "@/drizzle/schemas/collections-schema";
import { getSortParams } from "@/lib/collection-utils";
import type {
  CollectionField,
  CollectionItemWithValues,
  CollectionSorting,
} from "@/types/funnel";
import { isUuid } from "./collect-asset-ids";
import { assertTenantId } from "./instrument";
import {
  collectionFieldFromRow,
  collectionFromRow,
  collectionItemFromRow,
  foldItemValues,
} from "./mappers";
import type { CollectionsBootstrapData } from "./types";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * CMS bootstrap loader — the server-side replacement for Ycode's
 * `collectionsStore.loadCollections()` → `loadFields(null)` →
 * `getTopItemsPerCollection()` client waterfall (three dependent network
 * round-trips after mount).
 *
 * TENANCY: collections are scoped by `funnelId` (ownership decision in
 * collections-schema.ts); children are reached only through composite FKs to
 * a collection loaded here, so no child query needs its own tenant column.
 * `funnelId` always comes from the validated campaign's funnel.
 *
 * DRAFT/PUBLISHED: every query pins `is_published = false` and
 * `deleted_at IS NULL`. The composite `(id, is_published)` keys mean a
 * published copy of every row shares its id — omitting the pin would double
 * every collection, field, item and value.
 *
 * QUERY PLAN (constant in the number of collections):
 *   1. collections
 *   2. in parallel: fields · per-collection item counts · published ids ·
 *      top-N items (one window query for all manual/small collections, plus
 *      one sorted query per field-sorted collection with > N items)
 *   3. values for every selected item
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Items preloaded per collection — matches Ycode's PRELOAD_LIMIT. */
export const COLLECTION_PRELOAD_LIMIT = 25;

const ID_CHUNK_SIZE = 1000;

const EMPTY: CollectionsBootstrapData = {
  collections: [],
  fields: {},
  items: {},
  itemsTotalCount: {},
  lastItemsQuery: {},
};

function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Same comparator the client store used after its batch preload: numeric when
 * both sides parse as numbers, otherwise locale string order. Applied to
 * small collections whose sort is by field value (a collection with <= N
 * items is fully loaded, so sorting in JS is exact).
 */
function sortItemsByValue(
  items: CollectionItemWithValues[],
  sorting: CollectionSorting,
): CollectionItemWithValues[] {
  return [...items].sort((a, b) => {
    const aValue = a.values[sorting.field] || "";
    const bValue = b.values[sorting.field] || "";
    const aNum = parseFloat(String(aValue));
    const bNum = parseFloat(String(bValue));
    if (!isNaN(aNum) && !isNaN(bNum)) {
      return sorting.direction === "asc" ? aNum - bNum : bNum - aNum;
    }
    const cmp = String(aValue).localeCompare(String(bValue));
    return sorting.direction === "asc" ? cmp : -cmp;
  });
}

/** Manual order, then newest first, then id — deterministic. */
function compareManual(a: CollectionItemRow, b: CollectionItemRow): number {
  if (a.manualOrder !== b.manualOrder) return a.manualOrder - b.manualOrder;
  const aTime = a.createdAt?.getTime() ?? 0;
  const bTime = b.createdAt?.getTime() ?? 0;
  if (aTime !== bTime) return bTime - aTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Top-N items per collection for every collection in `collectionIds`, in ONE
 * query, via `row_number() OVER (PARTITION BY collection_id ...)`.
 */
async function loadTopItemsWindowed(
  collectionIds: readonly string[],
): Promise<CollectionItemRow[]> {
  if (collectionIds.length === 0) return [];

  const ranked = db
    .select({
      ...getTableColumns(collectionItem),
      rn: sql<number>`row_number() over (
        partition by ${collectionItem.collectionId}
        order by ${collectionItem.manualOrder} asc,
                 ${collectionItem.createdAt} desc,
                 ${collectionItem.id} asc
      )`.as("rn"),
    })
    .from(collectionItem)
    .where(
      and(
        inArray(collectionItem.collectionId, [...collectionIds]),
        eq(collectionItem.isPublished, false),
        isNull(collectionItem.deletedAt),
      ),
    )
    .as("ranked");

  return db
    .select()
    .from(ranked)
    .where(lte(ranked.rn, COLLECTION_PRELOAD_LIMIT));
}

/**
 * Top-N items for ONE collection sorted by a field's value (collections with
 * more than N items, where the first page cannot be sorted client-side).
 * Items with no value sort last (ASC) / first (DESC), matching what a
 * client-side sort would produce. Number-typed fields sort numerically —
 * Ycode sorts the raw text, which orders "10" before "9".
 */
async function loadTopItemsSorted(
  collectionId: string,
  sortFieldId: string,
  direction: "asc" | "desc",
  sortFieldType: string | undefined,
): Promise<CollectionItemRow[]> {
  const civ = alias(collectionItemValue, "civ");

  const numeric = sortFieldType === "number" || sortFieldType === "count";
  // `[.]` rather than `\.` — a backslash would be eaten by the template literal.
  const sortExpr = numeric
    ? sql`CASE WHEN ${civ.value} ~ '^-?[0-9]+([.][0-9]+)?$' THEN ${civ.value}::numeric END`
    : sql`${civ.value}`;

  return db
    .select(getTableColumns(collectionItem))
    .from(collectionItem)
    .leftJoin(
      civ,
      and(
        eq(civ.itemId, collectionItem.id),
        eq(civ.isPublished, false),
        eq(civ.fieldId, sortFieldId),
        isNull(civ.deletedAt),
      ),
    )
    .where(
      and(
        eq(collectionItem.collectionId, collectionId),
        eq(collectionItem.isPublished, false),
        isNull(collectionItem.deletedAt),
      ),
    )
    .orderBy(
      direction === "desc"
        ? sql`${sortExpr} DESC NULLS FIRST`
        : sql`${sortExpr} ASC NULLS LAST`,
      asc(collectionItem.manualOrder),
      asc(collectionItem.id),
    )
    .limit(COLLECTION_PRELOAD_LIMIT);
}

export async function loadCollectionsBootstrap(
  funnelId: string,
): Promise<CollectionsBootstrapData> {
  const scopedFunnelId = assertTenantId("funnelId", funnelId);

  // 1 ── collections
  const collectionRows = await db.query.collection.findMany({
    where: {
      funnelId: scopedFunnelId,
      isPublished: false,
      deletedAt: { isNull: true },
    },
    orderBy: { order: "asc", createdAt: "desc" },
  });

  if (collectionRows.length === 0) return EMPTY;

  const collectionIds = collectionRows.map((row) => row.id);

  // 2 ── fields · counts · published ids (parallel)
  const [fieldRows, countRows, publishedRows] = await Promise.all([
    db.query.collectionField.findMany({
      where: {
        collectionId: { in: collectionIds },
        isPublished: false,
        deletedAt: { isNull: true },
      },
      orderBy: { order: "asc", id: "asc" },
    }),
    db
      .select({
        collectionId: collectionItem.collectionId,
        total: count(),
      })
      .from(collectionItem)
      .where(
        and(
          inArray(collectionItem.collectionId, collectionIds),
          eq(collectionItem.isPublished, false),
          isNull(collectionItem.deletedAt),
        ),
      )
      .groupBy(collectionItem.collectionId),
    db
      .select({ id: collection.id })
      .from(collection)
      .where(
        and(
          inArray(collection.id, collectionIds),
          eq(collection.isPublished, true),
          isNull(collection.deletedAt),
        ),
      ),
  ]);

  const totalByCollection = new Map(
    countRows.map((row) => [row.collectionId, Number(row.total)]),
  );
  const publishedIds = new Set(publishedRows.map((row) => row.id));

  const fieldsByCollection = new Map<string, CollectionFieldRow[]>();
  for (const row of fieldRows) {
    const list = fieldsByCollection.get(row.collectionId);
    if (list) list.push(row);
    else fieldsByCollection.set(row.collectionId, [row]);
  }

  // Which collections need a field-sorted query: a non-manual sort over a
  // real field (UUID — `field_id` is a uuid column) with more items than fit
  // in the first page. Everything else is covered by the window query.
  const serverSorted = collectionRows.filter((row) => {
    const sorting = row.sorting;
    return (
      sorting !== null &&
      sorting.direction !== "manual" &&
      isUuid(sorting.field) &&
      (totalByCollection.get(row.id) ?? 0) > COLLECTION_PRELOAD_LIMIT
    );
  });
  const serverSortedIds = new Set(serverSorted.map((row) => row.id));
  const windowedIds = collectionIds.filter((id) => !serverSortedIds.has(id));

  const [windowedRows, ...sortedResults] = await Promise.all([
    loadTopItemsWindowed(windowedIds),
    ...serverSorted.map((row) => {
      const sorting = row.sorting as CollectionSorting;
      const sortField = fieldsByCollection
        .get(row.id)
        ?.find((field) => field.id === sorting.field);
      return loadTopItemsSorted(
        row.id,
        sorting.field,
        sorting.direction === "desc" ? "desc" : "asc",
        sortField?.type,
      );
    }),
  ]);

  const itemRowsByCollection = new Map<string, CollectionItemRow[]>();
  for (const row of windowedRows) {
    const list = itemRowsByCollection.get(row.collectionId);
    if (list) list.push(row);
    else itemRowsByCollection.set(row.collectionId, [row]);
  }
  // Window rows arrive unordered across partitions — order each collection.
  for (const list of itemRowsByCollection.values()) list.sort(compareManual);
  serverSorted.forEach((row, index) => {
    itemRowsByCollection.set(row.id, sortedResults[index]);
  });

  // 3 ── values for every selected item
  const itemIds = [...itemRowsByCollection.values()].flatMap((rows) =>
    rows.map((row) => row.id),
  );
  const valueRows = (
    await Promise.all(
      chunk(itemIds, ID_CHUNK_SIZE).map((ids) =>
        db
          .select({
            itemId: collectionItemValue.itemId,
            fieldId: collectionItemValue.fieldId,
            value: collectionItemValue.value,
          })
          .from(collectionItemValue)
          .where(
            and(
              inArray(collectionItemValue.itemId, ids),
              eq(collectionItemValue.isPublished, false),
              isNull(collectionItemValue.deletedAt),
            ),
          ),
      ),
    )
  ).flat();
  const valuesByItem = foldItemValues(valueRows);

  // Assemble
  const fields: Record<string, CollectionField[]> = {};
  const items: Record<string, CollectionItemWithValues[]> = {};
  const itemsTotalCount: Record<string, number> = {};
  const lastItemsQuery: CollectionsBootstrapData["lastItemsQuery"] = {};

  for (const row of collectionRows) {
    const total = totalByCollection.get(row.id) ?? 0;
    fields[row.id] = (fieldsByCollection.get(row.id) ?? []).map(
      collectionFieldFromRow,
    );

    let collectionItems = (itemRowsByCollection.get(row.id) ?? []).map((item) =>
      collectionItemFromRow(item, valuesByItem.get(item.id) ?? {}),
    );
    // Fully-loaded collection sorted by a field value: sort here, exactly as
    // the client store did after its batch preload.
    if (
      row.sorting &&
      row.sorting.direction !== "manual" &&
      !serverSortedIds.has(row.id)
    ) {
      collectionItems = sortItemsByValue(collectionItems, row.sorting);
    }

    items[row.id] = collectionItems;
    itemsTotalCount[row.id] = total;
    lastItemsQuery[row.id] = {
      page: 1,
      limit: COLLECTION_PRELOAD_LIMIT,
      ...getSortParams(row.sorting),
    };
  }

  const collections = collectionRows.map((row) =>
    collectionFromRow(row, {
      draftItemsCount: totalByCollection.get(row.id) ?? 0,
      hasPublishedVersion: publishedIds.has(row.id),
    }),
  );

  return { collections, fields, items, itemsTotalCount, lastItemsQuery };
}
