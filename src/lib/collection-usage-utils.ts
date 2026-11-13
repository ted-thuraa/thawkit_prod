// path: src/lib/collection-usage-utils.ts

/**
 * Collection & field usage detection (server-only, Drizzle).
 *
 * Answers "what breaks if I delete this collection / field?" across:
 *   - pages            (layer trees + page settings, scoped to the funnel),
 *   - components       (layers, variants, variables — scoped to the organization),
 *   - collection fields that depend on the target (reference, multi-reference
 *     and count fields).
 *
 * Replaces the Supabase-based Ycode implementation. The reference discovery
 * itself is pure and lives in `collection-usage-scan.ts` (unit-tested); this
 * file only loads the rows, tenant-scoped by `CampaignScope` — the scope is
 * always derived from the authorized campaign, never from client input.
 *
 * Only DRAFT rows are inspected (`is_published = false`, not deleted): that is
 * what the editor edits and what the usage list can tell the user to fix.
 */

import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { page } from "@/drizzle/schemas/funnel-content-schema";
import { component } from "@/drizzle/schemas/design-system-schema";
import {
  collection,
  collectionField,
} from "@/drizzle/schemas/collections-schema";
import type { CampaignScope } from "@/lib/editor/read/guards";
import {
  countFieldsDependingOnField,
  fieldsDependingOnCollection,
  scanRows,
  type CollectionFieldUsageResult,
  type CollectionUsageResult,
  type FieldDependencyRow,
  type ScannableRow,
} from "./collection-usage-scan";

export type {
  CollectionFieldUsageResult,
  CollectionUsageResult,
  DependentFieldUsageEntry,
  ReferenceFieldUsageEntry,
  UsageEntry,
} from "./collection-usage-scan";

async function loadPageRows(funnelId: string): Promise<ScannableRow[]> {
  const rows = await db
    .select({
      id: page.id,
      name: page.name,
      layers: page.layers,
      settings: page.settings,
    })
    .from(page)
    .where(eq(page.funnelId, funnelId));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    data: [r.layers, r.settings],
  }));
}

async function loadComponentRows(
  organizationId: string,
): Promise<ScannableRow[]> {
  const rows = await db
    .select({
      id: component.id,
      name: component.name,
      layers: component.layers,
      variants: component.variants,
      variables: component.variables,
    })
    .from(component)
    .where(eq(component.organizationId, organizationId));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    data: [r.layers, r.variants, r.variables],
  }));
}

/** Every live draft field of the funnel, with its collection's name. */
async function loadFieldRows(funnelId: string): Promise<FieldDependencyRow[]> {
  const rows = await db
    .select({
      id: collectionField.id,
      name: collectionField.name,
      type: collectionField.type,
      collectionId: collectionField.collectionId,
      collectionName: collection.name,
      referenceCollectionId: collectionField.referenceCollectionId,
      data: collectionField.data,
    })
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
        eq(collection.funnelId, funnelId),
        eq(collectionField.isPublished, false),
        isNull(collectionField.deletedAt),
        isNull(collection.deletedAt),
      ),
    );
  return rows;
}

/**
 * Where is this collection used? The caller must already have verified the
 * collection belongs to `scope.funnelId` (`requireCollectionInFunnel`).
 */
export async function getCollectionUsage(
  scope: CampaignScope,
  collectionId: string,
): Promise<CollectionUsageResult> {
  const target = { kind: "collection", id: collectionId } as const;
  const [pageRows, componentRows, fieldRows] = await Promise.all([
    loadPageRows(scope.funnelId),
    loadComponentRows(scope.organizationId),
    loadFieldRows(scope.funnelId),
  ]);

  const pages = scanRows(pageRows, target);
  const components = scanRows(componentRows, target);
  const referenceFields = fieldsDependingOnCollection(fieldRows, collectionId);

  return {
    pages,
    components,
    referenceFields,
    total: pages.length + components.length + referenceFields.length,
  };
}

/**
 * Where is this field used? The caller must already have verified the field's
 * collection belongs to `scope.funnelId`.
 */
export async function getCollectionFieldUsage(
  scope: CampaignScope,
  fieldId: string,
): Promise<CollectionFieldUsageResult> {
  const target = { kind: "field", id: fieldId } as const;
  const [pageRows, componentRows, fieldRows] = await Promise.all([
    loadPageRows(scope.funnelId),
    loadComponentRows(scope.organizationId),
    loadFieldRows(scope.funnelId),
  ]);

  const pages = scanRows(pageRows, target);
  const components = scanRows(componentRows, target);
  const dependentFields = countFieldsDependingOnField(fieldRows, fieldId);

  return {
    pages,
    components,
    dependentFields,
    total: pages.length + components.length + dependentFields.length,
  };
}
