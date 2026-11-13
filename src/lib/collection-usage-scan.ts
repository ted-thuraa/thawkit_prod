// path: src/lib/collection-usage-scan.ts

/**
 * Pure (React-free, DB-free, `server-only`-free) reference scanner behind the
 * CMS "where is this used?" checks. The DB-bound entry points
 * (`getCollectionUsage` / `getCollectionFieldUsage`) live in
 * `collection-usage-utils.ts`; keeping the scanning here makes it unit-testable
 * and importable from client code for the result types.
 *
 * WHY A KEY-AWARE DEEP WALK (and not fixed property paths)
 * ThawKit persists layer trees, page settings and component data as JSONB.
 * Collection / field ids are written into many shapes: `variables.collection`
 * on collection layers, `FieldVariable.data.field_id` inside dynamic text and
 * rich-text marks, conditional-visibility conditions, option-source and sort
 * settings, page `settings.cms`, … A scanner with one hard-coded path per
 * shape silently misses every shape added later (the Ycode original already
 * did: visibility conditions, option sources and count fields). Instead the
 * walk visits every node and matches a small, explicit set of *reference
 * keys*. Ids are UUIDs, so an equality match on a reference key cannot
 * produce a false positive from unrelated data.
 *
 * Nested serialized structures (a JSON document stored inside a string, as
 * rich-text values and some link values are) are parsed and walked too, with
 * hard depth / node budgets so malformed or hostile data cannot blow the stack
 * or the request.
 */

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface UsageEntry {
  id: string;
  name: string;
}

/** A collection field that depends on the target collection / field. */
export interface DependentFieldUsageEntry extends UsageEntry {
  collectionId: string;
  collectionName: string;
  /** `reference` / `multi_reference` / `count` — why it depends on the target. */
  fieldType: string;
}

/** @deprecated alias kept for existing consumers — use DependentFieldUsageEntry. */
export type ReferenceFieldUsageEntry = DependentFieldUsageEntry;

export interface CollectionUsageResult {
  pages: UsageEntry[];
  components: UsageEntry[];
  /** Reference, multi-reference and count fields pointing at the collection. */
  referenceFields: DependentFieldUsageEntry[];
  total: number;
}

export interface CollectionFieldUsageResult {
  pages: UsageEntry[];
  components: UsageEntry[];
  /** Count fields whose configuration points at this (reference) field. */
  dependentFields: DependentFieldUsageEntry[];
  total: number;
}

// ---------------------------------------------------------------------------
// Reference keys
// ---------------------------------------------------------------------------

/** Keys whose string value is a *collection* id. */
export const COLLECTION_ID_KEYS: ReadonlySet<string> = new Set([
  "collection_id", // page settings.cms, link/filters
  "collectionId", // optionsSource, count config, camelCase variables
  "referenceCollectionId", // visibility conditions on reference fields
  "sortByCollectionId", // option-source sort
  "reference_collection_id",
]);

/** Keys whose string value is a *field* id. */
export const FIELD_ID_KEYS: ReadonlySet<string> = new Set([
  "field_id", // FieldVariable.data, slug/title bindings
  "fieldId", // visibility conditions, count config, option source
  "source_field_id",
  "slug_field_id",
  "sort_by", // collection variable sort (field id | "none" | "manual")
  "sortFieldId",
  "sortByFieldId",
  "valueFieldId",
  "labelFieldId",
]);

/** Keys whose value is an array of field ids. */
const FIELD_ID_ARRAY_KEYS: ReadonlySet<string> = new Set(["sortByFieldIds"]);

export type ReferenceTarget =
  | { kind: "collection"; id: string }
  | { kind: "field"; id: string };

const MAX_DEPTH = 64;
const MAX_NODES = 250_000;
const MAX_SERIALIZED_DEPTH = 4;

interface Budget {
  nodes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksSerialized(value: string, id: string): boolean {
  // Cheap pre-filters before JSON.parse: must look like a document AND
  // contain the id at all (a substring miss means no nested reference).
  if (value.length < 2 || value.length > 5_000_000) return false;
  const first = value.charCodeAt(0);
  if (first !== 123 /* { */ && first !== 91 /* [ */) return false;
  return value.includes(id);
}

function walk(
  node: unknown,
  target: ReferenceTarget,
  depth: number,
  serializedDepth: number,
  budget: Budget,
): boolean {
  if (budget.nodes++ > MAX_NODES || depth > MAX_DEPTH) return false;

  if (typeof node === "string") {
    if (serializedDepth < MAX_SERIALIZED_DEPTH && looksSerialized(node, target.id)) {
      try {
        return walk(JSON.parse(node), target, depth + 1, serializedDepth + 1, budget);
      } catch {
        return false; // not JSON after all — plain text can't reference an id
      }
    }
    return false;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      if (walk(child, target, depth + 1, serializedDepth, budget)) return true;
    }
    return false;
  }

  if (!isRecord(node)) return false;

  for (const [key, value] of Object.entries(node)) {
    if (target.kind === "collection") {
      if (COLLECTION_ID_KEYS.has(key) && value === target.id) return true;
      // CollectionVariable lives at `variables.collection` as `{ id, ... }`.
      if (key === "collection" && isRecord(value) && value.id === target.id) {
        return true;
      }
    } else {
      if (FIELD_ID_KEYS.has(key) && value === target.id) return true;
      if (
        FIELD_ID_ARRAY_KEYS.has(key) &&
        Array.isArray(value) &&
        value.includes(target.id)
      ) {
        return true;
      }
    }
    if (walk(value, target, depth + 1, serializedDepth, budget)) return true;
  }
  return false;
}

/**
 * True when `data` (any JSON-ish value: layer tree, page settings, component
 * row fragment, …) references the target collection or field. Malformed input
 * (null, primitives, cycles, absurd depth) returns false rather than throwing.
 */
export function referencesTarget(
  data: unknown,
  target: ReferenceTarget,
): boolean {
  if (!target.id) return false;
  return walk(data, target, 0, 0, { nodes: 0 });
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export interface ScannableRow {
  id: string;
  name: string;
  /** Every JSON column that can hold bindings (layers, settings, variants…). */
  data: unknown[];
}

/**
 * Returns the rows that reference the target, de-duplicated by id (a row is
 * reported once however many bindings it contains) and sorted by name so the
 * UI list is stable.
 */
export function scanRows(
  rows: ReadonlyArray<ScannableRow>,
  target: ReferenceTarget,
): UsageEntry[] {
  const found = new Map<string, UsageEntry>();
  for (const row of rows) {
    if (found.has(row.id)) continue;
    if (row.data.some((d) => referencesTarget(d, target))) {
      found.set(row.id, { id: row.id, name: row.name });
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export interface FieldDependencyRow {
  id: string;
  name: string;
  type: string;
  collectionId: string;
  collectionName: string;
  referenceCollectionId: string | null;
  data: unknown;
}

/** Fields that depend on a collection: reference / multi-reference / count. */
export function fieldsDependingOnCollection(
  rows: ReadonlyArray<FieldDependencyRow>,
  collectionId: string,
): DependentFieldUsageEntry[] {
  const out = new Map<string, DependentFieldUsageEntry>();
  for (const f of rows) {
    // A collection's own self-reference doesn't block deleting it.
    if (f.collectionId === collectionId) continue;
    const viaReference = f.referenceCollectionId === collectionId;
    const viaCount =
      f.type === "count" &&
      referencesTarget(f.data, { kind: "collection", id: collectionId });
    if (viaReference || viaCount) {
      out.set(f.id, {
        id: f.id,
        name: f.name,
        collectionId: f.collectionId,
        collectionName: f.collectionName,
        fieldType: viaReference ? f.type : "count",
      });
    }
  }
  return [...out.values()];
}

/** Count fields whose config points at the given (reference) field. */
export function countFieldsDependingOnField(
  rows: ReadonlyArray<FieldDependencyRow>,
  fieldId: string,
): DependentFieldUsageEntry[] {
  const out: DependentFieldUsageEntry[] = [];
  for (const f of rows) {
    if (f.type !== "count" || f.id === fieldId) continue;
    if (referencesTarget(f.data, { kind: "field", id: fieldId })) {
      out.push({
        id: f.id,
        name: f.name,
        collectionId: f.collectionId,
        collectionName: f.collectionName,
        fieldType: "count",
      });
    }
  }
  return out;
}
