/**
 * Grid span CMS bindings
 *
 * A grid child's column/row span can be bound to a CMS field so each collection
 * item takes its own span. The bound value replaces the layer's base (desktop,
 * neutral state) span class, so breakpoint classes like `max-md:col-span-1`
 * keep overriding it on smaller screens.
 */

import type { FieldVariable, Layer, LayerVariables } from "@/types/funnel";

export type GridSpanBindingKey = "gridColumnSpan" | "gridRowSpan";

const GRID_SPAN_CLASS_PREFIX: Record<GridSpanBindingKey, string> = {
  gridColumnSpan: "col-span-",
  gridRowSpan: "row-span-",
};

export const GRID_SPAN_BINDING_KEYS = Object.keys(
  GRID_SPAN_CLASS_PREFIX,
) as GridSpanBindingKey[];

/** Span values Tailwind ships: 1–12 and `full` */
const GRID_SPAN_VALUES = [
  ...Array.from({ length: 12 }, (_, i) => String(i + 1)),
  "full",
];

/** True for design binding keys that hold a grid span field binding */
export function isGridSpanBindingKey(key: string): key is GridSpanBindingKey {
  return key in GRID_SPAN_CLASS_PREFIX;
}

/**
 * Normalize a CMS value to a span token ('1'–'12' or 'full'), or null when invalid.
 * Accepts numbers and option names such as "3", "Span 3" or "Full".
 */
export function resolveGridSpanToken(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const token = String(raw)
    .trim()
    .toLowerCase()
    .replace(/^span\s*/, "");
  return GRID_SPAN_VALUES.includes(token) ? token : null;
}

/**
 * Replace the base span class with each bound field's resolved value.
 * Prefixed classes (breakpoints, states) are kept; when a field is empty or
 * invalid the static class stays as the fallback.
 */
export function applyGridSpanBindings(
  classes: string,
  design: LayerVariables["design"],
  resolveField: (fieldVar: FieldVariable) => unknown,
): string {
  if (!design) return classes;

  let tokens: string[] | null = null;
  for (const key of GRID_SPAN_BINDING_KEYS) {
    const binding = design[key];
    if (!binding?.data?.field_id) continue;

    const span = resolveGridSpanToken(resolveField(binding));
    if (!span) continue;

    const prefix = GRID_SPAN_CLASS_PREFIX[key];
    tokens = (tokens ?? classes.split(/\s+/).filter(Boolean)).filter(
      (cls) => !cls.startsWith(prefix),
    );
    tokens.push(`${prefix}${span}`);
  }

  return tokens ? tokens.join(" ") : classes;
}

/** Every span class a span-bound layer can render, so stored CSS includes them */
export function getGridSpanBindingClasses(layer: Layer): string[] {
  const design = layer.variables?.design;
  if (!design) return [];

  return GRID_SPAN_BINDING_KEYS.filter(
    (key) => design[key]?.data?.field_id,
  ).flatMap((key) =>
    GRID_SPAN_VALUES.map((value) => `${GRID_SPAN_CLASS_PREFIX[key]}${value}`),
  );
}
