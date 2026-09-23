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

export type FunnelRow = InferSelectModel<typeof funnel>;
export type PageRow = InferSelectModel<typeof page>;
export type ComponentRow = InferSelectModel<typeof component>;
export type LayerStyleRow = InferSelectModel<typeof layerStyle>;

export interface EditorBootstrapContext {
  campaign: CampaignRow;
  funnel: FunnelRow;
  /** Ordered by `page.order` ascending — the funnel's step sequence. */
  pages: PageRow[];
  /** Org-wide reusable components — see design-system-schema.ts's TENANCY note. */
  components: ComponentRow[];
  /** Org-wide reusable style chips — same scope as `components`. */
  layerStyles: LayerStyleRow[];
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
 * This resolver is called from `campaign/[campaignId]/editor/layout.tsx` — a
 * Server Component — so the equivalent data is fetched during the initial
 * render, before anything reaches the browser, and passed down as props
 * through `EditorLayoutClient` to `CampaignEditorMain`. Because Next.js
 * layouts persist across sub-route navigation within the same segment
 * (`layers/[pageId]` → `layers/[otherPageId]` doesn't remount
 * `layout.tsx`), this only runs once per distinct `campaignId`, not once
 * per navigation — the same "don't repeat expensive data loads" property
 * the persistent-builder pattern is designed for, just achieved server-side
 * instead of via a persisted client store.
 *
 * SCOPE (this pass): loads what the editor's canvas/tree actually needs —
 * a funnel's pages (ordered), and the organization's reusable
 * components/layer-styles. Deliberately excludes:
 *   - `funnelVersions` — publish snapshots, not editable draft data; no
 *     canvas mode reads these.
 *   - `questionCategories`/`audiences` — CMS/Collections and the campaign
 *     audience system are out of scope for the editor itself.
 *   - Ycode's folders/settings/collections/locales/assets/asset-folders/
 *     fonts/mapbox/google-maps entries — folders were rejected in the
 *     schema-design pass (see funnel-content-schema.ts's decision note on
 *     `pages.order`); the rest have no Thawkit backing yet.
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

    return {
      campaign,
      funnel: funnelRow,
      pages: pageRows,
      components: componentRows,
      layerStyles: layerStyleRows,
    };
  },
);
