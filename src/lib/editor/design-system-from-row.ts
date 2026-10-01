// path: src/lib/editor/design-system-from-row.ts

import type { Component, LayerStyle } from "@/types/funnel";
import type {
  ComponentRow,
  LayerStyleRow,
} from "@/lib/editor/resolve-editor-bootstrap";

/**
 * Boundary mappers: the server bootstrap hands the client raw Drizzle rows
 * (nullable jsonb/enum columns, timestamps), while editor stores speak the
 * domain types `Component` / `LayerStyle`. Rows must not leak past here.
 */
export function componentFromRow(row: ComponentRow): Component {
  return {
    id: row.id,
    name: row.name,
    layers: Array.isArray(row.layers) ? row.layers : [],
    variants: row.variants ?? undefined,
    variables: row.variables ?? undefined,
    thumbnailUrl: row.thumbnailUrl,
  };
}

export function componentsFromRows(rows: readonly ComponentRow[]): Component[] {
  return rows.map(componentFromRow);
}

export function layerStyleFromRow(row: LayerStyleRow): LayerStyle {
  return {
    id: row.id,
    name: row.name,
    styleGroup: row.styleGroup ?? undefined,
    kind: row.kind ?? undefined,
    classes: row.classes,
    design: row.design ?? undefined,
  };
}

export function layerStylesFromRows(
  rows: readonly LayerStyleRow[],
): LayerStyle[] {
  return rows.map(layerStyleFromRow);
}
