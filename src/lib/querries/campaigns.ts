// path: src/lib/queries/campaigns.ts

import "server-only";
import { cache } from "react";
import { db } from "@/drizzle/db";
import { requireOrgPermission } from "@/lib/auth/require-org-permission";
import { WORKSPACE_ROLE_MATRIX } from "@/lib/workspace/permissions";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type {
  CampaignDetail,
  CampaignDTO,
  CampaignListFilter,
  PaginatedResult,
} from "@/types/workspace";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

interface CampaignCursor {
  createdAt: string;
  id: string;
}

function encodeCursor(cursor: CampaignCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(raw: string): CampaignCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as Partial<CampaignCursor>;
    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") {
      throw new Error("Cursor payload shape mismatch.");
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch (error) {
    throw new ValidationError(
      "The pagination cursor is invalid or has expired.",
      undefined,
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

export async function listCampaigns(
  organizationId: string,
  filter: CampaignListFilter,
): Promise<PaginatedResult<CampaignDTO>> {
  await requireOrgPermission(
    organizationId,
    WORKSPACE_ROLE_MATRIX.viewWorkspace,
  );

  const pageSize = Math.min(
    Math.max(filter.pageSize ?? DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  );
  const cursor = filter.cursor ? decodeCursor(filter.cursor) : null;

  // v2: sibling keys on one filter object are ANDed, so organizationId,
  // the conditional status filter, and the conditional cursor OR-clause
  // all combine exactly like the old and(...) did. Conditional keys are
  // spread in rather than set to `undefined`, so this doesn't depend on
  // how the adapter treats an explicit undefined value.
  const rows = await db.query.campaign.findMany({
    where: {
      organizationId,
      ...(filter.status !== "all" ? { status: filter.status } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.createdAt) } },
              {
                createdAt: new Date(cursor.createdAt),
                id: { lt: cursor.id },
              },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc", id: "desc" },
    limit: pageSize + 1,
    with: {
      creator: { columns: { id: true, name: true } },
    },
  });

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdBy: row.creator
        ? { id: row.creator.id, name: row.creator.name }
        : null,
    })),
    nextCursor:
      hasMore && last
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null,
    hasMore,
  };
}

/**
 * ADDED — the campaign-detail re-authorization check (Step 11 of the
 * creation flow design). Called independently from
 * `campaigns/[campaignId]/layout.tsx` AND each sub-route page
 * (`overview`, `settings`, `analytics`), so it's wrapped in `cache()` to
 * dedupe to a single query per request rather than re-fetching on every
 * tab. Confirms the campaign both exists AND belongs to the caller's
 * active org — a valid-looking id alone is never sufficient.
 */
export const getCampaignDetail = cache(
  async (
    organizationId: string,
    campaignId: string,
  ): Promise<CampaignDetail> => {
    await requireOrgPermission(
      organizationId,
      WORKSPACE_ROLE_MATRIX.viewWorkspace,
    );

    const campaignItem = await db.query.campaign.findFirst({
      where: {
        id: campaignId,
        organizationId,
      },
      with: {
        creator: { columns: { id: true, name: true } },
        funnels: true,
      },
    });

    if (!campaignItem) {
      throw new NotFoundError("Campaign not found in this workspace.", {
        organizationId,
        campaignId,
      });
    }

    return {
      campaign: {
        id: campaignItem.id,
        name: campaignItem.name,
        status: campaignItem.status,
        createdAt: campaignItem.createdAt.toISOString(),
        updatedAt: campaignItem.updatedAt.toISOString(),
        createdBy: campaignItem.creator
          ? { id: campaignItem.creator.id, name: campaignItem.creator.name }
          : null,
      },
      funnel: campaignItem.funnels
        ? {
            id: campaignItem.funnels.id,
            name: campaignItem.funnels.name,
            createdAt: campaignItem.funnels.createdAt.toISOString(),
          }
        : null,
    };
  },
);
