// path: src/actions/workspace/campaigns.ts

"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/drizzle/db";
import { campaign, funnel } from "@/drizzle/schemas/campaigns-schema";
import { requireOrgPermission } from "@/lib/auth/require-org-permission";
import { WORKSPACE_ROLE_MATRIX } from "@/lib/workspace/permissions";
import {
  ForbiddenError,
  NotFoundError,
  UpstreamServiceError,
  isAppError,
} from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  createCampaignSchema,
  deleteCampaignSchema,
  updateCampaignSchema,
  type CreateCampaignInput,
  type DeleteCampaignInput,
  type UpdateCampaignInput,
} from "@/lib/validation/campaign";
import type { ActionResult, CampaignDTO } from "@/types/workspace";
import { nanoid } from "nanoid";
import { seedDefaultPagesForFunnel } from "./seedFunnelPage";
//import { seedDefaultPagesForFunnel } from "./seedFunnelPage";

const WORKSPACE_DASHBOARD_PATH = "/workspace";

function toActionError<T>(
  error: unknown,
  actionName: string,
  context: Record<string, unknown>,
): ActionResult<T> {
  if (isAppError(error)) {
    logger.warn(`${actionName} rejected`, { ...context, error });
    return { ok: false, error: error.toClientSafe() };
  }
  logger.error(`${actionName} failed unexpectedly`, { ...context, error });
  const wrapped = new UpstreamServiceError(
    "Something went wrong. Please try again.",
    error,
  );
  return { ok: false, error: wrapped.toClientSafe() };
}

/**
 * Step 4–9 of the creation flow: re-validate, authorize, transactionally
 * insert a campaign + its default funnel, invalidate the dashboard, and
 * return a typed result. Never throws across the RPC boundary — the client
 * form (createCampaignForm.tsx) drives navigation off the returned id,
 * `redirect()` is deliberately NOT called here (see design doc rationale:
 * it would be silently swallowed by this function's own try/catch).
 */
export async function createCampaign(
  input: CreateCampaignInput,
): Promise<ActionResult<CampaignDTO>> {
  const parsed = createCampaignSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid campaign details.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }

  const { organizationId, name } = parsed.data;

  try {
    const actor = await requireOrgPermission(
      organizationId,
      WORKSPACE_ROLE_MATRIX.createCampaign,
    );

    if (actor.organizationStatus !== "active") {
      throw new ForbiddenError(
        "Campaigns can't be created while this workspace is suspended.",
      );
    }

    const campaignId = nanoid();
    const funnelId = nanoid();
    const now = new Date();

    // Transactional: a campaign without a funnel — or a funnel without its
    // default home/result pages — is a dead end for the destination page
    // (the editor has nothing to load). All three inserts succeed
    // together or none do.
    await db.transaction(async (tx) => {
      await tx.insert(campaign).values({
        id: campaignId,
        organizationId,
        name,
        status: "draft",
        createdBy: actor.userId,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(funnel).values({
        id: funnelId,
        organizationId,
        campaignId,
        name,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      });

      await seedDefaultPagesForFunnel(tx, { funnelId, now });
    });

    logger.info("Campaign created", {
      organizationId,
      campaignId,
      funnelId,
      actorId: actor.userId,
    });
    revalidatePath(WORKSPACE_DASHBOARD_PATH);

    return {
      ok: true,
      data: {
        id: campaignId,
        name,
        status: "draft",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        createdBy: { id: actor.userId, name: "" },
      },
    };
  } catch (error) {
    return toActionError(error, "createCampaign", { organizationId, name });
  }
}

export async function updateCampaign(
  input: UpdateCampaignInput,
): Promise<ActionResult<CampaignDTO>> {
  const parsed = updateCampaignSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid update.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }

  const { organizationId, campaignId, name, status } = parsed.data;

  try {
    const actor = await requireOrgPermission(
      organizationId,
      WORKSPACE_ROLE_MATRIX.manageCampaigns,
    );

    const existing = await db.query.campaign.findFirst({
      where: {
        id: campaignId,
        organizationId,
      },
    });

    if (!existing) {
      throw new NotFoundError("Campaign not found in this workspace.", {
        campaignId,
      });
    }

    // POSTGRES: was `const [result] = await db.update(...)` reading
    // `result.affectedRows` — that shape is mysql2's [ResultSetHeader,
    // FieldPacket[]] tuple and doesn't exist on node-postgres. Without
    // .returning(), drizzle's pg update() resolves to a non-iterable
    // result object, so the old destructure would throw at runtime, not
    // just misreport. `.returning()` + checking array length is the
    // dialect-correct equivalent of the old affectedRows check.
    const updated = await db
      .update(campaign)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(status !== undefined ? { status } : {}),
      })
      .where(
        and(
          eq(campaign.id, campaignId),
          eq(campaign.organizationId, organizationId),
        ),
      )
      .returning({ id: campaign.id });

    if (updated.length === 0) {
      throw new NotFoundError("Campaign not found in this workspace.", {
        campaignId,
      });
    }

    logger.info("Campaign updated", {
      organizationId,
      campaignId,
      name,
      status,
      actorId: actor.userId,
    });
    revalidatePath(WORKSPACE_DASHBOARD_PATH);
    revalidatePath(`/workspace/campaigns/${campaignId}`);

    return {
      ok: true,
      data: {
        id: campaignId,
        name: name ?? existing.name,
        status: status ?? existing.status,
        createdAt: existing.createdAt.toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: null,
      },
    };
  } catch (error) {
    return toActionError(error, "updateCampaign", {
      organizationId,
      campaignId,
    });
  }
}

export async function deleteCampaign(
  input: DeleteCampaignInput,
): Promise<ActionResult<{ campaignId: string }>> {
  const parsed = deleteCampaignSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }

  const { organizationId, campaignId } = parsed.data;

  try {
    const actor = await requireOrgPermission(
      organizationId,
      WORKSPACE_ROLE_MATRIX.manageCampaigns,
    );

    // funnels.campaignId has onDelete: "cascade" — deleting the campaign
    // row cascades its funnels at the DB level, no manual cleanup needed.
    // Same POSTGRES fix as updateCampaign above — .returning() instead of
    // the mysql2-only affectedRows tuple.
    const deleted = await db
      .delete(campaign)
      .where(
        and(
          eq(campaign.id, campaignId),
          eq(campaign.organizationId, organizationId),
        ),
      )
      .returning({ id: campaign.id });

    if (deleted.length === 0) {
      throw new NotFoundError("Campaign not found in this workspace.", {
        campaignId,
      });
    }

    logger.info("Campaign deleted", {
      organizationId,
      campaignId,
      actorId: actor.userId,
    });
    revalidatePath(WORKSPACE_DASHBOARD_PATH);

    return { ok: true, data: { campaignId } };
  } catch (error) {
    return toActionError(error, "deleteCampaign", {
      organizationId,
      campaignId,
    });
  }
}
