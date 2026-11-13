// path: src/lib/editor/write/collection-mutations.ts

import "server-only";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import {
  collection,
  collectionField,
  collectionItem,
  collectionItemValue,
  type CollectionFieldRow,
  type CollectionItemRow,
  type CollectionRow,
} from "@/drizzle/schemas/collections-schema";
import { ValidationError, NotFoundError } from "@/lib/errors";
import { isUuid } from "@/lib/editor/bootstrap/collect-asset-ids";
import {
  collectionFieldFromRow,
  collectionFromRow,
  collectionItemFromRow,
} from "@/lib/editor/bootstrap/mappers";
import type { CampaignScope } from "@/lib/editor/read/guards";
import { requireCollectionInFunnel } from "@/lib/editor/read/guards";
import {
  getCollectionFieldUsage,
  getCollectionUsage,
} from "@/lib/collection-usage-utils";
import { getSampleCollectionById } from "@/lib/sample-collections";
import { validateFieldValue } from "@/lib/collection-field-utils";
import { parseMultiReferenceValue } from "@/lib/collection-utils";
import type {
  Collection,
  CollectionField,
  CollectionFieldData,
  CollectionItemWithValues,
  CollectionSorting,
} from "@/types/funnel";
import {
  SYSTEM_FIELD_KEYS,
  getNewCollectionBuiltInFields,
  BUILT_IN_FIELDS_END,
  BUILT_IN_FIELDS_START,
  serializeItemValue,
  uniqueName,
} from "./collection-builtins";
import type { ItemValuesInput } from "./schemas";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * CMS write layer (Drizzle). The server-side counterpart of Ycode's
 * `/ycode/api/collections/*` routes and repositories.
 *
 * INVARIANTS
 *  - Callers pass a `CampaignScope` obtained from `requireCampaignScope`
 *    (auth + `editCampaignContent` gate, tenant derived server-side). Every
 *    function re-verifies that the entity it touches belongs to
 *    `scope.funnelId`; a valid campaign never grants access to another
 *    funnel's collection by id.
 *  - Writes only touch DRAFT rows (`is_published = false`). Published copies
 *    are owned by the publish pipeline.
 *  - DELETES ARE HARD DELETES of the draft rows. The composite
 *    `(id, is_published)` FKs cascade collection → fields / items → values,
 *    so no orphans remain.
 *  - Multi-statement operations run in one transaction.
 *  - Deleting a collection / field that is still in use is refused HERE, not
 *    just in the dialog — the client check is a convenience, this is the guard.
 * ─────────────────────────────────────────────────────────────────────────
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const DRAFT = false;

// ─── Lookups ────────────────────────────────────────────────────────────────

async function liveFields(tx: Tx, collectionId: string) {
  return tx
    .select()
    .from(collectionField)
    .where(
      and(
        eq(collectionField.collectionId, collectionId),
        eq(collectionField.isPublished, DRAFT),
        isNull(collectionField.deletedAt),
      ),
    )
    .orderBy(asc(collectionField.order));
}

/**
 * Loads a draft field and proves its collection belongs to the funnel. A
 * non-UUID, a missing field and another funnel's field are indistinguishable
 * to the caller.
 */
export async function requireFieldInFunnel(
  scope: CampaignScope,
  fieldId: string,
): Promise<{ field: CollectionFieldRow; collection: CollectionRow }> {
  if (!isUuid(fieldId)) throw new NotFoundError("Field not found.", { fieldId });
  const [row] = await db
    .select({ field: collectionField, collection })
    .from(collectionField)
    .innerJoin(
      collection,
      and(
        eq(collection.id, collectionField.collectionId),
        eq(collection.isPublished, collectionField.isPublished),
      ),
    )
    .where(
      and(
        eq(collectionField.id, fieldId),
        eq(collectionField.isPublished, DRAFT),
        isNull(collectionField.deletedAt),
        eq(collection.funnelId, scope.funnelId),
        isNull(collection.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError("Field not found.", { fieldId });
  return row;
}

async function requireItemInCollection(
  tx: Tx,
  collectionId: string,
  itemId: string,
): Promise<CollectionItemRow> {
  if (!isUuid(itemId)) throw new NotFoundError("Item not found.", { itemId });
  const [row] = await tx
    .select()
    .from(collectionItem)
    .where(
      and(
        eq(collectionItem.id, itemId),
        eq(collectionItem.collectionId, collectionId),
        eq(collectionItem.isPublished, DRAFT),
        isNull(collectionItem.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError("Item not found.", { itemId });
  return row;
}

async function readItemValues(
  tx: Tx,
  itemId: string,
): Promise<Record<string, string>> {
  const rows = await tx
    .select({
      fieldId: collectionItemValue.fieldId,
      value: collectionItemValue.value,
    })
    .from(collectionItemValue)
    .where(
      and(
        eq(collectionItemValue.itemId, itemId),
        eq(collectionItemValue.isPublished, DRAFT),
        isNull(collectionItemValue.deletedAt),
      ),
    );
  const values: Record<string, string> = {};
  for (const r of rows) if (r.value !== null) values[r.fieldId] = r.value;
  return values;
}

async function liveItemCount(tx: Tx, collectionId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(collectionItem)
    .where(
      and(
        eq(collectionItem.collectionId, collectionId),
        eq(collectionItem.isPublished, DRAFT),
        isNull(collectionItem.deletedAt),
      ),
    );
  return row?.n ?? 0;
}

// ─── Collections ────────────────────────────────────────────────────────────

async function nextCollectionOrder(tx: Tx, funnelId: string): Promise<number> {
  const [row] = await tx
    .select({ max: sql<number | null>`max(${collection.order})` })
    .from(collection)
    .where(
      and(
        eq(collection.funnelId, funnelId),
        eq(collection.isPublished, DRAFT),
        isNull(collection.deletedAt),
      ),
    );
  return (row?.max ?? -1) + 1;
}

export interface CollectionWithFields {
  collection: Collection;
  fields: CollectionField[];
}

export async function createCollection(
  scope: CampaignScope,
  input: { name: string },
): Promise<CollectionWithFields> {
  return db.transaction(async (tx) => {
    const order = await nextCollectionOrder(tx, scope.funnelId);
    const [created] = await tx
      .insert(collection)
      .values({
        funnelId: scope.funnelId,
        name: input.name,
        order,
        isPublished: DRAFT,
      })
      .returning();

    const fieldRows = await tx
      .insert(collectionField)
      .values(
        getNewCollectionBuiltInFields().map((f) => ({
          collectionId: created.id,
          name: f.name,
          key: f.key,
          type: f.type,
          fillable: f.fillable,
          hidden: f.hidden,
          order: f.order,
          isPublished: DRAFT,
        })),
      )
      .returning();

    return {
      collection: collectionFromRow(created, {
        draftItemsCount: 0,
        hasPublishedVersion: false,
      }),
      fields: fieldRows
        .sort((a, b) => a.order - b.order)
        .map(collectionFieldFromRow),
    };
  });
}

export async function updateCollection(
  scope: CampaignScope,
  collectionId: string,
  input: { name?: string; sorting?: CollectionSorting | null },
): Promise<Collection> {
  const existing = await requireCollectionInFunnel(scope.funnelId, collectionId);

  if (input.sorting && input.sorting.field !== "manual_order") {
    const fieldId = input.sorting.field;
    const owned = isUuid(fieldId)
      ? await db
          .select({ id: collectionField.id })
          .from(collectionField)
          .where(
            and(
              eq(collectionField.id, fieldId),
              eq(collectionField.collectionId, collectionId),
              eq(collectionField.isPublished, DRAFT),
              isNull(collectionField.deletedAt),
            ),
          )
          .limit(1)
      : [];
    if (owned.length === 0) {
      throw new ValidationError("Sort field not found in this collection.");
    }
  }

  const [row] = await db
    .update(collection)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.sorting !== undefined ? { sorting: input.sorting } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(collection.id, existing.id),
        eq(collection.isPublished, DRAFT),
        eq(collection.funnelId, scope.funnelId),
      ),
    )
    .returning();
  if (!row) throw new NotFoundError("Collection not found.", { collectionId });

  const count = await db.transaction((tx) => liveItemCount(tx, row.id));
  return collectionFromRow(row, {
    draftItemsCount: count,
    hasPublishedVersion: false,
  });
}

export async function deleteCollection(
  scope: CampaignScope,
  collectionId: string,
): Promise<void> {
  await requireCollectionInFunnel(scope.funnelId, collectionId);

  const usage = await getCollectionUsage(scope, collectionId);
  if (usage.total > 0) {
    throw new ValidationError(
      "This collection is still in use. Remove its usages before deleting it.",
      undefined,
      { collectionId, total: usage.total },
    );
  }

  await db
    .delete(collection)
    .where(
      and(
        eq(collection.id, collectionId),
        eq(collection.isPublished, DRAFT),
        eq(collection.funnelId, scope.funnelId),
      ),
    );
}

export async function reorderCollections(
  scope: CampaignScope,
  orderedIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(orderedIds)];
  await db.transaction(async (tx) => {
    const owned = await tx
      .select({ id: collection.id })
      .from(collection)
      .where(
        and(
          inArray(collection.id, ids),
          eq(collection.funnelId, scope.funnelId),
          eq(collection.isPublished, DRAFT),
          isNull(collection.deletedAt),
        ),
      );
    if (owned.length !== ids.length) {
      throw new NotFoundError("Collection not found.");
    }
    for (const [index, id] of ids.entries()) {
      await tx
        .update(collection)
        .set({ order: index, updatedAt: new Date() })
        .where(and(eq(collection.id, id), eq(collection.isPublished, DRAFT)));
    }
  });
}

// ─── Fields ─────────────────────────────────────────────────────────────────

export interface CreateFieldInput {
  name: string;
  type: CollectionField["type"];
  default?: string | null;
  reference_collection_id?: string | null;
  data?: CollectionFieldData;
}

async function assertReferenceTarget(
  scope: CampaignScope,
  referenceCollectionId: string | null | undefined,
): Promise<string> {
  if (!referenceCollectionId) {
    throw new ValidationError("Choose a collection to reference.");
  }
  try {
    await requireCollectionInFunnel(scope.funnelId, referenceCollectionId);
  } catch {
    throw new ValidationError("Referenced collection not found.");
  }
  return referenceCollectionId;
}

/** Count fields must point at a reference field of another collection that references THIS one. */
async function assertCountConfig(
  scope: CampaignScope,
  ownerCollectionId: string,
  data: CollectionFieldData | undefined,
): Promise<{ collectionId: string; fieldId: string }> {
  const cfg = data?.count;
  if (!cfg) throw new ValidationError("Choose a collection and reference field to count.");
  const [target] = await db
    .select({ field: collectionField })
    .from(collectionField)
    .innerJoin(
      collection,
      and(
        eq(collection.id, collectionField.collectionId),
        eq(collection.isPublished, collectionField.isPublished),
      ),
    )
    .where(
      and(
        eq(collectionField.id, cfg.fieldId),
        eq(collectionField.collectionId, cfg.collectionId),
        eq(collectionField.isPublished, DRAFT),
        isNull(collectionField.deletedAt),
        eq(collection.funnelId, scope.funnelId),
        isNull(collection.deletedAt),
      ),
    )
    .limit(1);
  const f = target?.field;
  if (
    !f ||
    (f.type !== "reference" && f.type !== "multi_reference") ||
    f.referenceCollectionId !== ownerCollectionId
  ) {
    throw new ValidationError(
      "The counted field must be a reference field that points at this collection.",
    );
  }
  return { collectionId: cfg.collectionId, fieldId: cfg.fieldId };
}

function normalizeOptions(data: CollectionFieldData | undefined) {
  const seen = new Set<string>();
  const options = (data?.options ?? []).map((o) => ({
    id: o.id,
    name: o.name.trim(),
  }));
  for (const o of options) {
    if (!o.name) throw new ValidationError("Option names can't be empty.");
    const key = o.name.toLowerCase();
    if (seen.has(key)) {
      throw new ValidationError(`Duplicate option "${o.name}".`);
    }
    seen.add(key);
  }
  return options;
}

export async function createField(
  scope: CampaignScope,
  collectionId: string,
  input: CreateFieldInput,
): Promise<CollectionField> {
  await requireCollectionInFunnel(scope.funnelId, collectionId);

  let referenceCollectionId: string | null = null;
  let data: CollectionFieldData = {};
  if (input.type === "reference" || input.type === "multi_reference") {
    referenceCollectionId = await assertReferenceTarget(
      scope,
      input.reference_collection_id,
    );
  } else if (input.type === "count") {
    data = { count: await assertCountConfig(scope, collectionId, input.data) };
  } else if (input.type === "option") {
    data = { options: normalizeOptions(input.data) };
  }

  return db.transaction(async (tx) => {
    const fields = await liveFields(tx, collectionId);
    // Custom fields sit between the leading and trailing built-ins: insert
    // before "Created Date" and shift the trailing built-ins down.
    const trailing = fields.find((f) => f.key === "created_at");
    const maxOrder = fields.reduce((m, f) => Math.max(m, f.order), -1);
    const insertAt = trailing ? trailing.order : maxOrder + 1;

    if (trailing) {
      await tx
        .update(collectionField)
        .set({ order: sql`${collectionField.order} + 1`, updatedAt: new Date() })
        .where(
          and(
            eq(collectionField.collectionId, collectionId),
            eq(collectionField.isPublished, DRAFT),
            isNull(collectionField.deletedAt),
            sql`${collectionField.order} >= ${insertAt}`,
          ),
        );
    }

    const [created] = await tx
      .insert(collectionField)
      .values({
        collectionId,
        name: input.name,
        key: null, // built-in keys are server-assigned only
        type: input.type,
        defaultValue: input.default ?? null,
        fillable: true,
        hidden: false,
        order: insertAt,
        referenceCollectionId,
        data,
        isPublished: DRAFT,
      })
      .returning();
    return collectionFieldFromRow(created);
  });
}

export interface UpdateFieldInput {
  name?: string;
  default?: string | null;
  reference_collection_id?: string | null;
  hidden?: boolean;
  data?: CollectionFieldData;
}

export async function updateField(
  scope: CampaignScope,
  fieldId: string,
  input: UpdateFieldInput,
): Promise<CollectionField> {
  const { field } = await requireFieldInFunnel(scope, fieldId);
  const isBuiltIn = field.key !== null;

  if (isBuiltIn) {
    const forbidden = Object.keys(input).filter((k) => k !== "hidden");
    if (forbidden.length > 0) {
      throw new ValidationError("Built-in fields can only be hidden or shown.");
    }
  }

  const patch: Partial<typeof collectionField.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) patch.name = input.name;
  if (input.default !== undefined) patch.defaultValue = input.default;
  if (input.hidden !== undefined) patch.hidden = input.hidden;

  let renames: Array<{ from: string; to: string }> = [];
  let removedNames: string[] = [];

  if (!isBuiltIn) {
    if (field.type === "reference" || field.type === "multi_reference") {
      if (input.reference_collection_id !== undefined) {
        patch.referenceCollectionId = await assertReferenceTarget(
          scope,
          input.reference_collection_id,
        );
      }
    } else if (field.type === "count" && input.data) {
      patch.data = {
        ...(field.data ?? {}),
        count: await assertCountConfig(scope, field.collectionId, input.data),
      };
    } else if (field.type === "option" && input.data?.options) {
      const next = normalizeOptions(input.data);
      const prev = field.data?.options ?? [];
      const prevById = new Map(prev.map((o) => [o.id, o.name.trim()]));
      const nextById = new Map(next.map((o) => [o.id, o.name]));
      renames = next
        .filter((o) => prevById.has(o.id) && prevById.get(o.id) !== o.name)
        .map((o) => ({ from: prevById.get(o.id)!, to: o.name }));
      removedNames = prev
        .filter((o) => !nextById.has(o.id))
        .map((o) => o.name.trim());
      patch.data = { ...(field.data ?? {}), options: next };
    }
  }

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(collectionField)
      .set(patch)
      .where(
        and(
          eq(collectionField.id, field.id),
          eq(collectionField.isPublished, DRAFT),
        ),
      )
      .returning();
    if (!row) throw new NotFoundError("Field not found.", { fieldId });

    // Keep stored option values in step with the option list: renamed options
    // carry their items along, removed options clear the value.
    for (const { from, to } of renames) {
      await tx
        .update(collectionItemValue)
        .set({ value: to, updatedAt: new Date() })
        .where(
          and(
            eq(collectionItemValue.fieldId, field.id),
            eq(collectionItemValue.isPublished, DRAFT),
            eq(collectionItemValue.value, from),
          ),
        );
    }
    const stillUsedNames = new Set(
      (patch.data?.options ?? []).map((o) => o.name),
    );
    const toClear = removedNames.filter((n) => !stillUsedNames.has(n));
    if (toClear.length > 0) {
      await tx
        .delete(collectionItemValue)
        .where(
          and(
            eq(collectionItemValue.fieldId, field.id),
            eq(collectionItemValue.isPublished, DRAFT),
            inArray(collectionItemValue.value, toClear),
          ),
        );
    }
    return collectionFieldFromRow(row);
  });
}

export async function deleteField(
  scope: CampaignScope,
  fieldId: string,
): Promise<void> {
  const { field, collection: owner } = await requireFieldInFunnel(scope, fieldId);
  if (field.key !== null) {
    throw new ValidationError("Built-in fields can't be deleted.");
  }

  const usage = await getCollectionFieldUsage(scope, fieldId);
  if (usage.total > 0) {
    throw new ValidationError(
      "This field is still in use. Remove its usages before deleting it.",
      undefined,
      { fieldId, total: usage.total },
    );
  }

  await db.transaction(async (tx) => {
    // A collection sorted by the deleted field falls back to manual order.
    if (owner.sorting?.field === fieldId) {
      await tx
        .update(collection)
        .set({ sorting: null, updatedAt: new Date() })
        .where(
          and(eq(collection.id, owner.id), eq(collection.isPublished, DRAFT)),
        );
    }
    await tx
      .delete(collectionField)
      .where(
        and(
          eq(collectionField.id, fieldId),
          eq(collectionField.isPublished, DRAFT),
        ),
      );
  });
}

export async function reorderFields(
  scope: CampaignScope,
  collectionId: string,
  orderedIds: readonly string[],
): Promise<void> {
  await requireCollectionInFunnel(scope.funnelId, collectionId);
  const ids = [...new Set(orderedIds)];
  await db.transaction(async (tx) => {
    const owned = new Set((await liveFields(tx, collectionId)).map((f) => f.id));
    if (ids.some((id) => !owned.has(id))) {
      throw new NotFoundError("Field not found.");
    }
    for (const [index, id] of ids.entries()) {
      await tx
        .update(collectionField)
        .set({ order: index, updatedAt: new Date() })
        .where(
          and(
            eq(collectionField.id, id),
            eq(collectionField.isPublished, DRAFT),
          ),
        );
    }
  });
}

// ─── Items ──────────────────────────────────────────────────────────────────

interface PreparedValue {
  fieldId: string;
  /** `null` = clear the value. */
  value: string | null;
}

/**
 * Validates and serializes client values against the collection's fields.
 * Unknown field ids are rejected; server-maintained built-ins (id, created /
 * updated date) and other non-fillable fields are ignored, never written.
 */
async function prepareValues(
  tx: Tx,
  collectionId: string,
  fields: CollectionFieldRow[],
  input: ItemValuesInput,
  itemId: string | null,
  mode: "create" | "update",
): Promise<PreparedValue[]> {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const prepared: PreparedValue[] = [];
  const refChecks: Array<{ field: CollectionFieldRow; ids: string[] }> = [];

  for (const [fieldId, raw] of Object.entries(input)) {
    const field = byId.get(fieldId);
    if (!field) throw new ValidationError("Unknown field in item values.");
    if (!field.fillable || (field.key && SYSTEM_FIELD_KEYS.has(field.key))) continue;

    let value = serializeItemValue(raw);
    if (value !== null) {
      if (field.type === "email" || field.type === "phone") {
        const err = validateFieldValue(field.type, value);
        if (err) throw new ValidationError(`${field.name}: ${err}`);
      } else if (field.type === "number") {
        if (!Number.isFinite(Number(value))) {
          throw new ValidationError(`${field.name} must be a number.`);
        }
      } else if (field.type === "boolean") {
        value = value === "true" || value === "1" ? "true" : "false";
      } else if (field.type === "option") {
        const names = (field.data?.options ?? []).map((o) => o.name.trim());
        if (!names.includes(value.trim())) {
          throw new ValidationError(`${field.name}: not a valid option.`);
        }
        value = value.trim();
      } else if (field.type === "reference") {
        refChecks.push({ field, ids: [value] });
      } else if (field.type === "multi_reference") {
        const ids = parseMultiReferenceValue(value);
        value = ids.length ? JSON.stringify(ids) : null;
        if (ids.length) refChecks.push({ field, ids });
      }
    }
    prepared.push({ fieldId, value });
  }

  // Reference integrity: every referenced item must exist in the field's
  // target collection (draft, live).
  for (const { field, ids } of refChecks) {
    const target = field.referenceCollectionId;
    const unique = [...new Set(ids)];
    if (!target || unique.some((id) => !isUuid(id))) {
      throw new ValidationError(`${field.name}: invalid reference.`);
    }
    const found = await tx
      .select({ id: collectionItem.id })
      .from(collectionItem)
      .where(
        and(
          inArray(collectionItem.id, unique),
          eq(collectionItem.collectionId, target),
          eq(collectionItem.isPublished, DRAFT),
          isNull(collectionItem.deletedAt),
        ),
      );
    if (found.length !== unique.length) {
      throw new ValidationError(`${field.name}: referenced item not found.`);
    }
  }

  // Name required / slug required + unique within the collection.
  const nameField = fields.find((f) => f.key === "name" && f.fillable);
  const slugField = fields.find((f) => f.key === "slug" && f.fillable);
  const provided = new Map(prepared.map((p) => [p.fieldId, p.value]));

  if (nameField && (mode === "create" || provided.has(nameField.id))) {
    if (!provided.get(nameField.id)?.trim()) {
      throw new ValidationError("Name is required.");
    }
  }
  if (slugField && (mode === "create" || provided.has(slugField.id))) {
    const slug = provided.get(slugField.id)?.trim();
    if (!slug) throw new ValidationError("Slug is required.");
    provided.set(slugField.id, slug);
    const idx = prepared.findIndex((p) => p.fieldId === slugField.id);
    prepared[idx] = { fieldId: slugField.id, value: slug };

    const clash = await tx
      .select({ itemId: collectionItemValue.itemId })
      .from(collectionItemValue)
      .innerJoin(
        collectionItem,
        and(
          eq(collectionItem.id, collectionItemValue.itemId),
          eq(collectionItem.isPublished, collectionItemValue.isPublished),
        ),
      )
      .where(
        and(
          eq(collectionItemValue.fieldId, slugField.id),
          eq(collectionItemValue.value, slug),
          eq(collectionItemValue.isPublished, DRAFT),
          isNull(collectionItemValue.deletedAt),
          eq(collectionItem.collectionId, collectionId),
          isNull(collectionItem.deletedAt),
          ...(itemId ? [ne(collectionItem.id, itemId)] : []),
        ),
      )
      .limit(1);
    if (clash.length > 0) {
      throw new ValidationError("This slug already exists in this collection.");
    }
  }

  return prepared;
}

async function nextBuiltInId(tx: Tx, fields: CollectionFieldRow[]): Promise<number> {
  const idField = fields.find((f) => f.key === "id");
  if (!idField) return 0;
  const [row] = await tx
    .select({
      max: sql<number | null>`max(case when ${collectionItemValue.value} ~ '^[0-9]{1,15}$' then ${collectionItemValue.value}::bigint end)`,
    })
    .from(collectionItemValue)
    .where(
      and(
        eq(collectionItemValue.fieldId, idField.id),
        eq(collectionItemValue.isPublished, DRAFT),
        isNull(collectionItemValue.deletedAt),
      ),
    );
  return Number(row?.max ?? 0) + 1;
}

async function writeValues(
  tx: Tx,
  itemId: string,
  prepared: readonly PreparedValue[],
): Promise<void> {
  if (prepared.length === 0) return;
  // Replace semantics: drop the rows for the touched fields, re-insert the
  // non-empty ones. (The (item, field) uniqueness index is partial, which
  // rules out a plain ON CONFLICT target.)
  await tx
    .delete(collectionItemValue)
    .where(
      and(
        eq(collectionItemValue.itemId, itemId),
        eq(collectionItemValue.isPublished, DRAFT),
        inArray(
          collectionItemValue.fieldId,
          prepared.map((p) => p.fieldId),
        ),
      ),
    );
  const rows = prepared
    .filter((p): p is { fieldId: string; value: string } => p.value !== null)
    .map((p) => ({
      itemId,
      fieldId: p.fieldId,
      value: p.value,
      isPublished: DRAFT,
    }));
  if (rows.length > 0) await tx.insert(collectionItemValue).values(rows);
}

export async function createItem(
  scope: CampaignScope,
  collectionId: string,
  values: ItemValuesInput,
): Promise<CollectionItemWithValues> {
  await requireCollectionInFunnel(scope.funnelId, collectionId);

  return db.transaction(async (tx) => {
    const fields = await liveFields(tx, collectionId);
    const prepared = await prepareValues(
      tx,
      collectionId,
      fields,
      values,
      null,
      "create",
    );

    const [orderRow] = await tx
      // bigint aggregates come back from `pg` as strings — callers Number() them.
      .select({ max: sql<string | number | null>`max(${collectionItem.manualOrder})` })
      .from(collectionItem)
      .where(
        and(
          eq(collectionItem.collectionId, collectionId),
          eq(collectionItem.isPublished, DRAFT),
          isNull(collectionItem.deletedAt),
        ),
      );

    const [item] = await tx
      .insert(collectionItem)
      .values({
        collectionId,
        manualOrder: Number(orderRow?.max ?? -1) + 1,
        isPublished: DRAFT,
      })
      .returning();

    const nowIso = new Date().toISOString();
    const system: PreparedValue[] = [];
    for (const f of fields) {
      if (f.key === "id") {
        system.push({ fieldId: f.id, value: String(await nextBuiltInId(tx, fields)) });
      } else if (f.key === "created_at" || f.key === "updated_at") {
        system.push({ fieldId: f.id, value: nowIso });
      }
    }
    await writeValues(tx, item.id, [...prepared, ...system]);
    return collectionItemFromRow(item, await readItemValues(tx, item.id));
  });
}

export async function updateItem(
  scope: CampaignScope,
  collectionId: string,
  itemId: string,
  values: ItemValuesInput,
): Promise<CollectionItemWithValues> {
  await requireCollectionInFunnel(scope.funnelId, collectionId);

  return db.transaction(async (tx) => {
    const existing = await requireItemInCollection(tx, collectionId, itemId);
    const fields = await liveFields(tx, collectionId);
    const prepared = await prepareValues(
      tx,
      collectionId,
      fields,
      values,
      itemId,
      "update",
    );

    const updatedField = fields.find((f) => f.key === "updated_at");
    const system: PreparedValue[] = updatedField
      ? [{ fieldId: updatedField.id, value: new Date().toISOString() }]
      : [];
    await writeValues(tx, itemId, [...prepared, ...system]);

    const [row] = await tx
      .update(collectionItem)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(collectionItem.id, existing.id),
          eq(collectionItem.isPublished, DRAFT),
        ),
      )
      .returning();
    return collectionItemFromRow(row, await readItemValues(tx, itemId));
  });
}

export async function duplicateItem(
  scope: CampaignScope,
  collectionId: string,
  itemId: string,
): Promise<CollectionItemWithValues> {
  await requireCollectionInFunnel(scope.funnelId, collectionId);

  return db.transaction(async (tx) => {
    await requireItemInCollection(tx, collectionId, itemId);
    const fields = await liveFields(tx, collectionId);
    const source = await readItemValues(tx, itemId);

    const nameField = fields.find((f) => f.key === "name");
    const slugField = fields.find((f) => f.key === "slug");
    const idField = fields.find((f) => f.key === "id");
    const nowIso = new Date().toISOString();

    const copy: Record<string, string> = { ...source };
    if (nameField && source[nameField.id]) {
      copy[nameField.id] = `${source[nameField.id]} (Copy)`;
    }
    if (slugField && source[slugField.id]) {
      const taken = await tx
        .select({ value: collectionItemValue.value })
        .from(collectionItemValue)
        .where(
          and(
            eq(collectionItemValue.fieldId, slugField.id),
            eq(collectionItemValue.isPublished, DRAFT),
            isNull(collectionItemValue.deletedAt),
          ),
        );
      copy[slugField.id] = uniqueName(
        `${source[slugField.id]}-copy`,
        taken.map((t) => t.value ?? ""),
      ).replace(/ /g, "-");
    }
    if (idField) copy[idField.id] = String(await nextBuiltInId(tx, fields));
    for (const f of fields) {
      if (f.key === "created_at" || f.key === "updated_at") copy[f.id] = nowIso;
    }

    const [orderRow] = await tx
      // bigint aggregates come back from `pg` as strings — callers Number() them.
      .select({ max: sql<string | number | null>`max(${collectionItem.manualOrder})` })
      .from(collectionItem)
      .where(
        and(
          eq(collectionItem.collectionId, collectionId),
          eq(collectionItem.isPublished, DRAFT),
          isNull(collectionItem.deletedAt),
        ),
      );
    const [item] = await tx
      .insert(collectionItem)
      .values({
        collectionId,
        manualOrder: Number(orderRow?.max ?? -1) + 1,
        isPublished: DRAFT,
      })
      .returning();

    const knownFieldIds = new Set(fields.map((f) => f.id));
    await writeValues(
      tx,
      item.id,
      Object.entries(copy)
        .filter(([fieldId]) => knownFieldIds.has(fieldId))
        .map(([fieldId, value]) => ({ fieldId, value })),
    );
    return collectionItemFromRow(item, await readItemValues(tx, item.id));
  });
}

export async function deleteItems(
  scope: CampaignScope,
  collectionId: string,
  itemIds: readonly string[],
): Promise<number> {
  await requireCollectionInFunnel(scope.funnelId, collectionId);
  const ids = [...new Set(itemIds)].filter(isUuid);
  if (ids.length === 0) return 0;
  const deleted = await db
    .delete(collectionItem)
    .where(
      and(
        inArray(collectionItem.id, ids),
        eq(collectionItem.collectionId, collectionId),
        eq(collectionItem.isPublished, DRAFT),
      ),
    )
    .returning({ id: collectionItem.id });
  return deleted.length;
}

export async function reorderItems(
  scope: CampaignScope,
  collectionId: string,
  updates: ReadonlyArray<{ id: string; manual_order: number }>,
): Promise<void> {
  await requireCollectionInFunnel(scope.funnelId, collectionId);
  const byId = new Map(updates.map((u) => [u.id, u.manual_order]));
  const ids = [...byId.keys()];
  await db.transaction(async (tx) => {
    const owned = await tx
      .select({ id: collectionItem.id })
      .from(collectionItem)
      .where(
        and(
          inArray(collectionItem.id, ids),
          eq(collectionItem.collectionId, collectionId),
          eq(collectionItem.isPublished, DRAFT),
          isNull(collectionItem.deletedAt),
        ),
      );
    if (owned.length !== ids.length) throw new NotFoundError("Item not found.");
    for (const [id, order] of byId) {
      await tx
        .update(collectionItem)
        .set({ manualOrder: order, updatedAt: new Date() })
        .where(
          and(eq(collectionItem.id, id), eq(collectionItem.isPublished, DRAFT)),
        );
    }
  });
}

// ─── Samples ────────────────────────────────────────────────────────────────

/**
 * Creates a collection from a predefined template: built-ins + the sample's
 * custom fields + its items, all in one transaction.
 *
 * Sample IMAGES are not created: the template references bundled image files
 * (Ycode ships them in `storage/collections/` and uploads them to Supabase
 * Storage), but ThawKit has neither those files nor that storage backend —
 * uploads go through UploadThing. Image fields are created, left empty.
 */
export async function createSampleCollection(
  scope: CampaignScope,
  sampleId: string,
): Promise<CollectionWithFields & { items: CollectionItemWithValues[] }> {
  const sample = getSampleCollectionById(sampleId);
  if (!sample) throw new NotFoundError("Sample collection not found.", { sampleId });

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ name: collection.name })
      .from(collection)
      .where(
        and(
          eq(collection.funnelId, scope.funnelId),
          eq(collection.isPublished, DRAFT),
          isNull(collection.deletedAt),
        ),
      );
    const name = uniqueName(sample.name, existing.map((c) => c.name));
    const order = await nextCollectionOrder(tx, scope.funnelId);

    const [created] = await tx
      .insert(collection)
      .values({ funnelId: scope.funnelId, name, order, isPublished: DRAFT })
      .returning();

    // start built-ins, sample custom fields (key NULL so they stay editable),
    // end built-ins — sequential order.
    const defs = [
      ...BUILT_IN_FIELDS_START.map((f) => ({ ...f, persistKey: f.key as string | null, lookupKey: f.key as string | null })),
      ...sample.customFields.map((f) => ({
        name: f.name,
        type: f.type,
        fillable: f.fillable,
        hidden: f.hidden,
        persistKey: null as string | null,
        lookupKey: f.key,
      })),
      ...BUILT_IN_FIELDS_END.map((f) => ({ ...f, persistKey: f.key as string | null, lookupKey: f.key as string | null })),
    ];
    const fieldRows = await tx
      .insert(collectionField)
      .values(
        defs.map((d, order) => ({
          collectionId: created.id,
          name: d.name,
          key: d.persistKey,
          type: d.type,
          fillable: d.fillable,
          hidden: d.hidden,
          order,
          isPublished: DRAFT,
        })),
      )
      .returning();
    // `returning()` order isn't guaranteed — key by the order we assigned.
    const byOrder = new Map(fieldRows.map((f) => [f.order, f]));
    const fieldIdByKey = new Map<string, string>();
    defs.forEach((d, i) => {
      const row = byOrder.get(i);
      if (row && d.lookupKey) fieldIdByKey.set(d.lookupKey, row.id);
    });

    const itemRows = sample.items.length
      ? await tx
          .insert(collectionItem)
          .values(
            sample.items.map((_, i) => ({
              collectionId: created.id,
              manualOrder: i + 1,
              isPublished: DRAFT,
            })),
          )
          .returning()
      : [];
    const orderedItems = [...itemRows].sort((a, b) => a.manualOrder - b.manualOrder);

    const nowIso = new Date().toISOString();
    const valueRows: Array<typeof collectionItemValue.$inferInsert> = [];
    orderedItems.forEach((item, i) => {
      const def = sample.items[i];
      const values: Record<string, string> = {
        ...def.values,
        id: String(i + 1),
        created_at: nowIso,
        updated_at: nowIso,
      };
      for (const [key, value] of Object.entries(values)) {
        const fieldId = fieldIdByKey.get(key);
        if (fieldId && value !== "") {
          valueRows.push({ itemId: item.id, fieldId, value, isPublished: DRAFT });
        }
      }
    });
    if (valueRows.length > 0) await tx.insert(collectionItemValue).values(valueRows);

    const items: CollectionItemWithValues[] = [];
    for (const item of orderedItems) {
      items.push(collectionItemFromRow(item, await readItemValues(tx, item.id)));
    }

    return {
      collection: collectionFromRow(created, {
        draftItemsCount: items.length,
        hasPublishedVersion: false,
      }),
      fields: [...fieldRows]
        .sort((a, b) => a.order - b.order)
        .map(collectionFieldFromRow),
      items,
    };
  });
}
