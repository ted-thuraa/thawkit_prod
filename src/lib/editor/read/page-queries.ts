// path: src/lib/editor/read/page-queries.ts

import "server-only";
import { db } from "@/drizzle/db";
import { NotFoundError } from "@/lib/errors";
import type { Layer } from "@/types/funnel";
import type { CampaignScope } from "./guards";

/**
 * On-demand page reads. TENANCY: pages belong to a funnel, derived from the
 * authorized campaign. A page id from the client is never trusted on its own
 * — it must belong to THIS funnel, and a missing page and another funnel's
 * page are indistinguishable (`NotFoundError`).
 */

export interface PageLayersSnapshot {
  layers: Layer[];
  /** ISO timestamp of the row's last update. */
  updatedAt: string;
}

/** The last SAVED layer tree of one page (what autosave last wrote). */
export async function queryPageLayers(
  scope: CampaignScope,
  pageId: string,
): Promise<PageLayersSnapshot> {
  const row = await db.query.page.findFirst({
    where: { id: pageId, funnelId: scope.funnelId },
  });
  if (!row) throw new NotFoundError("Page not found.", { pageId });

  return {
    // A legacy row may hold null / a non-array — an empty tree, not a crash.
    layers: Array.isArray(row.layers) ? (row.layers as Layer[]) : [],
    updatedAt: row.updatedAt.toISOString(),
  };
}
