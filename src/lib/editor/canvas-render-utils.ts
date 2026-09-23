// path: src/lib/editor/canvas-render-utils.ts

import type { Layer } from "@/types/funnel";
import type { LayerStyleRow } from "@/lib/editor/resolve-editor-bootstrap";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Rendering-time helpers for the canvas. Ported/adapted from Ycode's
 * lib/layer-utils.ts (github.com/ycode/ycode, MIT licensed).
 *
 * ONE IMPORTANT FINDING from researching this phase, worth recording:
 * Ycode's `DesignProperties` object (ported into layerSchema.ts back in
 * Phase 1) is NOT what the renderer reads to produce styling. Tracing
 * `getClassesString` (layer-utils.ts) shows it's a trivial join of
 * `layer.classes` — the canonical rendering source is a plain Tailwind
 * utility-class string, compiled to real CSS at runtime by the Tailwind
 * CDN script running inside the iframe (see EditorBuilder.tsx). The only
 * "design -> CSS" resolver that exists (`resolveDesignStyles`,
 * lib/variable-utils.ts) turns out to be narrowly about CMS-bound color
 * VARIABLE bindings, not a general compiler. The practical implication:
 * `DesignProperties` is a structured, RightPanel-facing shadow of the
 * classes — useful once form controls read/write it (Phase 8+, deferred),
 * but the canvas renderer itself never needs to interpret it. This file
 * only ever touches `layer.classes` and the LayerStyle stack.
 *
 * `getLayerHtmlTag` below is ported directly, pruned of the excluded
 * widget families (map, slider/slides/lightbox, localeSelector, filter).
 *
 * `resolveLayerClasses`, by contrast, is NOT verified against a located
 * Ycode implementation — `styleIds`/`styleOverridesByStyle` never
 * appeared in layer-utils.ts, and finding wherever Ycode actually resolves
 * its style stack (likely inline within LayerRenderer.tsx's 3,803 lines)
 * wasn't tractable in the time available for this pass. This function
 * instead implements exactly the priority order already documented on
 * `Layer.styleIds`/`styleOverrides`/`styleOverridesByStyle` in
 * layerSchema.ts: base classes, then each styleId's classes in stack
 * order (overridden per-style via `styleOverridesByStyle` when present),
 * then the layer-level `styleOverrides.classes` last, highest priority.
 * Flagging this explicitly as designed-to-spec rather than
 * verified-against-source, unlike the rest of this file.
 * ─────────────────────────────────────────────────────────────────────────
 */

const LAYER_NAME_TO_HTML_TAG: Record<string, string> = {
  // Content
  text: "p",
  heading: "h2",
  richText: "div",
  span: "span",
  label: "label",

  // Media
  image: "img",
  icon: "span",
  video: "video",
  audio: "audio",

  // Structure (valid HTML tags — pass through via fallback): div, section,
  // form, button, hr, iframe, input, textarea, select

  // Table
  table: "table",
  thead: "thead",
  tbody: "tbody",
  tr: "tr",
  td: "td",
  th: "th",

  // Embedded
  htmlEmbed: "div",

  // Checkbox / radio (the input itself is valid HTML; these are layer-tree names)
  checkbox: "input",
  radio: "input",

  // Excluded widget families, NOT ported: map, slider/slides/slide/
  // slideNavigationWrapper/slideButtonPrev/slideButtonNext/
  // slidePaginationWrapper/slideBullets/slideBullet/slideFraction,
  // lightbox, localeSelector, filter.
};

export function getLayerHtmlTag(layer: Layer): string {
  if (layer.id === "body" || layer.name === "body") {
    return "div";
  }
  if (layer.settings?.tag) {
    return layer.settings.tag;
  }
  return LAYER_NAME_TO_HTML_TAG[layer.name] ?? layer.name ?? "div";
}

export function getClassesString(layer: Layer): string {
  return Array.isArray(layer.classes)
    ? layer.classes.join(" ")
    : layer.classes || "";
}

/**
 * Resolve a layer's final Tailwind class string: base classes, the
 * applied LayerStyle stack (in order, with per-style overrides), then the
 * layer-level override last. See file header for the priority order this
 * implements and its provenance.
 */
export function resolveLayerClasses(
  layer: Layer,
  layerStylesById: Map<string, LayerStyleRow>,
): string {
  const parts: string[] = [getClassesString(layer)];

  for (const styleId of layer.styleIds ?? []) {
    const override = layer.styleOverridesByStyle?.[styleId]?.classes;
    if (override) {
      parts.push(override);
      continue;
    }
    const style = layerStylesById.get(styleId);
    if (style?.classes) parts.push(style.classes);
  }

  if (layer.styleOverrides?.classes) {
    parts.push(layer.styleOverrides.classes);
  }

  return parts.filter(Boolean).join(" ");
}

/** Layer types that never take children — mirrors canHaveChildren's leaf list (layer-tree-utils.ts) but exported separately since the renderer needs it for a different purpose (deciding whether to render `layer.content` as text vs. recurse into `layer.children`), not tree-mutation validation. */
export const TEXT_BEARING_LAYER_NAMES = [
  "text",
  "heading",
  "richText",
  "span",
  "label",
];
