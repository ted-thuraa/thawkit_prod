// path: src/drizzle/schemas/collections-schema.ts

/**
 * ─────────────────────────────────────────────────────────────────────────
 * CMS collections (EAV — entity/attribute/value):
 *
 *   collections (id, is_published)                       PK
 *     ├─< collection_fields  (collection_id, is_published)  ON DELETE CASCADE
 *     └─< collection_items   (collection_id, is_published)  ON DELETE CASCADE
 *            └─< collection_item_values
 *                  (item_id,  is_published) → collection_items   CASCADE
 *                  (field_id, is_published) → collection_fields  CASCADE
 *
 * OWNERSHIP DECISION: `collections.funnel_id` → `funnels.id` (CASCADE).
 *
 *   Not `campaign`: campaigns → funnels is strictly 1:1 (`funnels.campaignId`
 *   is UNIQUE), so a campaign FK adds no capability. The funnel is the
 *   content + publish unit (pages, funnel_versions, publishFunnel()); the
 *   campaign is the dashboard wrapper around it.
 *
 *   Not `organization` (the pattern assets/component/layer_style use): those
 *   are a workspace-wide *library* that is intentionally shared. Collections
 *   are *content that pages bind to* (CollectionVariable ids live inside page
 *   layer JSON). With the (id, is_published) dual-row model, org-scoped
 *   collections would couple publishes across funnels — publishing funnel A
 *   would push shared draft rows live under funnel B. Funnel scope keeps
 *   publish, rollback, duplication and deletion self-contained, and
 *   `reference_collection_id` / count-field links stay inside one funnel.
 *   Widening later (funnel → org) is a cheap migration; splitting shared
 *   org rows back into per-funnel copies is not.
 *
 *   TENANCY: no organizationId here, per funnel-content-schema.ts —
 *   `funnels.organizationId` is the single source of truth and queries reach
 *   it by joining through `funnels`. Child tables inherit scope via their
 *   composite FKs to `collections`, so only the root carries `funnel_id`.
 *
 * COMPOSITE PK (id, is_published): same dual-row (draft + published copy)
 * pattern as assets. See the note in assets-schema.ts and the one in
 * design-system-schema.ts about how this relates to funnel_versions.
 *
 * DEVIATIONS FROM THE KNEX BENCHMARK:
 *   - `collections.funnel_id` is new (see above).
 *   - The extra `idx_collections_uuid` index is omitted: `.unique()` already
 *     creates a unique index on `uuid`.
 *   - `collection_fields."default"` is exposed as `defaultValue` in TS (the
 *     column keeps its name; Drizzle quotes the reserved word).
 *   - `collection_imports` carries no FK, same as the benchmark: its
 *     `collection_id` cannot reference a composite-PK parent on `id` alone.
 *
 * Postgres port — see auth-schema.ts for column-type rationale. Extra-config
 * callbacks return arrays (drizzle-orm v1).
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { funnel } from "./campaigns-schema";
import type {
  CollectionSorting,
  CollectionFieldType,
  CollectionFieldData,
} from "@/types/funnel";

// ─── Collections ────────────────────────────────────────────────────────────

export const collection = pgTable(
  "collections",
  {
    id: uuid("id").defaultRandom().notNull(),
    funnelId: text("funnel_id")
      .notNull()
      .references(() => funnel.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Unique identifier for URL routing.
    uuid: uuid("uuid").notNull().unique().defaultRandom(),
    sorting: jsonb("sorting").$type<CollectionSorting>(),
    order: integer("order").notNull().default(0),
    isPublished: boolean("is_published").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.isPublished] }),
    index("collections_funnel_id_idx").on(t.funnelId),
    index("collections_is_published_idx").on(t.isPublished),
  ],
);

// ─── Collection fields (the "attributes") ───────────────────────────────────

export const collectionField = pgTable(
  "collection_fields",
  {
    id: uuid("id").defaultRandom().notNull(),
    collectionId: uuid("collection_id").notNull(),
    referenceCollectionId: uuid("reference_collection_id"),
    name: text("name").notNull(),
    // Built-in fields have a key to identify them.
    key: text("key"),
    type: text("type").notNull().$type<CollectionFieldType>(),
    defaultValue: text("default"),
    fillable: boolean("fillable").notNull().default(true),
    order: integer("order").notNull(),
    hidden: boolean("hidden").notNull().default(false),
    isComputed: boolean("is_computed").notNull().default(false),
    data: jsonb("data").notNull().$type<CollectionFieldData>().default({}),
    isPublished: boolean("is_published").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.isPublished] }),
    foreignKey({
      name: "collection_fields_collection_fkey",
      columns: [t.collectionId, t.isPublished],
      foreignColumns: [collection.id, collection.isPublished],
    }).onDelete("cascade"),
    index("collection_fields_collection_id_idx").on(t.collectionId),
    index("collection_fields_is_published_idx").on(t.isPublished),
    index("collection_fields_type_idx").on(t.type),
    index("collection_fields_listing_idx")
      .on(t.collectionId, t.isPublished, t.order)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

// ─── Collection items (the "entities") ──────────────────────────────────────

export const collectionItem = pgTable(
  "collection_items",
  {
    id: uuid("id").defaultRandom().notNull(),
    collectionId: uuid("collection_id").notNull(),
    manualOrder: bigint("manual_order", { mode: "number" })
      .notNull()
      .default(0),
    isPublishable: boolean("is_publishable").notNull().default(true),
    isPublished: boolean("is_published").notNull().default(false),
    contentHash: text("content_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.isPublished] }),
    foreignKey({
      name: "collection_items_collection_fkey",
      columns: [t.collectionId, t.isPublished],
      foreignColumns: [collection.id, collection.isPublished],
    }).onDelete("cascade"),
    index("collection_items_collection_id_idx").on(t.collectionId),
    index("collection_items_is_published_idx").on(t.isPublished),
    index("collection_items_listing_idx")
      .on(t.collectionId, t.isPublished, t.manualOrder, t.createdAt.desc())
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

// ─── Collection item values (the "values") ──────────────────────────────────

export const collectionItemValue = pgTable(
  "collection_item_values",
  {
    id: uuid("id").defaultRandom().notNull(),
    // Stored as text, cast based on the field's type.
    value: text("value"),
    itemId: uuid("item_id").notNull(),
    fieldId: uuid("field_id").notNull(),
    isPublished: boolean("is_published").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.isPublished] }),
    foreignKey({
      name: "collection_item_values_item_fkey",
      columns: [t.itemId, t.isPublished],
      foreignColumns: [collectionItem.id, collectionItem.isPublished],
    }).onDelete("cascade"),
    foreignKey({
      name: "collection_item_values_field_fkey",
      columns: [t.fieldId, t.isPublished],
      foreignColumns: [collectionField.id, collectionField.isPublished],
    }).onDelete("cascade"),
    index("collection_item_values_item_id_idx").on(t.itemId),
    index("collection_item_values_field_id_idx").on(t.fieldId),
    index("collection_item_values_is_published_idx").on(t.isPublished),
    // One draft and one published value per field per item.
    uniqueIndex("collection_item_values_item_field_unique_idx")
      .on(t.itemId, t.fieldId, t.isPublished)
      .where(sql`${t.deletedAt} IS NULL`),
    index("collection_item_values_field_published_idx")
      .on(t.fieldId, t.isPublished)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

// ─── CSV imports ────────────────────────────────────────────────────────────

export const collectionImportStatusValues = [
  "pending",
  "processing",
  "completed",
  "failed",
] as const;
export type CollectionImportStatusValue =
  (typeof collectionImportStatusValues)[number];

export const collectionImport = pgTable(
  "collection_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectionId: uuid("collection_id").notNull(),
    status: text("status")
      .notNull()
      .default("pending")
      .$type<CollectionImportStatusValue>(),
    totalRows: integer("total_rows").notNull().default(0),
    processedRows: integer("processed_rows").notNull().default(0),
    failedRows: integer("failed_rows").notNull().default(0),
    // { csvColumn: fieldId }
    columnMapping: jsonb("column_mapping")
      .notNull()
      .$type<Record<string, string>>(),
    // Parsed CSV rows (nullable — cleared once the import completes).
    csvData: jsonb("csv_data").$type<Record<string, string>[]>(),
    // Array of error messages.
    errors: jsonb("errors").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("collection_imports_collection_id_idx").on(t.collectionId),
    index("collection_imports_status_idx").on(t.status),
  ],
);

export type CollectionRow = typeof collection.$inferSelect;
export type NewCollectionRow = typeof collection.$inferInsert;
export type CollectionFieldRow = typeof collectionField.$inferSelect;
export type CollectionItemRow = typeof collectionItem.$inferSelect;
export type CollectionItemValueRow = typeof collectionItemValue.$inferSelect;
export type CollectionImportRow = typeof collectionImport.$inferSelect;
