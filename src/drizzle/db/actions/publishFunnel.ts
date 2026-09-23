// path: src/db/actions/publishFunnel.ts

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Publishes the current DRAFT state of a funnel: compiles it via
 * compileFunnelPayload(), writes a new immutable `funnel_versions` row,
 * marks it current (unmarking whatever was previously current), and flips
 * `funnel.status`/`publishedAt`. This is the ONLY code path that should
 * ever write `isCurrent = true` — see the versioning note at the top of
 * funnel-content-schema.ts.
 *
 * This is what `submissions.funnelVersionId` (runtime-schema.ts) resolves
 * against — a respondent starting a funnel run always gets whatever
 * version this function most recently marked current, never the live
 * draft, so an operator editing scoring weights mid-campaign can never
 * retroactively change an in-progress or already-completed submission's
 * score (architecture roadmap Module 5's core requirement).
 *
 * ─── Postgres note ───────────────────────────────────────────────────────
 * The "at most one isCurrent row per funnel" invariant no longer has to be
 * defended procedurally. Add this to the `funnel_versions` extra-config
 * array in funnel-content-schema.ts:
 *
 *   uniqueIndex("funnel_versions_current_unique_idx")
 *     .on(table.funnelId)
 *     .where(sql`${table.isCurrent}`),
 *
 * The unmark-then-insert order below already satisfies it, and both
 * statements sit in one transaction so the constraint is only checked at
 * commit. Keep the ordering as-is: swapping insert before unmark would trip
 * the index.
 *
 * Unchanged from the MySQL version apart from the `funnel` table import and
 * that comment — the query API is dialect-agnostic.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { funnel } from "@/drizzle/schemas/campaigns-schema";
import { funnelVersions } from "@/drizzle/schemas/funnel-content-schema";
import { compileFunnelPayload } from "../compiler/funnel-compiler";

export type PublishFunnelResult = {
  versionId: string;
  versionNumber: number;
};

/**
 * Throws when the funnel doesn't exist or doesn't belong to
 * `organizationId` — this is an operator action, always tenant-scoped, so
 * unlike the public submission path there's no ambiguity to preserve here;
 * a clear error is the right failure mode for a builder-triggered publish
 * click.
 */
export async function publishFunnel(
  organizationId: string,
  funnelId: string,
): Promise<PublishFunnelResult> {
  const compiled = await compileFunnelPayload(organizationId, funnelId);
  if (!compiled) {
    throw new Error(
      `Funnel ${funnelId} not found for workspace ${organizationId}`,
    );
  }

  return db.transaction(async (tx) => {
    const lastVersion = await tx.query.funnelVersions.findFirst({
      where: { funnelId },
      orderBy: { versionNumber: "desc" },
      columns: { versionNumber: true },
    });
    const nextVersionNumber = (lastVersion?.versionNumber ?? 0) + 1;

    await tx
      .update(funnelVersions)
      .set({ isCurrent: false })
      .where(
        and(
          eq(funnelVersions.funnelId, funnelId),
          eq(funnelVersions.isCurrent, true),
        ),
      );

    const versionId = randomUUID();
    await tx.insert(funnelVersions).values({
      id: versionId,
      funnelId,
      versionNumber: nextVersionNumber,
      compiledSchema: compiled,
      isCurrent: true,
    });

    // Tenant-scoped on the way out too: compileFunnelPayload() already
    // proved ownership, but pinning organizationId here keeps the write
    // safe if that precondition is ever refactored away.
    await tx
      .update(funnel)
      .set({ status: "published", publishedAt: new Date() })
      .where(
        and(eq(funnel.id, funnelId), eq(funnel.organizationId, organizationId)),
      );

    return { versionId, versionNumber: nextVersionNumber };
  });
}
