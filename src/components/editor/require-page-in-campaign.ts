// path: src/lib/editor/require-page-in-campaign.ts

import "server-only";
import { db } from "@/drizzle/db";
import {
  requireCampaignEditPermission,
  type AuthorizedCampaignActor,
} from "@/lib/auth/require-campaign-permission";
import { NotFoundError } from "@/lib/errors";
import { PageRow } from "@/lib/editor/resolve-editor-bootstrap";

/**
 * Verifies BOTH that the caller can edit `campaignId` AND that `pageId`
 * actually belongs to a funnel under that campaign — never trusts a
 * client-supplied `pageId` in isolation, same principle
 * require-campaign-permission.ts documents for `organizationId`. Without
 * this second check, a caller who legitimately owns Campaign A could pass
 * Campaign A's id (which they're authorized for) alongside a `pageId`
 * belonging to Campaign B and mutate data they don't own — `pageId` alone
 * says nothing about which campaign it's scoped to without this lookup.
 *
 * Every mutation in editor-actions.ts that takes a `pageId` goes through
 * this first. Not wrapped in `cache()`: unlike `resolveEditorBootstrap`
 * (called from multiple Server Components rendering in the same request
 * tree), each Server Action invocation here is its own isolated RPC call
 * with nothing else in the same scope to dedupe against.
 */
export async function requirePageInCampaign(
  campaignId: string,
  pageId: string,
): Promise<{ actor: AuthorizedCampaignActor; page: PageRow }> {
  const actor = await requireCampaignEditPermission(campaignId);

  // Named `pageRow`, not `page` — `page` is the imported table binding,
  // and naming the query result the same thing put it inside its own
  // temporal dead zone (see the reply this fix shipped with). Same reason
  // the funnel lookup below is `funnelRow`, not `funnel`.
  const pageRow = await db.query.page.findFirst({ where: { id: pageId } });
  if (!pageRow) {
    throw new NotFoundError("Page not found.", { pageId });
  }

  const funnelRow = await db.query.funnel.findFirst({
    where: { campaignId },
    orderBy: { createdAt: "asc" },
  });

  if (!funnelRow || pageRow.funnelId !== funnelRow.id) {
    // Same error as "doesn't exist" — a caller shouldn't be able to tell
    // "this page exists but belongs to another campaign" from "this page
    // doesn't exist at all."
    throw new NotFoundError("Page not found.", { pageId });
  }

  return { actor, page: pageRow };
}
