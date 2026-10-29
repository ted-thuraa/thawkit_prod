// path: src/lib/assets/asset-usage.ts

import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { funnel } from "@/drizzle/schemas/campaigns-schema";
import { funnelVersions, page } from "@/drizzle/schemas/funnel-content-schema";
import { component, layerStyle } from "@/drizzle/schemas/design-system-schema";
import {
  collection,
  collectionItem,
  collectionItemValue,
} from "@/drizzle/schemas/collections-schema";
import { isUuid } from "@/lib/editor/bootstrap/collect-asset-ids";
import type { AssetUsage } from "./delete-asset";

/**
 * Where is this asset referenced? Scoped to ONE organization.
 *
 * METHOD. Asset references are stable UUIDs embedded in jsonb/text
 * (`{type:"asset",data:{asset_id}}`, link `asset.id`, rich-text markup, the
 * Background control's cached `url(...)`, CMS field values). Instead of
 * re-implementing a structural walk per shape (which silently misses the next
 * shape someone adds — the weakness of Ycode's `asset-usage-utils`), we match
 * the UUID's text inside each column. A UUID is 122 random bits, so a hit is
 * a reference: the match is a SUPERSET of every structured shape with no
 * practical false positives. The id is validated as a UUID first, so the LIKE
 * pattern contains no wildcard characters.
 *
 * WHAT IS SCANNED (all org-scoped via funnel/organization joins):
 *   pages (layers, settings) · components (layers, variants, variables) ·
 *   layer styles (design) · CMS draft values · the CURRENT published snapshot
 *   (`funnel_version.compiledSchema`, is_current) — a live published funnel
 *   must not lose its images. Older, non-current versions are NOT scanned:
 *   they would make an asset undeletable forever.
 *
 * Each query is capped; we only need to know "in use, and roughly where".
 */

const PER_KIND_LIMIT = 25;

export async function findAssetUsages(
  organizationId: string,
  assetId: string,
): Promise<AssetUsage[]> {
  if (!isUuid(assetId)) return [];
  const needle = `%${assetId.toLowerCase()}%`;
  const like = (column: unknown) => sql`${column}::text LIKE ${needle}`;

  const [pages, components, layerStyles, cmsValues, published] = await Promise.all([
    db
      .select({ id: page.id, name: page.name })
      .from(page)
      .innerJoin(funnel, eq(page.funnelId, funnel.id))
      .where(
        and(
          eq(funnel.organizationId, organizationId),
          sql`(${like(page.layers)} OR ${like(page.settings)})`,
        ),
      )
      .limit(PER_KIND_LIMIT),

    db
      .select({ id: component.id, name: component.name })
      .from(component)
      .where(
        and(
          eq(component.organizationId, organizationId),
          sql`(${like(component.layers)} OR ${like(component.variants)} OR ${like(component.variables)})`,
        ),
      )
      .limit(PER_KIND_LIMIT),

    db
      .select({ id: layerStyle.id, name: layerStyle.name })
      .from(layerStyle)
      .where(and(eq(layerStyle.organizationId, organizationId), like(layerStyle.design)))
      .limit(PER_KIND_LIMIT),

    db
      .select({ id: collectionItemValue.itemId, name: collection.name })
      .from(collectionItemValue)
      .innerJoin(
        collectionItem,
        and(
          eq(collectionItem.id, collectionItemValue.itemId),
          eq(collectionItem.isPublished, collectionItemValue.isPublished),
        ),
      )
      .innerJoin(
        collection,
        and(
          eq(collection.id, collectionItem.collectionId),
          eq(collection.isPublished, collectionItem.isPublished),
        ),
      )
      .innerJoin(funnel, eq(funnel.id, collection.funnelId))
      .where(
        and(
          eq(funnel.organizationId, organizationId),
          eq(collectionItemValue.isPublished, false),
          isNull(collectionItemValue.deletedAt),
          isNull(collectionItem.deletedAt),
          isNull(collection.deletedAt),
          like(collectionItemValue.value),
        ),
      )
      .limit(PER_KIND_LIMIT),

    db
      .select({ id: funnelVersions.id, name: funnel.name })
      .from(funnelVersions)
      .innerJoin(funnel, eq(funnelVersions.funnelId, funnel.id))
      .where(
        and(
          eq(funnel.organizationId, organizationId),
          eq(funnelVersions.isCurrent, true),
          like(funnelVersions.compiledSchema),
        ),
      )
      .limit(PER_KIND_LIMIT),
  ]);

  return [
    ...pages.map((r) => ({ kind: "page" as const, id: r.id, name: r.name })),
    ...components.map((r) => ({ kind: "component" as const, id: r.id, name: r.name })),
    ...layerStyles.map((r) => ({ kind: "layer_style" as const, id: r.id, name: r.name })),
    ...cmsValues.map((r) => ({ kind: "cms_item" as const, id: r.id, name: r.name })),
    ...published.map((r) => ({ kind: "published_version" as const, id: r.id, name: r.name })),
  ];
}
