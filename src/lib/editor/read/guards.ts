// path: src/lib/editor/read/guards.ts

import "server-only";
import { db } from "@/drizzle/db";
import { requireCampaignEditPermission } from "@/lib/auth/require-campaign-permission";
import { isUuid } from "@/lib/editor/bootstrap/collect-asset-ids";
import { NotFoundError } from "@/lib/errors";

/**
 * Tenant scope for one editor read request, DERIVED from the campaign the
 * caller is authorized for — never from client-supplied tenant ids.
 *   - assets / asset folders are scoped by `organizationId`,
 *   - collections (and their fields/items/values) by `funnelId`.
 */
export interface CampaignScope {
  organizationId: string;
  funnelId: string;
}

/**
 * Authenticates + authorizes the caller for `campaignId`, then resolves the
 * funnel. Auth runs FIRST, before any lookup that could reveal whether a
 * campaign exists (same ordering principle as require-campaign-permission.ts).
 * Not wrapped in `cache()`: each Server Action call is its own isolated RPC.
 */
export async function requireCampaignScope(
  campaignId: string,
): Promise<CampaignScope> {
  const { campaign } = await requireCampaignEditPermission(campaignId);

  const funnelRow = await db.query.funnel.findFirst({
    where: { campaignId },
    orderBy: { createdAt: "asc" },
  });
  if (!funnelRow) {
    throw new NotFoundError("Campaign not found.", { campaignId });
  }

  return { organizationId: campaign.organizationId, funnelId: funnelRow.id };
}

/**
 * Confirms `collectionId` is a live DRAFT collection of THIS funnel.
 * A caller authorized for Campaign A can pass any collection id; without
 * this check they could read Campaign B's items. Same principle as
 * `requirePageInCampaign`. A non-UUID, a missing collection and another
 * funnel's collection all produce the same `NotFoundError`, so callers
 * can't probe for existence.
 */
export async function requireCollectionInFunnel(
  funnelId: string,
  collectionId: string,
) {
  if (!isUuid(collectionId)) {
    throw new NotFoundError("Collection not found.", { collectionId });
  }

  const row = await db.query.collection.findFirst({
    where: {
      id: collectionId,
      funnelId,
      isPublished: false,
      deletedAt: { isNull: true },
    },
  });
  if (!row) {
    throw new NotFoundError("Collection not found.", { collectionId });
  }
  return row;
}
