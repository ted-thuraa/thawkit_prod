// path: src/lib/editor/insert-template.ts

import type { Layer } from "@/types/funnel";
import { getBlockName, getLayerFromTemplate } from "@/lib/templates/blocks";
import {
  collectAllSettingsIds,
  normalizeTemplateSettingsIds,
} from "@/lib/layer-utils";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Single resolver for "Elements" tab insertions.
 *
 * The Element Library catalog is built from the block registry
 * (`lib/templates/blocks`), so insertion MUST resolve templates from that same
 * registry. A second, smaller factory (`element-templates.ts`, 14 types) used
 * to back `addLayerFromTemplate`; every catalog entry it didn't know about
 * (container, columns, rows, grid, table parts, ...) silently returned `null`
 * and nothing was inserted.
 *
 * Pure: no store, no React. Given a template key and the page's current layer
 * tree it returns a ready-to-insert subtree with
 *   - fresh `id` on every node (done by `getLayerFromTemplate`)
 *   - `settings.id` values unique against the page, label `for` remapped
 *   - `classes` persisted in string form
 *   - a display `customName` on the root
 * or `null` when the key is not in the registry.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * Template keys that produce a form-control wrapper (label + input). New
 * fields of these kinds are placed next to a sibling field when inserted into
 * a form, rather than nested inside the previously selected field's wrapper.
 */
const FORM_FIELD_TEMPLATE_IDS: ReadonlySet<string> = new Set([
  "input",
  "textarea",
  "select",
  "checkbox",
  "radio",
]);

export function isFormFieldTemplate(templateId: string): boolean {
  return FORM_FIELD_TEMPLATE_IDS.has(templateId);
}

/** Persisted layers store `classes` as a string; some templates use arrays. */
function normalizeClasses(layer: Layer): Layer {
  const next: Layer = { ...layer };
  if (Array.isArray(next.classes)) {
    next.classes = next.classes.join(" ");
  }
  if (next.children) {
    next.children = next.children.map(normalizeClasses);
  }
  return next;
}

/**
 * Build a ready-to-insert layer subtree for `templateId`, or `null` when the
 * key is not a known template.
 */
export function buildLayerFromTemplate(
  templateId: string,
  existingLayers: Layer[],
): Layer | null {
  const template = getLayerFromTemplate(templateId);
  if (!template) return null;

  let layer = normalizeClasses(template);
  layer = normalizeTemplateSettingsIds(
    layer,
    collectAllSettingsIds(existingLayers),
  );

  // Display label only. `name` stays the lowercase element type because every
  // structural check (canHaveChildren, section-at-body, renderer) keys off it.
  // Plain divs stay unnamed, and form-field wrappers show as a plain block.
  const displayName =
    templateId === "div" || isFormFieldTemplate(templateId)
      ? undefined
      : (getBlockName(templateId) ?? undefined);

  return displayName ? { ...layer, customName: displayName } : layer;
}
