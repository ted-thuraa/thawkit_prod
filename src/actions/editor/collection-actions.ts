// path: src/actions/editor/collection-actions.ts

"use server";

import { z } from "zod";
import { toErrorResult } from "@/lib/editor/read/action-result";
import { requireCampaignScope } from "@/lib/editor/read/guards";
import { requireCollectionInFunnel } from "@/lib/editor/read/guards";
import type { ActionResult } from "@/lib/editor/read/types";
import {
  createCollection,
  createField,
  createItem,
  createSampleCollection,
  deleteCollection,
  deleteField,
  deleteItems,
  duplicateItem,
  reorderCollections,
  reorderFields,
  reorderItems,
  requireFieldInFunnel,
  updateCollection,
  updateField,
  updateItem,
  type CollectionWithFields,
} from "@/lib/editor/write/collection-mutations";
import {
  createCollectionSchema,
  createFieldSchema,
  itemValuesSchema,
  reorderIdsSchema,
  updateCollectionSchema,
  updateFieldSchema,
  uuidSchema,
} from "@/lib/editor/write/schemas";
import {
  getCollectionFieldUsage,
  getCollectionUsage,
} from "@/lib/collection-usage-utils";
import type {
  CollectionFieldUsageResult,
  CollectionUsageResult,
} from "@/lib/collection-usage-scan";
import type {
  Collection,
  CollectionField,
  CollectionItemWithValues,
} from "@/types/funnel";

/**
 * Typed Server Action WRITES for the CMS — the persistence counterpart of
 * `editor-read-actions.ts`, replacing the dead `/ycode/api/collections/*`
 * calls the Ycode-ported store still made.
 *
 * Every action, in this order:
 *   1. authenticates the caller and derives the tenant scope from the
 *      campaign (`requireCampaignScope` → Better Auth session +
 *      `editCampaignContent` permission; funnel id comes from the DB, never
 *      from the client),
 *   2. validates the payload with strict zod schemas,
 *   3. runs a mutation that re-proves every client-supplied collection /
 *      field / item id belongs to that funnel.
 * Failures come back as `ActionResult` (known app errors keep their message;
 * anything else is logged and replaced by a generic one).
 *
 * Authorization is enforced HERE on the server for every mutation — the
 * client-side UI gating is cosmetic.
 */

const campaignIdSchema = z.string().min(1).max(64);
const sampleIdSchema = z.string().min(1).max(64);

async function authorize(campaignId: string) {
  return requireCampaignScope(campaignIdSchema.parse(campaignId));
}

// ─── Collections ────────────────────────────────────────────────────────────

export async function createCollectionAction(
  campaignId: string,
  input: unknown,
): Promise<ActionResult<CollectionWithFields>> {
  try {
    const scope = await authorize(campaignId);
    const data = await createCollection(scope, createCollectionSchema.parse(input));
    return { success: true, data };
  } catch (error) {
    return toErrorResult(error, "Failed to create the collection.");
  }
}

export async function createSampleCollectionAction(
  campaignId: string,
  sampleId: string,
): Promise<
  ActionResult<CollectionWithFields & { items: CollectionItemWithValues[] }>
> {
  try {
    const scope = await authorize(campaignId);
    const data = await createSampleCollection(scope, sampleIdSchema.parse(sampleId));
    return { success: true, data };
  } catch (error) {
    return toErrorResult(error, "Failed to create the sample collection.");
  }
}

export async function updateCollectionAction(
  campaignId: string,
  collectionId: string,
  input: unknown,
): Promise<ActionResult<Collection>> {
  try {
    const scope = await authorize(campaignId);
    const data = await updateCollection(
      scope,
      uuidSchema.parse(collectionId),
      updateCollectionSchema.parse(input),
    );
    return { success: true, data };
  } catch (error) {
    return toErrorResult(error, "Failed to update the collection.");
  }
}

export async function deleteCollectionAction(
  campaignId: string,
  collectionId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const scope = await authorize(campaignId);
    const id = uuidSchema.parse(collectionId);
    await deleteCollection(scope, id);
    return { success: true, data: { id } };
  } catch (error) {
    return toErrorResult(error, "Failed to delete the collection.");
  }
}

export async function reorderCollectionsAction(
  campaignId: string,
  orderedIds: unknown,
): Promise<ActionResult<null>> {
  try {
    const scope = await authorize(campaignId);
    await reorderCollections(scope, reorderIdsSchema.parse(orderedIds));
    return { success: true, data: null };
  } catch (error) {
    return toErrorResult(error, "Failed to reorder the collections.");
  }
}

export async function getCollectionUsageAction(
  campaignId: string,
  collectionId: string,
): Promise<ActionResult<CollectionUsageResult>> {
  try {
    const scope = await authorize(campaignId);
    const id = uuidSchema.parse(collectionId);
    await requireCollectionInFunnel(scope.funnelId, id);
    return { success: true, data: await getCollectionUsage(scope, id) };
  } catch (error) {
    return toErrorResult(error, "Failed to check where the collection is used.");
  }
}

// ─── Fields ─────────────────────────────────────────────────────────────────

export async function createFieldAction(
  campaignId: string,
  collectionId: string,
  input: unknown,
): Promise<ActionResult<CollectionField>> {
  try {
    const scope = await authorize(campaignId);
    const data = await createField(
      scope,
      uuidSchema.parse(collectionId),
      createFieldSchema.parse(input),
    );
    return { success: true, data };
  } catch (error) {
    return toErrorResult(error, "Failed to create the field.");
  }
}

export async function updateFieldAction(
  campaignId: string,
  fieldId: string,
  input: unknown,
): Promise<ActionResult<CollectionField>> {
  try {
    const scope = await authorize(campaignId);
    const data = await updateField(
      scope,
      uuidSchema.parse(fieldId),
      updateFieldSchema.parse(input),
    );
    return { success: true, data };
  } catch (error) {
    return toErrorResult(error, "Failed to update the field.");
  }
}

export async function deleteFieldAction(
  campaignId: string,
  fieldId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const scope = await authorize(campaignId);
    const id = uuidSchema.parse(fieldId);
    await deleteField(scope, id);
    return { success: true, data: { id } };
  } catch (error) {
    return toErrorResult(error, "Failed to delete the field.");
  }
}

export async function reorderFieldsAction(
  campaignId: string,
  collectionId: string,
  orderedIds: unknown,
): Promise<ActionResult<null>> {
  try {
    const scope = await authorize(campaignId);
    await reorderFields(
      scope,
      uuidSchema.parse(collectionId),
      reorderIdsSchema.parse(orderedIds),
    );
    return { success: true, data: null };
  } catch (error) {
    return toErrorResult(error, "Failed to reorder the fields.");
  }
}

export async function getFieldUsageAction(
  campaignId: string,
  fieldId: string,
): Promise<ActionResult<CollectionFieldUsageResult>> {
  try {
    const scope = await authorize(campaignId);
    const id = uuidSchema.parse(fieldId);
    await requireFieldInFunnel(scope, id);
    return { success: true, data: await getCollectionFieldUsage(scope, id) };
  } catch (error) {
    return toErrorResult(error, "Failed to check where the field is used.");
  }
}

// ─── Items ──────────────────────────────────────────────────────────────────

export async function createItemAction(
  campaignId: string,
  collectionId: string,
  values: unknown,
): Promise<ActionResult<CollectionItemWithValues>> {
  try {
    const scope = await authorize(campaignId);
    const data = await createItem(
      scope,
      uuidSchema.parse(collectionId),
      itemValuesSchema.parse(values),
    );
    return { success: true, data };
  } catch (error) {
    return toErrorResult(error, "Failed to create the item.");
  }
}

export async function updateItemAction(
  campaignId: string,
  collectionId: string,
  itemId: string,
  values: unknown,
): Promise<ActionResult<CollectionItemWithValues>> {
  try {
    const scope = await authorize(campaignId);
    const data = await updateItem(
      scope,
      uuidSchema.parse(collectionId),
      uuidSchema.parse(itemId),
      itemValuesSchema.parse(values),
    );
    return { success: true, data };
  } catch (error) {
    return toErrorResult(error, "Failed to save the item.");
  }
}

export async function duplicateItemAction(
  campaignId: string,
  collectionId: string,
  itemId: string,
): Promise<ActionResult<CollectionItemWithValues>> {
  try {
    const scope = await authorize(campaignId);
    const data = await duplicateItem(
      scope,
      uuidSchema.parse(collectionId),
      uuidSchema.parse(itemId),
    );
    return { success: true, data };
  } catch (error) {
    return toErrorResult(error, "Failed to duplicate the item.");
  }
}

export async function deleteItemsAction(
  campaignId: string,
  collectionId: string,
  itemIds: unknown,
): Promise<ActionResult<{ deleted: number }>> {
  try {
    const scope = await authorize(campaignId);
    const deleted = await deleteItems(
      scope,
      uuidSchema.parse(collectionId),
      reorderIdsSchema.parse(itemIds),
    );
    return { success: true, data: { deleted } };
  } catch (error) {
    return toErrorResult(error, "Failed to delete the item(s).");
  }
}

const reorderItemsSchema = z
  .array(z.object({ id: uuidSchema, manual_order: z.number().int().min(0).max(1_000_000) }))
  .min(1)
  .max(500);

export async function reorderItemsAction(
  campaignId: string,
  collectionId: string,
  updates: unknown,
): Promise<ActionResult<null>> {
  try {
    const scope = await authorize(campaignId);
    await reorderItems(
      scope,
      uuidSchema.parse(collectionId),
      reorderItemsSchema.parse(updates),
    );
    return { success: true, data: null };
  } catch (error) {
    return toErrorResult(error, "Failed to reorder the items.");
  }
}
