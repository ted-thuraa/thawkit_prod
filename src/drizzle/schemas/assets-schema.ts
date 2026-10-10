// path: src/drizzle/schemas/assets-schema.ts

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Organization-scoped media library: uploaded images, video, audio, documents
 * and inline-SVG icons that layers reference via `AssetVariable.asset_id`
 * (see types/funnel.ts → `Asset`).
 *
 * TENANCY: direct `organizationId` FK, same pattern as `campaign`, `funnel`,
 * `component` and `layer_style` — an asset is a workspace-wide library item
 * reusable across every campaign and funnel, not content owned by one funnel.
 *
 * Ported from a Knex/Postgres table — column mapping:
 *   - uuid + gen_random_uuid()   → uuid().defaultRandom()
 *   - string(n)                  → text (see auth-schema.ts header: Postgres
 *                                  stores varchar and text identically; keep
 *                                  length limits in the Zod layer)
 *   - timestamp useTz            → timestamp({ withTimezone: true })
 *   - table.primary([...])       → primaryKey({ columns: [...] })
 *   - raw partial indexes        → index().where(sql`...`)
 *
 * COMPOSITE PK (id, is_published): kept from the benchmark so a draft row
 * and its published copy can share one `id`. NOTE: design-system-schema.ts
 * deliberately avoids this dual-row pattern for component/layer_style
 * because `funnel_versions.compiledSchema` is the publish snapshot. If
 * assets should follow that model instead, drop `isPublished`, `contentHash`,
 * `deletedAt` and the composite PK in favour of `id.primaryKey()`.
 *
 * FK CAVEAT: a PARTIAL unique index (`assets_id_draft_unique_idx`) cannot be
 * the target of a Postgres foreign key — FKs need a full unique constraint.
 * The index is kept for draft-id lookups/uniqueness, but any table that needs
 * a real FK to an asset must reference (id, is_published) or store the id
 * without a DB-level FK.
 *
 * FOLDERS: `asset_folders` is a self-referencing tree (parent = asset_folder_id,
 * same (id, is_published) composite key). `assets.asset_folder_id` places an
 * asset in a folder; NULL means the library root. Both tables are
 * organization-scoped; a child's FK only guarantees the parent exists in the
 * same draft/published side, not the same organization, so enforce org
 * equality in the write path.
 *
 * HARD-DELETE CAVEAT (both folder FKs use ON DELETE SET NULL): on a composite
 * key Postgres nulls EVERY referencing column, including `is_published`
 * (NOT NULL, part of the PK), so hard-deleting a folder that still has
 * children/assets fails. Soft deletes (`deleted_at`) are unaffected. Drizzle
 * cannot emit Postgres 15+'s column list, so after `drizzle-kit generate`
 * edit the generated migration so fk_asset_folders_parent and
 * fk_assets_asset_folder end with:
 *     ON DELETE SET NULL ("asset_folder_id")
 * (drizzle's snapshot is unaffected, so later generates stay clean).
 *
 * Extra-config callbacks return arrays (drizzle-orm v1), not keyed objects.
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "./auth-schema";

// ─── Asset folders ──────────────────────────────────────────────────────────

export const assetFolder = pgTable(
  "asset_folders",
  {
    id: uuid("id").defaultRandom().notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Parent folder; NULL = top level.
    assetFolderId: uuid("asset_folder_id"),
    name: text("name").notNull(),
    depth: integer("depth").notNull().default(0),
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
    foreignKey({
      name: "fk_asset_folders_parent",
      columns: [t.assetFolderId, t.isPublished],
      foreignColumns: [t.id, t.isPublished],
    }).onDelete("set null"),

    // Partial indexes — live (non-soft-deleted) rows only.
    index("asset_folders_organization_id_idx")
      .on(t.organizationId)
      .where(sql`${t.deletedAt} IS NULL`),
    index("asset_folders_parent_idx")
      .on(t.assetFolderId, t.isPublished)
      .where(sql`${t.deletedAt} IS NULL`),
    index("asset_folders_name_idx")
      .on(t.name, t.isPublished)
      .where(sql`${t.deletedAt} IS NULL`),

    // Unique id across live draft rows.
    uniqueIndex("asset_folders_draft_id_unique_idx")
      .on(t.id)
      .where(sql`${t.isPublished} = false AND ${t.deletedAt} IS NULL`),
  ],
).enableRLS();

// ─── Assets ─────────────────────────────────────────────────────────────────

export const asset = pgTable(
  "assets",
  {
    id: uuid("id").defaultRandom().notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Containing folder; NULL = library root.
    assetFolderId: uuid("asset_folder_id"),
    // Identifies where the asset was uploaded from.
    source: text("source").notNull().default("library"),
    filename: text("filename").notNull(),
    // Nullable for inline SVG assets.
    storagePath: text("storage_path"),
    // Nullable for inline SVG assets.
    publicUrl: text("public_url"),
    fileSize: integer("file_size"),
    mimeType: text("mime_type"),
    width: integer("width"),
    height: integer("height"),
    // Inline SVG content for icon assets.
    content: text("content"),
    // SHA-256 hex digest (64 chars) for change detection during publishing.
    contentHash: text("content_hash"),
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
      name: "fk_assets_asset_folder",
      columns: [t.assetFolderId, t.isPublished],
      foreignColumns: [assetFolder.id, assetFolder.isPublished],
    }).onDelete("set null"),

    // Partial indexes — live (non-soft-deleted) rows only.
    index("assets_asset_folder_id_idx")
      .on(t.assetFolderId, t.isPublished)
      .where(sql`${t.deletedAt} IS NULL`),
    index("assets_organization_id_idx")
      .on(t.organizationId)
      .where(sql`${t.deletedAt} IS NULL`),
    index("assets_filename_idx")
      .on(t.filename)
      .where(sql`${t.deletedAt} IS NULL`),
    index("assets_mime_type_idx")
      .on(t.mimeType)
      .where(sql`${t.deletedAt} IS NULL`),
    index("assets_source_idx")
      .on(t.source)
      .where(sql`${t.deletedAt} IS NULL`),
    index("assets_is_published_idx")
      .on(t.isPublished)
      .where(sql`${t.deletedAt} IS NULL`),

    // Unique id across live draft rows.
    uniqueIndex("assets_id_draft_unique_idx")
      .on(t.id)
      .where(sql`${t.isPublished} = false AND ${t.deletedAt} IS NULL`),
  ],
);

export type AssetRow = typeof asset.$inferSelect;
export type NewAssetRow = typeof asset.$inferInsert;
export type AssetFolderRow = typeof assetFolder.$inferSelect;
export type NewAssetFolderRow = typeof assetFolder.$inferInsert;
