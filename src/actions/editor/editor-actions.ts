// path: src/lib/actions/editor-actions.ts

"use server";

import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "@/drizzle/db";
import {
  funnelVersions,
  page as pageTable,
} from "@/drizzle/schemas/funnel-content-schema";
import { requireCampaignEditPermission } from "@/lib/auth/require-campaign-permission";
import type { PageRow } from "@/lib/editor/resolve-editor-bootstrap";
import type { Layer, PageSettings, PageType } from "@/types/funnel";
import {
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
} from "@/lib/errors";
import { logger } from "@/lib/logger";
import { nanoid } from "nanoid";
import { requirePageInCampaign } from "@/components/editor/require-page-in-campaign";
import { generateUniqueSlug, sanitizeSlug } from "@/lib/page-utils";
import { pagesFromRows } from "@/lib/editor/page-from-row";

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Typed Server Action replacements for the editor page/layer mutations.
 *
 * The Drizzle schema exports the table as `page` (the SQL table is `pages`).
 * The table is imported as `pageTable` here so fetched page rows can safely be
 * named `page` without shadowing the table object used by Drizzle queries.
 */

function toErrorResult(
  error: unknown,
  fallbackMessage: string,
): ActionResult<never> {
  const isKnownAppError =
    error instanceof UnauthenticatedError ||
    error instanceof ForbiddenError ||
    error instanceof NotFoundError;

  if (isKnownAppError) {
    const message = error instanceof Error ? error.message : fallbackMessage;
    return { success: false, error: message };
  }

  logger.error(fallbackMessage, { error });
  return { success: false, error: fallbackMessage };
}

/** A sibling whose `order` was shifted to make room for an inserted page. */
export interface PageOrderUpdate {
  id: string;
  order: number;
}

/**
 * Result of any action that inserts a page into the funnel's flat order.
 * `orderUpdates` lists ONLY the existing pages whose `order` moved (+1), so
 * the client can merge them without replacing whole page rows (which would
 * clobber un-autosaved layer edits on other pages).
 */
export interface InsertedPageResult {
  page: PageRow;
  orderUpdates: PageOrderUpdate[];
}

/** The one slug a dynamic (CMS-driven) page uses. */
const DYNAMIC_PAGE_SLUG = "*";

function defaultPageSettings(): PageSettings {
  return {
    seo: { image: null, title: "", description: "", noindex: false },
    custom_code: { head: "", body: "" },
  };
}

/**
 * Insert `row` at `desiredOrder` in the funnel's flat page order, shifting
 * every page at or after that position by +1 — atomically. `order` is a
 * plain (non-unique) indexed column, so the single UPDATE can't trip a
 * uniqueness check mid-shift.
 */
async function insertPageAtOrder(
  funnelId: string,
  row: PageRow,
): Promise<PageOrderUpdate[]> {
  return db.transaction(async (tx) => {
    const shifted = await tx
      .update(pageTable)
      .set({ order: sql`${pageTable.order} + 1` })
      .where(
        and(eq(pageTable.funnelId, funnelId), gte(pageTable.order, row.order)),
      )
      .returning({ id: pageTable.id, order: pageTable.order });

    await tx.insert(pageTable).values(row);
    return shifted;
  });
}

export async function createPageAction(
  campaignId: string,
  input: {
    title: string;
    pageType: PageType;
    /** Client-proposed slug; re-validated and made unique here. */
    slug?: string;
    /** Desired position in the flat order; clamped to [0, max + 1]. */
    order?: number;
    /** Only `cms` is honoured (and only with `isDynamic`). */
    settings?: PageSettings;
    isDynamic?: boolean;
  },
): Promise<ActionResult<InsertedPageResult>> {
  try {
    const { campaign } = await requireCampaignEditPermission(campaignId);

    const title = input.title.trim();
    if (!title) {
      return { success: false, error: "A page name is required." };
    }

    const funnelRow = await db.query.funnel.findFirst({
      where: { campaignId: campaign.id },
    });
    if (!funnelRow) {
      throw new Error(`Campaign ${campaignId} has no associated funnel.`);
    }

    const existingPages = await db.query.page.findMany({
      where: { funnelId: funnelRow.id },
    });

    // Only one page may render at "/" — never create a second landing page.
    if (
      input.pageType === "landing_page" &&
      existingPages.some((p) => p.pageType === "landing_page")
    ) {
      return {
        success: false,
        error: "This funnel already has a landing page.",
      };
    }

    const isDynamic = Boolean(input.isDynamic);
    const cms = input.settings?.cms;
    if (isDynamic && !(cms?.collection_id && cms.slug_field_id)) {
      return {
        success: false,
        error: "A dynamic page needs a collection with a slug field.",
      };
    }

    let slug: string;
    if (isDynamic) {
      slug = DYNAMIC_PAGE_SLUG;
      if (existingPages.some((p) => p.slug === slug)) {
        return {
          success: false,
          error: "This funnel already has a dynamic page.",
        };
      }
    } else {
      const proposedSlug = input.slug ?? "";
      const requested = sanitizeSlug(proposedSlug) ? proposedSlug : title;
      const existingForSlugs = pagesFromRows(existingPages);
      slug =
        generateUniqueSlug(requested, existingForSlugs, null, false) ||
        generateUniqueSlug("page", existingForSlugs, null, false);
    }

    const maxOrder =
      existingPages.length > 0
        ? Math.max(...existingPages.map((p) => p.order))
        : -1;
    const desiredOrder = Math.min(
      Math.max(0, Math.floor(input.order ?? maxOrder + 1)),
      maxOrder + 1,
    );

    const settings: PageSettings = {
      ...defaultPageSettings(),
      ...(isDynamic && cms
        ? {
            cms: {
              collection_id: cms.collection_id,
              slug_field_id: cms.slug_field_id,
            },
          }
        : {}),
    };

    const bodyLayer: Layer = {
      id: "body",
      name: "body",
      classes: "",
      children: [],
    };

    const now = new Date();
    const newPage: PageRow = {
      id: nanoid(),
      funnelId: funnelRow.id,
      slug,
      name: title,
      order: desiredOrder,
      depth: 0,
      pageType: input.pageType,
      contentHash: null,
      isDynamic,
      layers: [bodyLayer],
      settings,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
    };

    const orderUpdates = await insertPageAtOrder(funnelRow.id, newPage);

    return { success: true, data: { page: newPage, orderUpdates } };
  } catch (error) {
    return toErrorResult(error, "Failed to create page.");
  }
}

export async function duplicatePageAction(
  campaignId: string,
  pageId: string,
): Promise<ActionResult<InsertedPageResult>> {
  try {
    const { page } = await requirePageInCampaign(campaignId, pageId);

    // The landing page owns "/", and a funnel supports a single dynamic page
    // (slug "*" is unique per funnel) — a copy of either would collide.
    if (page.pageType === "landing_page") {
      return { success: false, error: "The landing page can't be duplicated." };
    }
    if (page.isDynamic) {
      return {
        success: false,
        error:
          "A funnel can only have one dynamic page, so it can't be duplicated.",
      };
    }

    const siblings = await db.query.page.findMany({
      where: { funnelId: page.funnelId },
    });

    const baseTitle = `${page.name} (Copy)`;
    let name = baseTitle;
    let suffix = 2;
    while (siblings.some((candidate) => candidate.name === name)) {
      name = `${page.name} (Copy ${suffix++})`;
    }

    const siblingsForSlugs = pagesFromRows(siblings);
    const slug =
      generateUniqueSlug(name, siblingsForSlugs, null, false) ||
      generateUniqueSlug("page", siblingsForSlugs, null, false);

    const now = new Date();
    const duplicate: PageRow = {
      ...page,
      id: nanoid(),
      name,
      slug,
      // Immediately after the original; everything from there on shifts +1.
      order: page.order + 1,
      isDynamic: false,
      layers: structuredClone(page.layers),
      settings: structuredClone(page.settings),
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
    };

    const orderUpdates = await insertPageAtOrder(page.funnelId, duplicate);
    return { success: true, data: { page: duplicate, orderUpdates } };
  } catch (error) {
    return toErrorResult(error, "Failed to duplicate page.");
  }
}

export async function updatePageAction(
  campaignId: string,
  pageId: string,
  updates: Partial<Pick<PageRow, "name" | "slug" | "settings" | "pageType">>,
): Promise<ActionResult<PageRow>> {
  try {
    const { page } = await requirePageInCampaign(campaignId, pageId);

    if (updates.slug && updates.slug !== page.slug) {
      const siblings = await db.query.page.findMany({
        where: { funnelId: page.funnelId },
      });
      if (
        siblings.some(
          (candidate) =>
            candidate.id !== pageId && candidate.slug === updates.slug,
        )
      ) {
        return {
          success: false,
          error: `A page with the slug "${updates.slug}" already exists in this funnel.`,
        };
      }
    }

    await db.update(pageTable).set(updates).where(eq(pageTable.id, pageId));

    const updated = await db.query.page.findFirst({
      where: { id: pageId },
    });
    if (!updated) {
      throw new NotFoundError("Page not found after update.", { pageId });
    }

    return { success: true, data: updated };
  } catch (error) {
    return toErrorResult(error, "Failed to update page.");
  }
}

export async function deletePageAction(
  campaignId: string,
  pageId: string,
): Promise<ActionResult<{ deletedId: string }>> {
  try {
    const { page } = await requirePageInCampaign(campaignId, pageId);

    if (page.pageType === "landing_page") {
      return { success: false, error: "The landing page can't be deleted." };
    }

    await db.delete(pageTable).where(eq(pageTable.id, pageId));

    return { success: true, data: { deletedId: pageId } };
  } catch (error) {
    return toErrorResult(error, "Failed to delete page.");
  }
}

export async function reorderPagesAction(
  campaignId: string,
  orderedPageIds: string[],
): Promise<ActionResult<{ updated: number }>> {
  try {
    const { campaign } = await requireCampaignEditPermission(campaignId);

    const funnelRow = await db.query.funnel.findFirst({
      where: { campaignId: campaign.id },
      orderBy: { createdAt: "asc" },
    });
    if (!funnelRow) {
      throw new Error(`Campaign ${campaignId} has no associated funnel.`);
    }

    const existingPages = await db.query.page.findMany({
      where: { funnelId: funnelRow.id },
    });
    const validIds = new Set(existingPages.map((p) => p.id));
    if (
      orderedPageIds.length !== existingPages.length ||
      new Set(orderedPageIds).size !== orderedPageIds.length ||
      !orderedPageIds.every((id) => validIds.has(id))
    ) {
      return {
        success: false,
        error: "Page list does not match this funnel's current pages.",
      };
    }

    await db.transaction(async (tx) => {
      await Promise.all(
        orderedPageIds.map((id, index) =>
          tx
            .update(pageTable)
            .set({ order: index })
            .where(eq(pageTable.id, id)),
        ),
      );
    });

    return { success: true, data: { updated: orderedPageIds.length } };
  } catch (error) {
    return toErrorResult(error, "Failed to reorder pages.");
  }
}

export async function saveDraftLayersAction(
  campaignId: string,
  pageId: string,
  layers: Layer[],
): Promise<ActionResult<{ savedAt: string }>> {
  try {
    await requirePageInCampaign(campaignId, pageId);

    await db.update(pageTable).set({ layers }).where(eq(pageTable.id, pageId));

    return { success: true, data: { savedAt: new Date().toISOString() } };
  } catch (error) {
    return toErrorResult(error, "Failed to save page.");
  }
}

/**
 * Creates an editor snapshot of the current page tree. This is intentionally
 * limited to the fields represented by the current page schema; the complete
 * public funnel payload compiler is a separate concern.
 */
export async function publishFunnelAction(
  campaignId: string,
): Promise<ActionResult<{ versionNumber: number }>> {
  try {
    const { campaign } = await requireCampaignEditPermission(campaignId);

    const funnelRow = await db.query.funnel.findFirst({
      where: { campaignId: campaign.id },
      orderBy: { createdAt: "asc" },
    });
    if (!funnelRow) {
      throw new Error(`Campaign ${campaignId} has no associated funnel.`);
    }

    const funnelPages = await db.query.page.findMany({
      where: { funnelId: funnelRow.id },
      orderBy: { order: "asc" },
    });

    const previousVersions = await db.query.funnelVersions.findMany({
      where: { funnelId: funnelRow.id },
    });
    const nextVersionNumber =
      previousVersions.length > 0
        ? Math.max(
            ...previousVersions.map((version) => version.versionNumber),
          ) + 1
        : 1;

    const now = new Date();
    const newVersionId = nanoid();

    await db.transaction(async (tx) => {
      await tx
        .update(funnelVersions)
        .set({ isCurrent: false })
        .where(eq(funnelVersions.funnelId, funnelRow.id));

      await tx.insert(funnelVersions).values({
        id: newVersionId,
        funnelId: funnelRow.id,
        versionNumber: nextVersionNumber,
        compiledSchema: {
          pages: funnelPages.map((currentPage) => ({
            id: currentPage.id,
            slug: currentPage.slug,
            name: currentPage.name,
            order: currentPage.order,
            pageType: currentPage.pageType,
            settings: currentPage.settings,
            layers: currentPage.layers,
          })),
        },
        isCurrent: true,
        publishedAt: now,
      });

      await Promise.all(
        funnelPages.map((currentPage) =>
          tx
            .update(pageTable)
            .set({ publishedAt: now })
            .where(eq(pageTable.id, currentPage.id)),
        ),
      );
    });

    return { success: true, data: { versionNumber: nextVersionNumber } };
  } catch (error) {
    return toErrorResult(error, "Failed to publish funnel.");
  }
}
