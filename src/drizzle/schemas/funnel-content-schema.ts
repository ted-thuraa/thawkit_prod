// db/schemas/funnel-content-schema.ts

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Core domain tables sitting below `funnels` (campaigns-schema.ts) — pages,
 * question categories, audiences, and immutable publish-time snapshots.
 * Together with `funnels`, these are what the compiler
 * (db/compiler/compileFunnelPayload.ts) reassembles into the exact
 * `funnelPayloadSchema` shape the frontend already consumes via
 * `initFunnel(schema)` in store.ts.
 *
 * DECISION (this session): `sections` is stored as a JSON column directly
 * on `pages`, NOT as its own relational table. Nothing outside a section's
 * own page ever references or queries a section independently:
 *   - Every BranchTarget in the schema targets a *page*
 *     (`{ type: "page"; pageId }`), never a section.
 *   - `answers`/`answer_selections` (Phase 4) key on sectionId as a frozen
 *     snapshot reference tied to a funnel_version, not a live FK into an
 *     editable row.
 *   - Every current frontend read (funnelContainer.tsx's
 *     `activePage.sections.map(...)`, helpers.ts's
 *     `schema.pages.flatMap(p => p.sections)`) pulls the WHOLE array per
 *     page — nothing queries "section X in isolation" as its own lookup.
 * A JSON column also makes the mutable draft shape here structurally
 * identical to `funnel_versions.compiledSchema`'s immutable published-
 * snapshot shape, which removes a real chunk of reshaping logic from the
 * compiler (draft and snapshot are the same tree, one is just frozen).
 *
 * The one thing this trades away — SQL-level "find every section using
 * template X across the workspace" — isn't needed by anything in the
 * current roadmap, and is cheap to add later via `jsonb`'s GIN indexing
 * and containment queries if that ever changes.
 *
 * TENANCY: none of these tables carry their own organizationId. They are
 * always reached through `funnelId`, and `funnels.organizationId` (Phase 2)
 * is the single source of truth for tenant scope. Duplicating
 * organizationId down here would just be a second place for it to drift
 * out of sync — every query in this domain should join through `funnels`
 * (see db/queries/tenant-scope.ts's pattern), never trust an independent
 * tenant column at this level.
 *
 * Postgres port — see the header of auth-schema.ts for the column-type
 * rationale. Extra-config callbacks return arrays (drizzle-orm v1), not
 * keyed objects.
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
// RESTORED — this was commented out but `funnel.id` is referenced live
// below in three .references() calls. The file could not have compiled
// without it. This requires `funnel` to be an ACTIVE export from
// campaigns-schema.ts — see the note at the end of this reply.
import { funnel } from "./campaigns-schema";

import { Layer, PageType } from "@/types/funnel";

// ─── Funnel Versions (immutable publish snapshots) ─────────────────────────
//
// Solves architecture roadmap Module 2's draft-vs-published requirement:
// `funnels` / `pages` / `question_categories` / `audiences` are the MUTABLE
// DRAFT the builder edits; a row here is a frozen, point-in-time
// compilation of that draft, produced by compileFunnelPayload() at publish
// time. Submissions (Phase 4) will reference a specific funnel_version,
// never the live draft directly — so editing scoring weights on a live
// funnel after submissions already exist can never retroactively corrupt a
// past respondent's already-computed score.

export const funnelVersions = pgTable(
  "funnel_version",
  {
    id: text("id").primaryKey(),
    funnelId: text("funnel_id")
      .notNull()
      .references(() => funnel.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    // The compiled, published-shape payload — the frozen equivalent of this
    // funnel's `pages` (now layer-tree-based) at publish time.
    compiledSchema: jsonb("compiled_schema").notNull(),
    isCurrent: boolean("is_current").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("version_funnel_idx").on(t.funnelId),
    uniqueIndex("version_funnel_number_idx").on(t.funnelId, t.versionNumber),
    index("version_current_idx").on(t.funnelId, t.isCurrent),
  ],
);

// ─── Pages ──────────────────────────────────────────────────────────────────
//
// NAMED `page` (singular), table "pages" (plural) — matches the
// campaign/"campaigns" and funnel/"funnels" pattern already used in
// campaigns-schema.ts. See the naming-convention discussion in the reply
// this file was delivered with.

export const pageTypeValues = [
  "landing_page",
  "normal_page",
  "result_page",
] as const;
export type PageTypeValue = (typeof pageTypeValues)[number];

export const pageType = pgEnum("page_type", pageTypeValues);

export const page = pgTable(
  "pages",
  {
    id: text("id").primaryKey(),
    funnelId: text("funnel_id")
      .notNull()
      .references(() => funnel.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    order: integer("order").notNull(),
    depth: integer("depth").default(0),
    pageType: pageType("page_type").notNull().$type<PageType>(),
    contentHash: text("content_hash"), // SHA-256 hash for change detection
    isDynamic: boolean("is_dynamic").notNull().default(false),
    settings: jsonb("settings").default("{}"),
    layers: jsonb("layers").notNull().$type<Layer[]>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [
    index("page_funnel_idx").on(t.funnelId),
    uniqueIndex("page_funnel_slug_idx").on(t.funnelId, t.slug),
    index("page_funnel_order_idx").on(t.funnelId, t.order),
  ],
);

// ─── Question Categories ───────────────────────────────────────────────────
//
// Kept relational (NOT folded into JSON), unlike sections — because,
// unlike a section, a category's id IS referenced independently from
// multiple places outside its own authoring context:
//   - Quiz sections reference categories via `content.categoryIds: string[]`
//   - Audience conditions reference categories via `category_rank` /
//     `category_score` conditions' `categoryId` field
//   - DetailedCategoryResults iterates `questionCategories` directly at the
//     funnel root to decide how many cards to render and in what order
// A stable, independently addressable identity is exactly what a
// relational row buys you that a JSON blob under some other row wouldn't.
//
// Still WIP — left commented, syntax converted to Postgres so it's ready
// when you restore it.

// export const questionCategories = pgTable(
//   "question_category",
//   {
//     // Builder-generated, expected to be globally unique — NOT derived from
//     // the title. Two different funnels/workspaces might both legitimately
//     // want a category called "About you"; a human-readable slug-style id
//     // (as the current mock uses, e.g. "About_you") is not guaranteed
//     // unique across funnels, so the builder must mint a real unique id
//     // (e.g. a ULID/UUID) and use that consistently everywhere a
//     // `categoryId` is referenced.
//     id: text("id").primaryKey(),
//     funnelId: text("funnel_id")
//       .notNull()
//       .references(() => funnel.id, { onDelete: "cascade" }),
//     // The mock's category ARRAY ORDER is meaningful (drives
//     // DetailedCategoryResults card order) but has no equivalent in a
//     // relational row without an explicit column — insertion order alone
//     // gives no ordering guarantee.
//     order: integer("order").notNull(),
//     title: text("title").notNull(),
//     description: text("description"),
//     icon: text("icon"), // emoji or design-system icon_id
//   },
//   (t) => [
//     index("category_funnel_idx").on(t.funnelId),
//     index("category_funnel_order_idx").on(t.funnelId, t.order),
//   ],
// );

// ─── Audiences ──────────────────────────────────────────────────────────────
//
// Same reasoning as question_categories: audience IDs are referenced from
// `section.visibility.audienceIds` independently of the audience's own
// authoring context, so they need a stable identity a JSON blob elsewhere
// wouldn't give them. The predicate TREE itself, however, is pure
// author-time config evaluated wholesale in JS
// (evaluateAudiencePredicate in helpers.ts) — same JSON-blob reasoning as
// `sections`, just one level up the schema.
//
// Still WIP — left commented. NOTE: `AudiencePredicate` isn't imported in
// this file yet; add it alongside `Layer, PageType` above when you
// restore this block.

// export const audiences = pgTable(
//   "audience",
//   {
//     id: text("id").primaryKey(),
//     funnelId: text("funnel_id")
//       .notNull()
//       .references(() => funnel.id, { onDelete: "cascade" }),
//     name: text("name").notNull(),
//     description: text("description"),
//     predicate: jsonb("predicate").notNull().$type<AudiencePredicate>(),
//     retroactive: boolean("retroactive").notNull().default(false),
//     createdAt: timestamp("created_at", { withTimezone: true })
//       .defaultNow()
//       .notNull(),
//   },
//   (t) => [index("audience_funnel_idx").on(t.funnelId)],
// );
