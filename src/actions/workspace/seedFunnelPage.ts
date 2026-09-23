// path: src/lib/funnels/seed-default-pages.ts

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Seeds the two `pages` rows every new funnel is expected to start with:
 * a `landing_page` (the funnel's entry point) and a `result_page` (the
 * funnel's terminal page). Extracted out of createCampaign's transaction
 * into its own module for two reasons:
 *
 *   1. TESTABILITY: `buildDefaultPagesForFunnel` is pure (no DB, no I/O),
 *      so the exact shape of a "freshly seeded" page can be asserted in a
 *      unit test without spinning up MySQL.
 *   2. REUSE: `funnels` can in principle be created from more than one
 *      call site (today: only inside createCampaign's transaction: but a
 *      future "add another funnel to this campaign" action would need the
 *      exact same seeding, and duplicating it inline a second time is
 *      exactly the kind of drift this codebase's own comments repeatedly
 *      flag as a problem elsewhere — see runtime-schema.ts's `answers`
 *      table note, funnel-content-schema.ts's TENANCY note, etc.
 *
 * TRANSACTION SAFETY: `seedDefaultPagesForFunnel` takes a transaction
 * handle, not the top-level `db` — it must always be called with the SAME
 * transaction used to insert the funnel row itself. Calling it against
 * `db` directly would reopen the exact "funnel without its dependents"
 * dead-end createCampaign's own comment already warns about for
 * campaign/funnel, just one level down.
 * ─────────────────────────────────────────────────────────────────────────
 */

import "server-only";
import { nanoid } from "nanoid";
import { db } from "@/drizzle/db";
//import { pages } from "@/drizzle/schemas/funnel-content-schema";
import type { Layer, PageSettings } from "@/types/funnel";
import { PageRow } from "@/lib/editor/resolve-editor-bootstrap";
import { page } from "@/drizzle/schema";

/**
 * Derives the transaction-handle type directly from `db.transaction`'s own
 * callback signature, rather than importing and re-declaring a
 * `MySqlTransaction<...>` generic by hand. This way, if the drizzle client
 * config in `@/drizzle/db` ever changes, this type updates automatically
 * instead of silently drifting out of sync with the real transaction type.
 */
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Centralized so nothing else in the codebase needs to re-guess these strings. */
function slugify(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "page"
  );
}
export const DEFAULT_HOME_PAGE_SLUG = slugify("home");
export const DEFAULT_RESULT_PAGE_SLUG = slugify("result");

/**
 * Builds (does not insert) the two default page rows for a funnel.
 *
 * - `home` (`landing_page`, order 0, `isLinearDefault: true`): the
 *   funnel's entry point and part of the default linear "next" sequence.
 * - `result` (`result_page`, order 1, `isLinearDefault: false`): the
 *   funnel's terminal page. Deliberately excluded from the default linear
 *   sequence — a result page is reached via branching/audience-match
 *   logic once the funnel completes, not via a plain "next" click. If
 *   that assumption is wrong for how the runner actually resolves the
 *   next page, this is the one flag to flip.
 *
 * Both start with `layers: []` — the same empty state
 * `EditorBody.tsx`'s "No layers yet" placeholder already renders for a
 * page with zero layers, so this is a supported first-class state, not a
 * stand-in that needs special-casing anywhere downstream.
 */
export function buildDefaultPagesForFunnel({
  funnelId,
  now,
}: {
  funnelId: string;
  now: Date;
}): [PageRow, PageRow] {
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

  const homePage: PageRow = {
    id: nanoid(),
    funnelId,
    slug: DEFAULT_HOME_PAGE_SLUG,
    name: "Home",
    order: 0,
    depth: 0,
    pageType: "landing_page",
    contentHash: null,
    isDynamic: false,
    layers: [bodyLayer],
    settings: [pageSettings],
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
  };

  const resultPage: PageRow = {
    id: nanoid(),
    funnelId,
    slug: DEFAULT_RESULT_PAGE_SLUG,
    name: "Result",
    order: 1,
    depth: 0,
    pageType: "result_page",
    contentHash: null,
    isDynamic: false,
    layers: [bodyLayer],
    settings: [pageSettings],
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
  };

  return [homePage, resultPage];
}

/**
 * Inserts the default pages for a freshly created funnel.
 *
 * MUST be called with the same transaction handle used to insert the
 * funnel row — never with the top-level `db` — so a crash between the two
 * inserts can never leave a funnel persisted without its pages.
 */
export async function seedDefaultPagesForFunnel(
  tx: DbTransaction,
  params: { funnelId: string; now: Date },
): Promise<PageRow[]> {
  const pageRows = buildDefaultPagesForFunnel(params);
  await tx.insert(page).values(pageRows);
  return pageRows;
}
