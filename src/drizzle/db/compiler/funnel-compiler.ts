// db/compiler/funnel-compiler.ts

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Publish-time / preview-time compiler.
 *
 * Reads a funnel's relational rows (funnels, pages, question_categories,
 * audiences) and reassembles them into EXACTLY the `funnelPayloadSchema`
 * shape the frontend already consumes via `initFunnel(schema)` — see
 * store.ts. This is what makes the DB migration close to a no-op for the
 * frontend: nothing downstream of `initFunnel` needs to know whether its
 * argument came from `dummyData/pageData.ts`'s static mock or this
 * compiler.
 *
 * Field-naming note: the target type mixes camelCase
 * (`questionCategories`, `pageType`) and snake_case (`created_at`,
 * `lead_form`) inconsistently — that inconsistency is inherited from
 * pageSchema.ts as authored, not introduced here. Every mapping below is
 * deliberate, matched field-by-field against the real type, not a typo.
 *
 * Tenancy: routed entirely through `funnelQueries.findById`
 * (db/queries/tenant-scope.ts) rather than querying `funnels` directly —
 * the compiler is exactly the kind of internal/background call site that's
 * easy to accidentally trust with a bare funnelId and skip tenant scoping
 * on "because it's internal". It isn't exempt.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { eq, asc } from "drizzle-orm";

import {
  pages as pagesTable,
  questionCategories as categoriesTable,
  audiences as audiencesTable,
} from "@/drizzle/schemas/funnel-content-schema";
import { funnelQueries } from "@/drizzle/db/queries/tenant-scope";
import type {
  funnelPayloadSchema,
  PagePayloadSchema,
  QuestionCategory,
  AudienceDefinition,
} from "@/types/PageCMS/pageSchema";
import { db } from "@/drizzle/db";

function toIsoRequired(d: Date): string {
  return d.toISOString();
}

function toIsoOptional(d: Date | null | undefined): string | undefined {
  return d ? d.toISOString() : undefined;
}

/**
 * Compiles the CURRENT DRAFT state of a funnel (funnels/pages/categories/
 * audiences as they stand right now) into a `funnelPayloadSchema`.
 *
 * This is distinct from reading a `funnel_versions.compiledSchema` row —
 * that's the frozen, already-published snapshot a live respondent's
 * session should actually run against (Module 2's draft-vs-published
 * requirement). This function is what PRODUCES a new snapshot at publish
 * time, and is also useful standalone for builder "preview as respondent"
 * mode, which needs the current unpublished draft, not the last publish.
 *
 * Returns null when the funnel doesn't exist OR doesn't belong to
 * `organizationId` — see the tenant-boundary note on
 * `funnelQueries.findById` for why those two cases are intentionally
 * indistinguishable from the return value alone.
 */
export async function compileFunnelPayload(
  organizationId: string,
  funnelId: string,
): Promise<funnelPayloadSchema | null> {
  const funnel = await funnelQueries.findById(organizationId, funnelId);
  if (!funnel) return null;

  const [pageRows, categoryRows, audienceRows] = await Promise.all([
    db.query.pages.findMany({
      where: eq(pagesTable.funnelId, funnel.id),
      orderBy: asc(pagesTable.order),
    }),
    db.query.questionCategories.findMany({
      where: eq(categoriesTable.funnelId, funnel.id),
      orderBy: asc(categoriesTable.order),
    }),
    db.query.audiences.findMany({
      where: eq(audiencesTable.funnelId, funnel.id),
    }),
  ]);

  // ── Pages ──────────────────────────────────────────────────────────────
  // `sections` comes straight off the JSON column — no reshaping, that's
  // the entire point of the sections-as-JSON decision (see
  // funnel-content-schema.ts). Everything else is a direct field mapping,
  // including the created_at/updated_at -> ISO-string conversion every
  // datetime column needs since pageSchema.ts models timestamps as strings.
  const compiledPages: PagePayloadSchema[] = pageRows.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    order: p.order,
    pageType: p.pageType,
    seo: (p.seo ?? undefined) as PagePayloadSchema["seo"],
    config: (p.config ?? undefined) as PagePayloadSchema["config"],
    sections: p.sections,
    isLinearDefault: p.isLinearDefault,
    created_at: toIsoRequired(p.createdAt),
    updated_at: toIsoRequired(p.updatedAt),
    published_at: toIsoOptional(p.publishedAt),
  }));

  // ── Question categories ───────────────────────────────────────────────
  // `order` (the DB column that exists purely to recover the array's
  // meaningful order — see funnel-content-schema.ts) intentionally does
  // NOT appear on QuestionCategory itself; the ORDER of this array is what
  // encodes it, exactly like the original mock.
  const compiledCategories: QuestionCategory[] = categoryRows.map((c) => ({
    id: c.id,
    title: c.title,
    description: c.description ?? "",
    icon: c.icon ?? "",
  }));

  // ── Audiences ──────────────────────────────────────────────────────────
  const compiledAudiences: AudienceDefinition[] = audienceRows.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description ?? undefined,
    predicate: a.predicate,
    retroactive: a.retroactive,
    created_at: toIsoRequired(a.createdAt),
  }));

  // ── Funnel root ────────────────────────────────────────────────────────
  const compiled: funnelPayloadSchema = {
    id: funnel.id,
    slug: funnel.slug,
    title: funnel.title ?? "",
    status: funnel.status,
    questionCategories: compiledCategories,
    scoreTiers: funnel.scoreTiers ?? undefined,
    audiences: compiledAudiences,
    // `funnelPayloadSchema.config` (FunnelConfig) is an intentionally
    // empty interface in pageSchema.ts today — no funnels-table column
    // backs it because there is nothing in it yet to store. Revisit this
    // mapping if FunnelConfig ever grows real fields.
    theme: funnel.theme ?? undefined,
    lead_form: funnel.leadForm ?? undefined,
    calculations: funnel.calculations ?? undefined,
    pages: compiledPages,
    created_at: toIsoRequired(funnel.createdAt),
    updated_at: toIsoRequired(funnel.updatedAt),
    published_at: toIsoOptional(funnel.publishedAt),
  };

  return compiled;
}
