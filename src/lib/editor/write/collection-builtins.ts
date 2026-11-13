// path: src/lib/editor/write/collection-builtins.ts

/**
 * Built-in field definitions for new collections. Pure (no I/O) so the
 * mutation layer, the sample service and tests share one definition.
 *
 * Differences from Ycode: there is NO computed "Status" field. Per-item
 * draft / staged / published status is a draft-specific CMS capability that
 * ThawKit intentionally does not carry; publishing is a funnel-level concern
 * handled by the publish pipeline (the `(id, is_published)` row model stays).
 */

import type { CollectionFieldType } from "@/types/funnel";

export interface BuiltInFieldDefinition {
  name: string;
  key: string;
  type: CollectionFieldType;
  fillable: boolean;
  hidden: boolean;
}

/** Built-ins placed before custom fields. */
export const BUILT_IN_FIELDS_START: readonly BuiltInFieldDefinition[] = [
  { name: "ID", key: "id", type: "number", fillable: false, hidden: false },
  { name: "Name", key: "name", type: "text", fillable: true, hidden: false },
  { name: "Slug", key: "slug", type: "text", fillable: true, hidden: false },
];

/** Built-ins kept after custom fields. */
export const BUILT_IN_FIELDS_END: readonly BuiltInFieldDefinition[] = [
  {
    name: "Created Date",
    key: "created_at",
    type: "date",
    fillable: false,
    hidden: false,
  },
  {
    name: "Updated Date",
    key: "updated_at",
    type: "date",
    fillable: false,
    hidden: false,
  },
];

/** Keys of server-maintained built-ins that clients may never write. */
export const SYSTEM_FIELD_KEYS: ReadonlySet<string> = new Set([
  "id",
  "created_at",
  "updated_at",
]);

/** Built-ins of a brand-new collection, ordered sequentially. */
export function getNewCollectionBuiltInFields(): Array<
  BuiltInFieldDefinition & { order: number }
> {
  return [...BUILT_IN_FIELDS_START, ...BUILT_IN_FIELDS_END].map(
    (field, order) => ({ ...field, order }),
  );
}

/**
 * Serializes a form value to its stored text form. `null` means "no value"
 * (the value row is removed). Objects / arrays (rich-text documents, multi
 * reference and multi-asset lists) are JSON-encoded; booleans become
 * "true" / "false".
 */
export function serializeItemValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value === "" ? null : value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(value);
}

/** Next unique value for `base` among `existing` (case-insensitive) — "Foo", "Foo 2". */
export function uniqueName(base: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}
