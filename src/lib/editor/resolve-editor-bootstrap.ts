// path: src/lib/editor/resolve-editor-bootstrap.ts

import "server-only";
import { cache } from "react";
import type { InferSelectModel } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { funnel } from "@/drizzle/schemas/campaigns-schema";
import { page } from "@/drizzle/schemas/funnel-content-schema";
import { component, layerStyle } from "@/drizzle/schemas/design-system-schema";
import {
  requireCampaignEditPermission,
  type CampaignRow,
} from "@/lib/auth/require-campaign-permission";
import { logger } from "@/lib/logger";
import type {
  Asset,
  AssetFolder,
  Component,
  LayerStyle,
  Page,
} from "@/types/funnel";
import { pagesFromRows } from "@/lib/editor/page-from-row";
import {
  componentsFromRows,
  layerStylesFromRows,
} from "@/lib/editor/design-system-from-row";
import { collectReferencedAssetIds } from "@/lib/editor/bootstrap/collect-asset-ids";
import { runSection } from "@/lib/editor/bootstrap/instrument";
import {
  loadAssetFoldersAndLibraryPage,
  loadAssetsByIds,
  mergeAssets,
} from "@/lib/editor/bootstrap/load-assets";
import { loadCollectionsBootstrap } from "@/lib/editor/bootstrap/load-collections";
import type {
  AssetsBootstrapData,
  BootstrapSection,
  CollectionsBootstrapData,
} from "@/lib/editor/bootstrap/types";

export type FunnelRow = InferSelectModel<typeof funnel>;
export type PageRow = InferSelectModel<typeof page>;
export type ComponentRow = InferSelectModel<typeof component>;
export type LayerStyleRow = InferSelectModel<typeof layerStyle>;

/**
 * The server → client editor payload. Everything below `funnel` is already
 * mapped to the domain types the Zustand stores speak (plain JSON-safe data,
 * no Drizzle rows), so the client hydrates with zero transformation.
 */
export interface EditorBootstrapContext {
  campaign: CampaignRow;
  funnel: FunnelRow;
  /** Ordered by `page.order` ascending — the funnel's step sequence. */
  pages: Page[];
  /** Org-wide reusable components — see design-system-schema.ts's TENANCY note. */
  components: Component[];
  /** Org-wide reusable style chips — same scope as `components`. */
  layerStyles: LayerStyle[];
  /**
   * Media library (organization-scoped): all folders + a bounded asset
   * subset. OPTIONAL section — a failure degrades to `status: "error"`
   * instead of failing the editor.
   */
  assets: BootstrapSection<AssetsBootstrapData>;
  /**
   * CMS collections (funnel-scoped): collections, fields, and the first page
   * of items per collection. OPTIONAL section, same degradation rule.
   */
  collections: BootstrapSection<CollectionsBootstrapData>;
  /** ISO timestamp of when the server assembled this payload. */
  generatedAt: string;
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Server-first replacement for Ycode's `GET /ycode/api/editor/init` (see
 * that route's own source: a client-triggered REST call, fired from a
 * `useEffect` after the builder mounts, that `Promise.allSettled`s ~13
 * parallel repository reads and hydrates Zustand stores from the
 * response). That pattern means every editor mount pays a network
 * round-trip plus a loading-spinner frame before any content can render.
 *
 * This resolver is called from `campaign/[campaignId]/edit/layout.tsx` — a
 * Server Component — so the equivalent data is fetched during the initial
 * render, before anything reaches the browser, and passed down as props
 * through `EditorLayoutClient` to `CampaignEditorMain`. Because Next.js
 * layouts persist across sub-route navigation within the same segment
 * (`pages/[pageId]` → `pages/[otherPageId]` doesn't remount
 * `layout.tsx`), this only runs once per distinct `campaignId`, not once
 * per navigation — the same "don't repeat expensive data loads" property
 * the persistent-builder pattern is designed for, just achieved server-side
 * instead of via a persisted client store.
 *
 * SCOPE: pages (ordered), the organization's reusable components/layer
 * styles, the media library (assets + folders) and the funnel's CMS
 * collections. Deliberately excludes `funnelVersions` (publish snapshots,
 * not editable draft data) and Ycode's settings/locales/fonts/maps entries,
 * which have no ThawKit backing yet.
 *
 * TWO TIERS:
 *   - CRITICAL (pages, components, layerStyles): all-or-nothing, as before.
 *   - OPTIONAL (assets, collections): isolated by `runSection` — a failure
 *     is logged against the section and delivered as `status: "error"`, so
 *     page editing never dies because a CMS or media query broke.
 *
 * LOAD ORDER: wave 1 runs the critical reads, the collections loader and the
 * independent half of the assets loader (folders + first library page) in
 * parallel. Wave 2 loads the assets the content REFERENCES — their ids can
 * only be known once pages, components, styles and CMS values are in hand.
 * Every query is tenant-scoped from `campaign` / `funnelRow` (validated
 * above), never from client input.
 *
 * MAPPING happens here, on the server: rows never cross the RSC boundary,
 * and the client payload carries only the fields the editor's domain types
 * define.
 *
 * DIAGNOSTIC PATTERN: uses `Promise.allSettled` + per-task failure
 * logging, then re-throws if anything failed — ported directly from
 * Ycode's own `editor/init` route. This is NOT fault-tolerance (a failed
 * query still fails the whole bootstrap, matching this codebase's
 * "structured logging" standard) — it exists purely so a failure is
 * logged against the specific query that caused it (`pages` vs
 * `components` vs `layerStyles`) instead of being flattened into one
 * generic error with no indication of which read broke.
 *
 * Wrapped in `cache()` so any other Server Component in this request tree
 * that also needs this data (there are none yet, but Phase 5+ likely will)
 * dedupes to the same single set of queries.
 * ─────────────────────────────────────────────────────────────────────────
 */
export const resolveEditorBootstrap = cache(
  async (campaignId: string): Promise<EditorBootstrapContext> => {
    const { campaign } = await requireCampaignEditPermission(campaignId);

    const funnelRow = await db.query.funnel.findFirst({
      where: { campaignId },
      orderBy: { createdAt: "asc" },
    });

    if (!funnelRow) {
      // Data-integrity violation, not a normal denial/not-found path —
      // campaigns are created with a default funnel in the same DB
      // transaction (see campaigns-schema.ts / project history), so a
      // campaign with zero funnels means that invariant was broken
      // somewhere else, not that the caller did anything wrong. Thrown
      // (not redirected) so it reaches Next.js's nearest error boundary as
      // a genuine 500 — silently redirecting here would hide a real bug.
      logger.error("Campaign has no funnel — invariant violation", {
        campaignId,
      });
      throw new Error(
        `Campaign ${campaignId} has no associated funnel. This should be ` +
          `impossible — campaigns are created with a default funnel atomically.`,
      );
    }

    const tasks = {
      // FIXED: was db.query.pages (undefined — nothing named `pages` is
      // imported in this file) referencing pages.funnelId/pages.order from
      // the same undefined binding. The table's export is `page`
      // (singular) — see funnel-content-schema.ts's naming note.
      pages: db.query.page.findMany({
        where: { funnelId: funnelRow.id },
        orderBy: { order: "asc" },
      }),
      components: db.query.component.findMany({
        where: { organizationId: campaign.organizationId },
      }),
      layerStyles: db.query.layerStyle.findMany({
        where: { organizationId: campaign.organizationId },
      }),
    } as const;

    // OPTIONAL sections start now so they overlap the critical reads. They
    // never reject (runSection converts failures), so there is no unhandled
    // rejection even if the critical tier throws first.
    const logContext = { campaignId, funnelId: funnelRow.id };
    const collectionsPromise = runSection("collections", logContext, () =>
      loadCollectionsBootstrap(funnelRow.id),
    );
    const assetsBasePromise = runSection("assets", logContext, () =>
      loadAssetFoldersAndLibraryPage(campaign.organizationId),
    );

    const taskKeys = Object.keys(tasks) as (keyof typeof tasks)[];
    const settled = await Promise.allSettled(Object.values(tasks));

    const failures = settled
      .map((result, index) => ({ key: taskKeys[index], result }))
      .filter(
        (
          entry,
        ): entry is {
          key: keyof typeof tasks;
          result: PromiseRejectedResult;
        } => entry.result.status === "rejected",
      );

    if (failures.length > 0) {
      for (const { key, result } of failures) {
        logger.error(`Editor bootstrap: "${key}" failed`, {
          campaignId,
          funnelId: funnelRow.id,
          key,
          error: result.reason,
        });
      }
      throw new Error(
        `Editor bootstrap failed: ${failures.map((f) => f.key).join(", ")}`,
      );
    }

    const [pageRows, componentRows, layerStyleRows] = settled.map(
      (result) => (result as PromiseFulfilledResult<unknown>).value,
    ) as [PageRow[], ComponentRow[], LayerStyleRow[]];

    const pages = pagesFromRows(pageRows);
    const components = componentsFromRows(componentRows);
    const layerStyles = layerStylesFromRows(layerStyleRows);

    const [collections, assetsBase] = await Promise.all([
      collectionsPromise,
      assetsBasePromise,
    ]);

    // Wave 2 — assets referenced by the content just loaded.
    const assets = await resolveAssetsSection(
      assetsBase,
      campaign.organizationId,
      logContext,
      {
        json: [pages, components, layerStyles],
        fields: collections.status === "ready" ? collections.data.fields : {},
        items: collections.status === "ready" ? collections.data.items : {},
      },
    );

    return {
      campaign,
      funnel: funnelRow,
      pages,
      components,
      layerStyles,
      assets,
      collections,
      generatedAt: new Date().toISOString(),
    };
  },
);

/**
 * Merges the base assets section (folders + library page) with the assets the
 * content references. If either half fails the whole section is `error` —
 * a half-populated library would silently render missing images.
 */
async function resolveAssetsSection(
  base: BootstrapSection<{ folders: AssetFolder[]; assets: Asset[] }>,
  organizationId: string,
  logContext: Record<string, unknown>,
  sources: Parameters<typeof collectReferencedAssetIds>[0],
): Promise<BootstrapSection<AssetsBootstrapData>> {
  if (base.status === "error") return base;

  const referencedIds = collectReferencedAssetIds(sources);
  const referenced = await runSection(
    "assets:referenced",
    { ...logContext, referencedCount: referencedIds.length },
    () => loadAssetsByIds(organizationId, referencedIds),
  );
  if (referenced.status === "error") {
    return { status: "error", error: "Failed to load assets." };
  }

  return {
    status: "ready",
    data: {
      folders: base.data.folders,
      // Referenced first: they are the ones the canvas needs to paint.
      assets: mergeAssets(referenced.data, base.data.assets),
    },
  };
}
