// path: src/lib/editor/bootstrap/collect-asset-ids.ts

/**
 * Finds every asset id a funnel's content references, so the bootstrap can
 * load exactly those assets (plus the library's first page) instead of the
 * whole library.
 *
 * Pure and isomorphic. Defensive by design: layer trees are free-form jsonb
 * written by many editor features over time, so this scans structurally
 * rather than trusting a schema, and validates every candidate as a UUID —
 * `assets.id` is a Postgres `uuid`, and a single non-UUID string (an external
 * URL in `lightbox.files`, a legacy id) would otherwise make the whole
 * `IN (...)` query throw.
 *
 * Reference shapes recognised:
 *   - AssetVariable:           { type: "asset", data: { asset_id } }
 *   - any `asset_id` / `assetId` string property
 *   - link settings:           { asset: { id } }
 *   - lightbox / file lists:   { files: string[] }
 *   - CMS values of image / audio / video / document fields: a single id, or
 *     a JSON array of ids (multi-asset); and link-field JSON values with
 *     `{ asset: { id } }`.
 *
 * Known gap: asset ids embedded inside rich-text HTML are not extracted.
 * They are covered by the on-demand fetch path, not the preload.
 */

import type { CollectionField } from "@/types/funnel";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

const ASSET_FIELD_TYPES = new Set(["image", "audio", "video", "document"]);

function add(out: Set<string>, candidate: unknown): void {
  if (isUuid(candidate)) out.add(candidate.toLowerCase());
}

/** Iterative deep scan — layer trees can be deep, so no recursion. */
export function collectAssetIdsFromJson(
  root: unknown,
  out: Set<string> = new Set(),
): Set<string> {
  const stack: unknown[] = [root];

  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== "object") continue;

    if (Array.isArray(node)) {
      for (const child of node) stack.push(child);
      continue;
    }

    const record = node as Record<string, unknown>;

    // AssetVariable
    if (record.type === "asset") {
      const data = record.data as Record<string, unknown> | undefined;
      add(out, data?.asset_id);
    }

    for (const [key, value] of Object.entries(record)) {
      if (key === "asset_id" || key === "assetId") {
        add(out, value);
      } else if (key === "asset" && value && typeof value === "object") {
        add(out, (value as Record<string, unknown>).id);
      } else if (key === "files" && Array.isArray(value)) {
        for (const entry of value) add(out, entry);
      }

      if (value !== null && typeof value === "object") stack.push(value);
    }
  }

  return out;
}

/** Ids referenced by a CMS value, given the field it belongs to. */
function collectAssetIdsFromValue(
  fieldType: string,
  value: string,
  out: Set<string>,
): void {
  if (ASSET_FIELD_TYPES.has(fieldType)) {
    const trimmed = value.trim();
    if (trimmed.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (Array.isArray(parsed)) for (const id of parsed) add(out, id);
      } catch {
        // Malformed multi-asset value — nothing to preload.
      }
    } else {
      add(out, trimmed);
    }
    return;
  }

  if (fieldType === "link" && value.trim().startsWith("{")) {
    try {
      collectAssetIdsFromJson(JSON.parse(value), out);
    } catch {
      // Not JSON (a plain URL, say) — nothing to preload.
    }
  }
}

export interface ReferencedAssetSources {
  /** Any jsonb that may hold asset variables: page layers + settings, component layers/variants/variables, layer-style design. */
  json: readonly unknown[];
  fields: Readonly<Record<string, readonly CollectionField[]>>;
  items: Readonly<
    Record<string, ReadonlyArray<{ values: Readonly<Record<string, string>> }>>
  >;
}

export function collectReferencedAssetIds(
  sources: ReferencedAssetSources,
): string[] {
  const out = new Set<string>();

  for (const blob of sources.json) collectAssetIdsFromJson(blob, out);

  for (const [collectionId, items] of Object.entries(sources.items)) {
    const typeByFieldId = new Map<string, string>();
    for (const field of sources.fields[collectionId] ?? []) {
      typeByFieldId.set(field.id, field.type);
    }
    for (const item of items) {
      for (const [fieldId, value] of Object.entries(item.values)) {
        const type = typeByFieldId.get(fieldId);
        if (type) collectAssetIdsFromValue(type, value, out);
      }
    }
  }

  return [...out];
}
