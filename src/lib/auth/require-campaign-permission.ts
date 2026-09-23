// path: src/lib/auth/require-campaign-permission.ts

import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { campaign } from "@/drizzle/schemas/campaigns-schema";
import { getServerSession } from "@/lib/sessionServer";
import { requireOrgPermission } from "./require-org-permission";
import type { AuthorizedActor } from "./require-org-permission";
import { UnauthenticatedError, NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { WORKSPACE_ROLE_MATRIX } from "@/lib/workspace/permissions";

export type CampaignRow = InferSelectModel<typeof campaign>;

export interface AuthorizedCampaignActor extends AuthorizedActor {
  campaign: CampaignRow;
}

/**
 * The authorization gate for mounting the campaign editor (and any other
 * campaign-content mutation) at `campaign/[campaignId]/editor`. Composes
 * `requireOrgPermission` rather than duplicating its membership/role/
 * banned/impersonation logic — this wrapper's only job is resolving
 * `campaignId` to the `organizationId` that gate actually needs.
 *
 * Deliberately checks authentication BEFORE looking up the campaign: an
 * anonymous request must never be able to distinguish "campaign doesn't
 * exist" from "campaign exists but I'm not authenticated" by timing or
 * response shape. Once authenticated, a non-member of the owning
 * organization gets the exact same ForbiddenError `requireOrgPermission`
 * already gives a non-member for any other org-scoped resource — this
 * gate introduces no new way to distinguish "org exists but I'm not in
 * it" from "campaign doesn't exist," consistent with
 * `requireOrgPermission`'s own documented intent (see its file comment).
 *
 * Wrapped in `cache()` so `layout.tsx` and `page.tsx` (and any future
 * sibling routes under this segment — e.g. a settings sub-route) dedupe to
 * a single session + DB round trip per request, rather than re-running the
 * whole check once per call site. Same pattern as `resolveWorkspaceContext()`.
 *
 * CAVEAT: this file imports `UnauthenticatedError` and `NotFoundError`
 * from `@/lib/errors` based only on how `require-org-permission.ts` is
 * already confirmed to import and throw them — `lib/errors.ts` itself
 * hasn't been reviewed here. If its actual base class or constructor
 * signature differs from what's assumed above, that's a one-file fix.
 */
export const requireCampaignEditPermission = cache(
  async (campaignId: string): Promise<AuthorizedCampaignActor> => {
    const session = await getServerSession();

    if (!session?.user) {
      throw new UnauthenticatedError();
    }

    const campaignRow = await db.query.campaign.findFirst({
      where: { id: campaignId },
    });

    if (!campaignRow) {
      logger.info("Editor mount attempted against a non-existent campaign", {
        userId: session.user.id,
        campaignId,
      });
      throw new NotFoundError("Campaign not found.", { campaignId });
    }

    const actor = await requireOrgPermission(
      campaignRow.organizationId,
      WORKSPACE_ROLE_MATRIX.editCampaignContent,
    );

    return {
      ...actor,
      campaign: campaignRow,
    };
  },
);
