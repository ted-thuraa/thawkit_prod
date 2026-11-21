// path: src/lib/editor/write/sample-fields.ts

import type {
  CollectionFieldData,
  CollectionFieldType,
} from "@/types/funnel";
import type { SampleCollectionDefinition } from "@/lib/sample-collections";
import {
  BUILT_IN_FIELDS_END,
  BUILT_IN_FIELDS_START,
} from "./collection-builtins";

/**
 * Turns a sample definition into the ordered field rows to insert. Pure (no I/O,
 * ids supplied by the caller) so the rules are unit-testable without a database.
 *
 * Rules:
 *  - order = built-ins (start) → sample custom fields → built-ins (end), sequential;
 *  - a custom field persists its `key` ONLY when `locked` — an unlocked sample
 *    field stays user-editable (`key = NULL`), matching Ycode/ThawKit semantics
 *    where a non-null key means "locked built-in";
 *  - `default` and `data` are persisted as given;
 *  - `showWhen` is authored with sibling field KEYS and resolved here to field
 *    IDS (which only exist once ids are assigned).
 *
 * Throws on a malformed definition (a programming error caught by tests).
 */

export interface PlannedSampleField {
  id: string;
  name: string;
  /** What is persisted in `collection_fields.key` (null ⇒ editable). */
  persistKey: string | null;
  /** The key sample ITEMS use to address this field (built-ins included). */
  lookupKey: string | null;
  type: CollectionFieldType;
  fillable: boolean;
  hidden: boolean;
  order: number;
  defaultValue: string | null;
  data: CollectionFieldData;
}

export function buildSampleFieldPlan(
  sample: SampleCollectionDefinition,
  newId: () => string,
): PlannedSampleField[] {
  const planned: PlannedSampleField[] = [];

  for (const f of BUILT_IN_FIELDS_START) {
    planned.push({
      id: newId(),
      name:
        f.key === "name" && sample.builtInLabels?.name
          ? sample.builtInLabels.name
          : f.name,
      persistKey: f.key,
      lookupKey: f.key,
      type: f.type,
      fillable: f.fillable,
      hidden: f.hidden,
      order: 0,
      defaultValue: null,
      data: {},
    });
  }

  const customKeys = new Set<string>();
  const customPlanned: Array<{
    def: SampleCollectionDefinition["customFields"][number];
    row: PlannedSampleField;
  }> = [];
  for (const f of sample.customFields) {
    if (f.locked && !f.key) {
      throw new Error(`Sample "${sample.id}": locked field "${f.name}" needs a key.`);
    }
    if (f.key) {
      if (customKeys.has(f.key)) {
        throw new Error(`Sample "${sample.id}": duplicate field key "${f.key}".`);
      }
      customKeys.add(f.key);
    }
    const row: PlannedSampleField = {
      id: newId(),
      name: f.name,
      persistKey: f.locked ? f.key : null,
      lookupKey: f.key,
      type: f.type,
      fillable: f.fillable,
      hidden: f.hidden,
      order: 0,
      defaultValue: f.default ?? null,
      data: f.data ? structuredClone(f.data) : {},
    };
    planned.push(row);
    customPlanned.push({ def: f, row });
  }

  for (const f of BUILT_IN_FIELDS_END) {
    planned.push({
      id: newId(),
      name: f.name,
      persistKey: f.key,
      lookupKey: f.key,
      type: f.type,
      fillable: f.fillable,
      hidden: f.hidden,
      order: 0,
      defaultValue: null,
      data: {},
    });
  }

  planned.forEach((p, i) => {
    p.order = i;
  });

  // Resolve showWhen (authored by key) to field ids.
  const idByKey = new Map<string, string>();
  for (const p of planned) if (p.lookupKey) idByKey.set(p.lookupKey, p.id);

  for (const { def, row } of customPlanned) {
    if (!def.showWhen || def.showWhen.length === 0) continue;
    row.data.showWhen = def.showWhen.map((rule) => {
      const fieldId = idByKey.get(rule.fieldKey);
      if (!fieldId) {
        throw new Error(
          `Sample "${sample.id}": field "${def.name}" shows when unknown field "${rule.fieldKey}".`,
        );
      }
      return { fieldId, equals: [...rule.equals] };
    });
  }

  return planned;
}
