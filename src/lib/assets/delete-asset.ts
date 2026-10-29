// path: src/lib/assets/delete-asset.ts

/**
 * Library deletion lifecycle. Pure orchestration; effects injected
 * (`delete-asset-deps.ts` wires the real ones) so each failure path is tested.
 *
 *   1. load the asset from the caller's organization      (else NotFound —
 *      a foreign id is indistinguishable from a missing one)
 *   2. find references → if ANY exist, REFUSE (status "in_use" + where)
 *   3. delete the stored object, using the key read from step 1's row —
 *      never a client-supplied key                         (failure ⇒ throw,
 *      DB untouched, asset stays visible, retry is safe)
 *   4. soft-delete the row                                 (failure ⇒ throw;
 *      the object is already gone, retry re-runs step 3 idempotently)
 *
 * WHY STORAGE BEFORE DB. A DB transaction cannot roll back an external
 * deletion, so one ordering has to be chosen. Deleting the row first would,
 * on a storage failure, leave an INVISIBLE orphan that the UI can never
 * retry. Deleting the object first means every failure leaves the asset
 * visible and retryable, and success is only ever reported after BOTH steps
 * completed. The cost: between steps 3 and 4 the row is briefly "present but
 * file gone" — only reachable after step 2 proved nothing references it.
 *
 * WHY BLOCK INSTEAD OF REWRITING REFERENCES (Ycode's `cleanupAssetReferences`).
 * The open editor holds the authoritative working copy of every page and
 * autosaves whole trees last-write-wins. A server-side rewrite of
 * `pages.layers` would be silently overwritten by that editor's next
 * autosave, resurrecting dangling references. So we refuse and say where the
 * asset is used; removing the references is a normal editor action.
 */

import { NotFoundError } from "@/lib/errors";
import type { Asset } from "@/types/funnel";

export interface AssetUsage {
  kind: "page" | "component" | "layer_style" | "cms_item" | "published_version";
  id: string;
  name: string;
}

export interface DeleteDeps {
  getAsset(organizationId: string, assetId: string): Promise<Asset | null>;
  findUsages(organizationId: string, assetId: string): Promise<AssetUsage[]>;
  /** Must throw unless the provider confirms the object is gone. */
  deleteObject(key: string): Promise<void>;
  /** false = no live row matched (already deleted concurrently). */
  markDeleted(organizationId: string, assetId: string): Promise<boolean>;
  log: { warn(message: string, context?: Record<string, unknown>): void };
}

export type DeleteOutcome =
  | { status: "deleted"; assetId: string }
  | { status: "in_use"; assetId: string; usages: AssetUsage[] };

export class AssetDeleteError extends Error {
  constructor(
    readonly stage: "storage" | "database",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AssetDeleteError";
  }
}

export async function deleteAsset(
  organizationId: string,
  assetId: string,
  deps: DeleteDeps,
): Promise<DeleteOutcome> {
  const asset = await deps.getAsset(organizationId, assetId);
  if (!asset) throw new NotFoundError("Asset not found.", { assetId });

  const usages = await deps.findUsages(organizationId, asset.id);
  if (usages.length > 0) return { status: "in_use", assetId: asset.id, usages };

  // Inline-only SVG rows have no stored object.
  if (asset.storage_path) {
    try {
      await deps.deleteObject(asset.storage_path);
    } catch (cause) {
      throw new AssetDeleteError(
        "storage",
        "The file could not be removed from storage. Nothing was changed — please try again.",
        { cause },
      );
    }
  }

  try {
    const marked = await deps.markDeleted(organizationId, asset.id);
    if (!marked) {
      deps.log.warn("Asset row was already deleted", { assetId: asset.id });
    }
  } catch (cause) {
    throw new AssetDeleteError(
      "database",
      "The file was removed from storage but the library record could not be updated. Please try again.",
      { cause },
    );
  }

  return { status: "deleted", assetId: asset.id };
}

/** Human description for the "in use" message / dialog. */
export function describeUsages(usages: readonly AssetUsage[]): string {
  const label: Record<AssetUsage["kind"], string> = {
    page: "page",
    component: "component",
    layer_style: "layer style",
    cms_item: "CMS collection",
    published_version: "published funnel",
  };
  const parts = usages.slice(0, 5).map((u) => `${label[u.kind]} “${u.name}”`);
  const more = usages.length > 5 ? ` and ${usages.length - 5} more` : "";
  return parts.join(", ") + more;
}
