// path: src/drizzle/schema.ts

/**
 * ─── Schema Barrel ──────────────────────────────────────────────────────────
 *
 * TABLES ONLY. Two changes from the previous version:
 *
 *   1. `export * from "./schemas/relations"` is GONE. Under Relational
 *      Queries v2 the relation graph is built by `defineRelations(schema)` —
 *      which imports *this* file. Re-exporting relations from here would
 *      create an import cycle and would feed relation objects back into the
 *      very object `defineRelations` is trying to read tables out of.
 *      The graph now lives at `src/drizzle/relations.ts` (sibling of db.ts).
 *
 *   2. `funnel-content-schema` was listed twice — deduped.
 *
 * This barrel is still what better-auth's `drizzleAdapter({ schema })`
 * consumes, and it is what `drizzle-kit`'s `schema` glob should resolve to.
 * The KEYS of this module are what become `db.query.<key>` — so
 * `export const campaign` ⇒ `db.query.campaign`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export * from "./schemas/auth-schema";
export * from "./schemas/campaigns-schema";
export * from "./schemas/funnel-content-schema";
export * from "./schemas/design-system-schema";
export * from "./schemas/runtime-schema";
