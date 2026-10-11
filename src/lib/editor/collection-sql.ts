// path: src/lib/editor/collection-sql.ts

import "server-only";
import {
  and,
  eq,
  getTableColumns,
  inArray,
  isNull,
  lte,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import { db } from "@/drizzle/db";
import {
  collectionItem,
  collectionItemValue,
  type CollectionItemRow,
} from "@/drizzle/schemas/collections-schema";
import { foldItemValues } from "./bootstrap/mappers";

/**
 * SQL primitives shared by the editor's bootstrap loader and its on-demand
 * read queries, so both paths stay byte-for-byte consistent about what a
 * "draft, live" row is and how items are ordered and sorted.
 *
 * Every query here pins `is_published = false` and `deleted_at IS NULL`:
 * with the composite (id, is_published) keys, a published copy of each row
 * shares its id, so omitting the pin would double every result.
 */

// Postgres caps bind parameters at 65,535; chunk far below that.
export const ID_CHUNK_SIZE = 1000;

export function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Manual order, then newest first, then id — deterministic. */
export function compareManual(a: CollectionItemRow, b: CollectionItemRow): number {
  if (a.manualOrder !== b.manualOrder) return a.manualOrder - b.manualOrder;
  const aTime = a.createdAt?.getTime() ?? 0;
  const bTime = b.createdAt?.getTime() ?? 0;
  if (aTime !== bTime) return bTime - aTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** `field_id → value` maps for the given items (draft, live values only). */
export async function loadItemValues(
  itemIds: readonly string[],
): Promise<Map<string, Record<string, string>>> {
  if (itemIds.length === 0) return new Map();

  const rows = (
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

  return foldItemValues(rows);
}

/**
 * Top-`limit` items per collection for every collection in `collectionIds`,
 * in ONE query, via `row_number() OVER (PARTITION BY collection_id ...)`.
 * Rows come back unordered across partitions — callers order per collection
 * with `compareManual`.
 */
export async function topItemsWindowed(
  collectionIds: readonly string[],
  limit: number,
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

  return db.select().from(ranked).where(lte(ranked.rn, limit));
}

/**
 * ORDER BY expression for sorting items by a field's value. Number-typed
 * fields sort numerically (NULL when the text isn't a number, so junk sorts
 * with the empties); everything else sorts as text. Ycode sorts the raw
 * text, which orders "10" before "9".
 */
export function fieldSortValueExpr(
  valueColumn: AnyColumn,
  fieldType: string | undefined,
): SQL {
  const numeric = fieldType === "number" || fieldType === "count";
  // `[.]` rather than `\.` — a backslash would be eaten by the template literal.
  return numeric
    ? sql`CASE WHEN ${valueColumn} ~ '^-?[0-9]+([.][0-9]+)?$' THEN ${valueColumn}::numeric END`
    : sql`${valueColumn}`;
}
