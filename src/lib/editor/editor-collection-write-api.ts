// path: src/lib/editor/editor-collection-write-api.ts

import {
  createCollectionAction,
  createFieldAction,
  createItemAction,
  createSampleCollectionAction,
  deleteCollectionAction,
  deleteFieldAction,
  deleteItemsAction,
  duplicateItemAction,
  getCollectionUsageAction,
  getFieldUsageAction,
  reorderCollectionsAction,
  reorderFieldsAction,
  reorderItemsAction,
  updateCollectionAction,
  updateFieldAction,
  updateItemAction,
} from "@/actions/editor/collection-actions";
import { callEditorAction } from "@/lib/editor/editor-read-api";
import type {
  CollectionFieldData,
  CollectionFieldType,
  CollectionSorting,
} from "@/types/funnel";

/**
 * Client adapter for the CMS WRITE server actions — the successor of the
 * Ycode-ported `collectionsApi` (which called `/ycode/api/collections/*`
 * routes that don't exist in ThawKit). Same `{ data?, error? }` contract and
 * campaign-switch safety as `collectionsReadApi`; reads stay there.
 *
 * Values are passed as-is (strings, booleans, arrays, rich-text documents):
 * the server validates and serializes them.
 */

export type ItemValuesPayload = Record<string, unknown>;

export const collectionsWriteApi = {
  // Collections
  create: (name: string) =>
    callEditorAction((c) => createCollectionAction(c, { name })),

  createSample: (sampleId: string) =>
    callEditorAction((c) => createSampleCollectionAction(c, sampleId)),

  update: (
    collectionId: string,
    data: { name?: string; sorting?: CollectionSorting | null },
  ) => callEditorAction((c) => updateCollectionAction(c, collectionId, data)),

  delete: (collectionId: string) =>
    callEditorAction((c) => deleteCollectionAction(c, collectionId)),

  reorder: (orderedIds: string[]) =>
    callEditorAction((c) => reorderCollectionsAction(c, orderedIds)),

  getUsage: (collectionId: string) =>
    callEditorAction((c) => getCollectionUsageAction(c, collectionId)),

  // Fields
  createField: (
    collectionId: string,
    data: {
      name: string;
      type: CollectionFieldType;
      default?: string | null;
      reference_collection_id?: string | null;
      data?: CollectionFieldData;
    },
  ) => callEditorAction((c) => createFieldAction(c, collectionId, data)),

  updateField: (
    fieldId: string,
    data: {
      name?: string;
      default?: string | null;
      reference_collection_id?: string | null;
      hidden?: boolean;
      data?: CollectionFieldData;
    },
  ) => callEditorAction((c) => updateFieldAction(c, fieldId, data)),

  deleteField: (fieldId: string) =>
    callEditorAction((c) => deleteFieldAction(c, fieldId)),

  reorderFields: (collectionId: string, orderedIds: string[]) =>
    callEditorAction((c) => reorderFieldsAction(c, collectionId, orderedIds)),

  getFieldUsage: (fieldId: string) =>
    callEditorAction((c) => getFieldUsageAction(c, fieldId)),

  // Items
  createItem: (collectionId: string, values: ItemValuesPayload) =>
    callEditorAction((c) => createItemAction(c, collectionId, values)),

  updateItem: (
    collectionId: string,
    itemId: string,
    values: ItemValuesPayload,
  ) =>
    callEditorAction((c) => updateItemAction(c, collectionId, itemId, values)),

  duplicateItem: (collectionId: string, itemId: string) =>
    callEditorAction((c) => duplicateItemAction(c, collectionId, itemId)),

  deleteItems: (collectionId: string, itemIds: string[]) =>
    callEditorAction((c) => deleteItemsAction(c, collectionId, itemIds)),

  reorderItems: (
    collectionId: string,
    updates: Array<{ id: string; manual_order: number }>,
  ) => callEditorAction((c) => reorderItemsAction(c, collectionId, updates)),
};
