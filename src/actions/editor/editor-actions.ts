// path: src/lib/actions/editor-actions.ts

"use server";

import { asc, eq } from "drizzle-orm";

import { db } from "@/drizzle/db";
import { funnel } from "@/drizzle/schemas/campaigns-schema";
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

function slugify(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "page"
  );
}

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

export async function createPageAction(
  campaignId: string,
  input: { title: string; pageType: PageType },
): Promise<ActionResult<PageRow>> {
  try {
    const { campaign } = await requireCampaignEditPermission(campaignId);

    const funnelRow = await db.query.funnel.findFirst({
      where: { campaignId: campaign.id },
      //orderBy: asc(funnel.createdAt),
    });
    if (!funnelRow) {
      throw new Error(`Campaign ${campaignId} has no associated funnel.`);
    }

    const existingPages = await db.query.page.findMany({
      where: { funnelId: funnelRow.id },
    });
    const nextOrder =
      existingPages.length > 0
        ? Math.max(...existingPages.map((p) => p.order)) + 1
        : 0;

    const slug = slugify(input.title);
    if (existingPages.some((p) => p.slug === slug)) {
      return {
        success: false,
        error: `A page with a matching slug ("${slug}") already exists in this funnel.`,
      };
    }

    const bodyLayer: Layer = {
      id: "body",
      name: "body",
      classes: "",
      children: [],
    };

    const pageSettings: PageSettings = {
      seo: {
        image: null,
        title: "",
        description: "",
        noindex: false,
      },
      custom_code: {
        head: "",
        body: "",
      },
    };

    const now = new Date();
    const newPage: PageRow = {
      id: nanoid(),
      funnelId: funnelRow.id,
      slug,
      name: input.title,
      order: nextOrder,
      depth: 0,
      pageType: input.pageType,
      contentHash: null,
      isDynamic: false,
      layers: [bodyLayer],
      settings: pageSettings,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
    };

    await db.insert(pageTable).values(newPage);

    return { success: true, data: newPage };
  } catch (error) {
    return toErrorResult(error, "Failed to create page.");
  }
}

export async function duplicatePageAction(
  campaignId: string,
  pageId: string,
): Promise<ActionResult<PageRow>> {
  try {
    const { page } = await requirePageInCampaign(campaignId, pageId);
    const siblings = await db.query.page.findMany({
      where: { funnelId: page.funnelId },
    });

    const baseTitle = `${page.name} Copy`;
    let name = baseTitle;
    let suffix = 2;
    while (siblings.some((candidate) => candidate.name === name)) {
      name = `${baseTitle} ${suffix++}`;
    }

    const baseSlug = slugify(name);
    let slug = baseSlug;
    suffix = 2;
    while (siblings.some((candidate) => candidate.slug === slug)) {
      slug = `${baseSlug}-${suffix++}`;
    }

    const now = new Date();
    const duplicate: PageRow = {
      ...page,
      id: nanoid(),
      name,
      slug,
      order: Math.max(...siblings.map((candidate) => candidate.order), -1) + 1,
      layers: structuredClone(page.layers),
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
    };

    await db.insert(pageTable).values(duplicate);
    return { success: true, data: duplicate };
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
    await requirePageInCampaign(campaignId, pageId);

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
