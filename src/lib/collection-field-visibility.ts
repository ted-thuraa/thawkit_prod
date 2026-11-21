// path: src/lib/collection-field-visibility.ts

import type {
  CollectionField,
  FieldVisibilityCondition,
} from "@/types/funnel";

/**
 * Conditional field display for the CMS item editor (`CollectionFieldData.showWhen`).
 * Pure — no React, no stores. Generic: knows nothing about quizzes.
 */

type VisibilityField = Pick<CollectionField, "id" | "type" | "data" | "default">;

const norm = (s: string) => s.trim().toLowerCase();

/** The comparable value of a source field given the current form values. */
function comparableValue(
  source: VisibilityField,
  raw: unknown,
): string {
  const text =
    raw === undefined || raw === null
      ? ""
      : typeof raw === "string"
        ? raw
        : String(raw);

  if (source.type === "boolean") {
    // Absent ⇒ false; accepts "true"/"1"/true.
    const t = text.trim().toLowerCase();
    return t === "true" || t === "1" ? "true" : "false";
  }
  if (source.type === "option") {
    const label = norm(text);
    const match = source.data?.options?.find((o) => norm(o.name) === label);
    // Unknown label: fall back to the raw text so a machine id still matches.
    return match ? match.id : text.trim();
  }
  return text.trim();
}

function conditionHolds(
  condition: FieldVisibilityCondition,
  fieldsById: ReadonlyMap<string, VisibilityField>,
  values: Readonly<Record<string, unknown>>,
): boolean {
  const source = fieldsById.get(condition.fieldId);
  // Fail open: a missing/deleted source must never make a field unreachable.
  if (!source) return true;
  return condition.equals.includes(comparableValue(source, values[source.id]));
}

/**
 * Whether `field` should be shown given the current values (keyed by field id).
 * No `showWhen` ⇒ always shown. Multiple conditions are ANDed.
 */
export function isFieldVisible(
  field: Pick<CollectionField, "data">,
  fieldsById: ReadonlyMap<string, VisibilityField>,
  values: Readonly<Record<string, unknown>>,
): boolean {
  const conditions = field.data?.showWhen;
  if (!conditions || conditions.length === 0) return true;
  return conditions.every((c) => conditionHolds(c, fieldsById, values));
}

export function indexFieldsById<T extends VisibilityField>(
  fields: readonly T[],
): Map<string, T> {
  return new Map(fields.map((f) => [f.id, f]));
}
