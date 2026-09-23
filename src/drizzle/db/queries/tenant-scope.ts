// path: src/db/queries/tenant-scope.ts
"use server";
import { db } from "@/drizzle/db";

/**
 * ─── Tenant Scoping Helpers ──────────────────────────────────────────────────
 *
 * UNCHANGED by the Postgres migration. RQBv2 object filters compile to
 * whichever dialect `db` was built with, so nothing here is MySQL- or
 * Postgres-specific.
 *
 * Module 1 / Module 14 of the architecture roadmap require tenant isolation
 * to be enforced "at the data access layer, not the application layer."
 * These functions are the intended single choke point for reading any
 * tenant-owned table — the goal is that forgetting the organizationId filter
 * becomes a compile error rather than a silent cross-tenant data leak in a
 * hand-written `db.select()`.
 *
 * `organizationId` here is Better-Auth's `organization.id` — organization
 * IS ThawKit's Workspace entity (see relations.ts).
 *
 * As Phase 3 introduces the rest of the funnel domain (pages, sections,
 * submissions, contacts, audiences — every one of which will carry its own
 * direct organizationId per the Phase 2 denormalization pattern), extend
 * this file with one scoped accessor per table rather than reaching for
 * `db.select()` / `db.query.*` directly from a route handler or server
 * action.
 *
 * NOTE ON KEYS: `db.query.campaign` / `db.query.funnel` are singular because
 * the `db.query` keys come from the EXPORT NAMES in the schema barrel, not
 * the SQL table names (which remain "campaigns" / "funnels").
 * ─────────────────────────────────────────────────────────────────────────────
 */

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantScopeError";
  }
}

/**
 * Fails loudly on a missing/empty tenant id rather than letting an
 * undefined value silently build a WHERE clause that could be satisfied
 * unexpectedly. Every function below routes through this first.
 *
 * This matters MORE under RQBv2: an object filter whose value is `undefined`
 * is dropped from the generated SQL rather than producing a type error, so
 * an unguarded `where: { organizationId: undefined }` would silently return
 * every row in the table. This assertion is the thing standing between a bad
 * caller and a cross-tenant read.
 */
function assertOrganizationId(
  organizationId: string | undefined | null,
): string {
  if (!organizationId || organizationId.trim() === "") {
    throw new TenantScopeError(
      "Tenant-scoped query attempted with a missing organizationId.",
    );
  }
  return organizationId;
}

// ── Campaigns ────────────────────────────────────────────────────────────────

export async function getCampaignsForOrg(organizationId: string) {
  const orgId = assertOrganizationId(organizationId);
  return db.query.campaign.findMany({
    where: { organizationId: orgId },
  });
}

export async function getCampaignForOrg(
  organizationId: string,
  campaignId: string,
) {
  const orgId = assertOrganizationId(organizationId);
  // Both conditions are required — campaignId alone is guessable/enumerable.
  // The organizationId condition is what actually prevents cross-tenant
  // access via a leaked or brute-forced campaign id. Sibling keys in a v2
  // filter object are ANDed.
  return db.query.campaign.findFirst({
    where: {
      id: campaignId,
      organizationId: orgId,
    },
  });
}

// ── Funnels ──────────────────────────────────────────────────────────────────

export async function getFunnelsForOrg(organizationId: string) {
  const orgId = assertOrganizationId(organizationId);
  return db.query.funnel.findMany({
    where: { organizationId: orgId },
  });
}

export async function getFunnelForOrg(
  organizationId: string,
  funnelId: string,
) {
  const orgId = assertOrganizationId(organizationId);
  return db.query.funnel.findFirst({
    where: {
      id: funnelId,
      organizationId: orgId,
    },
  });
}
