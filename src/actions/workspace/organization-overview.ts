// path: src/actions/workspace/organization-overview.ts

"use server";

import { headers } from "next/headers";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { requireOrgPermission } from "@/lib/auth/require-org-permission";
import { WORKSPACE_ROLE_MATRIX } from "@/lib/workspace/permissions";
import { organizationOverviewCacheTag } from "@/lib/queries/organization";
import { isAppError, UpstreamServiceError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { ActionResult, OrganizationOverviewDTO } from "@/types/workspace";

const updateOverviewSchema = z.object({
  organizationId: z.string().min(1),
  name: z
    .string()
    .trim()
    .min(2, "Workspace name must be at least 2 characters.")
    .max(100),
  logo: z.string().url("Logo must be a valid URL.").nullable(),
});

export type UpdateOrganizationOverviewInput = z.infer
  typeof updateOverviewSchema
>;

/** Owner/admin only — enforced via requireOrgPermission, never inferred from client state. */
export async function updateOrganizationOverview(
  input: UpdateOrganizationOverviewInput,
): Promise<ActionResult<OrganizationOverviewDTO>> {
  const parsed = updateOverviewSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid workspace overview data.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }

  const { organizationId, name, logo } = parsed.data;

  try {
    const actor = await requireOrgPermission(
      organizationId,
      WORKSPACE_ROLE_MATRIX.manageOverview,
    );

    const updated = await auth.api.updateOrganization({
      body: { organizationId, data: { name, logo } },
      headers: await headers(),
    });

    logger.info("Organization overview updated", {
      organizationId,
      actorId: actor.userId,
    });

    revalidateTag(organizationOverviewCacheTag(organizationId));
    revalidatePath("/workspace/settings/overview");

    return {
      ok: true,
      data: {
        id: organizationId,
        name: updated?.name ?? name,
        logo: updated?.logo ?? logo,
        status: actor.organizationStatus,
      },
    };
  } catch (error) {
    if (isAppError(error)) {
      logger.warn("updateOrganizationOverview rejected", {
        organizationId,
        error,
      });
      return { ok: false, error: error.toClientSafe() };
    }

    logger.error("updateOrganizationOverview failed unexpectedly", {
      organizationId,
      error,
    });
    const wrapped = new UpstreamServiceError(
      "Failed to update workspace details. Please try again.",
      error,
    );
    return { ok: false, error: wrapped.toClientSafe() };
  }
}