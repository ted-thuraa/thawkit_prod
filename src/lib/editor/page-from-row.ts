// path: src/lib/editor/page-from-row.ts

import type { Layer, Page, PageSettings } from "@/types/funnel";
import type { PageRow } from "@/lib/editor/resolve-editor-bootstrap";

/**
 * Boundary mapper: the server bootstrap hands the client raw Drizzle rows
 * (`PageRow`), while every editor store/component speaks `Page`. Both are
 * camelCase; the only real differences are that the row's `settings` is
 * `unknown` (jsonb) and its `layers` may be absent/`null` on legacy rows.
 * `PageRow` must not leak past this function into store contracts.
 */
export function pageFromRow(row: PageRow): Page {
  const rawSettings: unknown = row.settings;
  const settings: PageSettings =
    rawSettings !== null && typeof rawSettings === "object"
      ? (rawSettings as PageSettings)
      : {};
  const layers: Layer[] = Array.isArray(row.layers) ? row.layers : [];

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    funnelId: row.funnelId,
    order: row.order,
    depth: row.depth,
    pageType: row.pageType,
    isDynamic: row.isDynamic,
    layers,
    settings,
    contentHash: row.contentHash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
  };
}

export function pagesFromRows(rows: readonly PageRow[]): Page[] {
  return rows.map(pageFromRow);
}
