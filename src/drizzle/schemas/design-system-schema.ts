// path: src/drizzle/schemas/design-system-schema.ts

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Organization-scoped, reusable editor design assets: `component` (a
 * saved, reusable Layer subtree — Ycode's "Component") and `layer_style`
 * (a reusable combo-class chip — Ycode's "LayerStyle"). Ported from Ycode
 * (github.com/ycode/ycode, MIT licensed), see types/PageCMS/layerSchema.ts
 * for the shared `Layer`/`DesignProperties`/`LayerStyle`/`Component` types.
 *
 * TENANCY (deliberately different pattern than funnel-content-schema.ts):
 * these carry a DIRECT `organizationId` FK, the same pattern
 * campaigns-schema.ts's `campaign` table uses, rather than the "always
 * reached through funnelId" indirect pattern the rest of the funnel
 * content domain uses. That's intentional, not an inconsistency — a
 * component or style here is meant to be reusable across every campaign
 * and funnel in a workspace (a shared design-system asset), not content
 * that belongs to one funnel. Scoping it through `funnelId` would make
 * reuse across funnels impossible without either duplicating the row per
 * funnel or introducing a many-to-many join table; a direct org FK is the
 * simpler, correct model for something explicitly meant to be shared
 * workspace-wide.
 *
 * VERSIONING: unlike Ycode's own `Component`/`LayerStyle`, these tables
 * carry no `content_hash`/`is_published`/`deleted_at`. Ycode needs those
 * because a component/style row there is both its own draft and its own
 * live copy (the same dual-row shadow pattern its `pages`/`page_layers`
 * use). Thawkit's publish model is different: `pages` (and therefore
 * anything a page's layer tree references, including component/style ids)
 * is always the mutable draft, and `funnel_versions.compiledSchema`
 * (funnel-content-schema.ts) is the immutable publish snapshot — captured
 * at publish time by compileFunnelPayload(), which resolves component
 * instances and style stacks into the frozen tree. These rows never need
 * their own publish state as a result.
 *
 * Postgres port — see the header of auth-schema.ts for the column-type
 * rationale (text over varchar, timestamptz over bare timestamp, jsonb
 * over json, pgEnum over mysqlEnum). Extra-config callbacks return arrays
 * (drizzle-orm v1), not keyed objects.
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { organization } from "./auth-schema";
import type {
  Layer,
  ComponentVariant,
  ComponentVariable,
  DesignProperties,
} from "@/types/funnel";

export const layerStyleKindValues = ["base", "combo", "global"] as const;
export type LayerStyleKindValue = (typeof layerStyleKindValues)[number];

export const layerStyleKind = pgEnum("layer_style_kind", layerStyleKindValues);

// ─── Components (reusable layer trees) ──────────────────────────────────────

export const component = pgTable(
  "component",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    layers: jsonb("layers").notNull().$type<Layer[]>(),
    variants: jsonb("variants").$type<ComponentVariant[]>(),
    variables: jsonb("variables").$type<ComponentVariable[]>(),
    thumbnailUrl: text("thumbnail_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("component_org_idx").on(t.organizationId)],
);

// ─── Layer Styles (reusable combo-class chips) ──────────────────────────────

export const layerStyle = pgTable(
  "layer_style",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),

    styleGroup: text("style_group"),

    kind: layerStyleKind("kind"),

    classes: text("classes").notNull().default(""),
    design: jsonb("design").$type<DesignProperties>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("layer_style_org_idx").on(t.organizationId)],
);
