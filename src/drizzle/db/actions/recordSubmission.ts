// db/actions/recordSubmission.ts

/**
 * ─────────────────────────────────────────────────────────────────────────
 * The real write path behind `submitFunnel` — store.ts's `resolveToResult`
 * currently only does a mock 1.5s `setTimeout` before computing scores
 * entirely client-side. This is that call's server-side counterpart: the
 * authoritative record of what a respondent actually submitted.
 *
 * Deliberately imports `computeFunnelScore`, `calculateVariables`, and
 * `resolveAudienceMembership` from the SAME `stores/funnelStore/helpers.ts`
 * the frontend already uses — not a reimplementation. Architecture roadmap
 * Module 5 requires scoring be "executable in both the client-side runner
 * and the server-side analytics pipeline with guaranteed identical
 * output"; importing the literal same pure function is what actually
 * guarantees that, rather than two hand-written copies quietly drifting
 * apart over time. This only works because helpers.ts has zero React/
 * Zustand/DOM dependencies — it was already written as plain, store-free
 * TypeScript, so it's equally at home in a Route Handler as in the browser.
 *
 * Public path, no operator auth: architecture roadmap Module 1 — "Contacts
 * must never require authentication." Tenancy here comes from the funnel
 * row itself (`funnel.organizationId`), not from an authenticated caller —
 * the ONE thing an anonymous caller must not be able to forge is which
 * workspace a submission lands in, and that's derived server-side from the
 * funnel row, never accepted as a client-supplied field.
 *
 * Runtime note: uses `node:crypto` and the `mysql2` pool directly, so this
 * must run on the Node.js runtime, not the Edge runtime, in whatever Route
 * Handler calls it.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import {
  contacts,
  submissions,
  answers,
  answerSelections,
  audienceMemberships,
  type SubmissionMeta,
} from "@/drizzle/schemas/runtime-schema";
import {
  computeFunnelScore,
  calculateVariables,
  resolveAudienceMembership,
  DEFAULT_SCORE_TIERS,
} from "@/stores/funnelStore/helpers";
import type {
  FunnelAnswers,
  LeadData,
  FunnelScoreResult,
  CalcResults,
  PageSection,
  QuizSectionContent,
  QuestionType,
  funnelPayloadSchema,
} from "@/types/PageCMS/pageSchema";
import { db } from "@/drizzle/db";
import { funnels, funnelVersions } from "@/drizzle/schema";

export type RecordSubmissionInput = {
  funnelId: string;
  /** Omit to resolve the funnel's currently-published version automatically. */
  funnelVersionId?: string;
  answers: FunnelAnswers;
  leadData: LeadData;
  meta?: SubmissionMeta;
};

export type RecordSubmissionResult = {
  submissionId: string;
  contactId: string | null;
  scoreResult: FunnelScoreResult;
  calcResults: CalcResults;
  audienceIds: string[];
};

const NON_CHOICE_TYPES = new Set<QuestionType>([
  "short_text",
  "long_text",
  "number",
  "scale",
]);

export async function recordSubmission(
  input: RecordSubmissionInput,
): Promise<RecordSubmissionResult> {
  // ── 1. Resolve the funnel + the exact version being submitted against ──
  const funnel = await db.query.funnels.findFirst({
    where: eq(funnels.id, input.funnelId),
  });
  if (!funnel) {
    throw new Error(`Funnel ${input.funnelId} not found`);
  }

  const version = input.funnelVersionId
    ? await db.query.funnelVersions.findFirst({
        where: and(
          eq(funnelVersions.id, input.funnelVersionId),
          eq(funnelVersions.funnelId, funnel.id),
        ),
      })
    : await db.query.funnelVersions.findFirst({
        where: and(
          eq(funnelVersions.funnelId, funnel.id),
          eq(funnelVersions.isCurrent, true),
        ),
      });

  if (!version) {
    throw new Error(
      `No published version available for funnel ${input.funnelId}`,
    );
  }

  const compiled = version.compiledSchema as funnelPayloadSchema;
  const allSections: PageSection[] = compiled.pages.flatMap((p) => p.sections);

  // ── 2. Score — the exact same pure function the frontend runs ──────────
  const scoreResult = computeFunnelScore(
    allSections,
    compiled.questionCategories,
    input.answers,
    compiled.scoreTiers ?? DEFAULT_SCORE_TIERS,
  );
  const calcResults = compiled.calculations
    ? calculateVariables(compiled, input.answers)
    : {};

  // ── 3. Audience membership — same story, same pure function ────────────
  const audienceMembershipSet = resolveAudienceMembership(
    compiled.audiences ?? [],
    { answers: input.answers, leadData: input.leadData, scoreResult },
  );

  return db.transaction(async (tx) => {
    // ── 4. Contact dedupe — only when an email was actually captured ─────
    const email =
      typeof input.leadData.email === "string"
        ? input.leadData.email.trim().toLowerCase()
        : "";

    let contactId: string | null = null;

    if (email) {
      const existing = await tx.query.contacts.findFirst({
        where: and(
          eq(contacts.organizationId, funnel.organizationId),
          eq(contacts.email, email),
        ),
      });

      if (existing) {
        contactId = existing.id;
        // Refresh leadData on repeat submissions rather than leaving stale
        // values from a first, possibly-incomplete capture.
        await tx
          .update(contacts)
          .set({ leadData: input.leadData })
          .where(eq(contacts.id, existing.id));
      } else {
        contactId = randomUUID();
        await tx.insert(contacts).values({
          id: contactId,
          organizationId: funnel.organizationId,
          email,
          firstName:
            typeof input.leadData.first_name === "string"
              ? input.leadData.first_name
              : undefined,
          lastName:
            typeof input.leadData.last_name === "string"
              ? input.leadData.last_name
              : undefined,
          phone:
            typeof input.leadData.phone === "string"
              ? input.leadData.phone
              : undefined,
          leadData: input.leadData,
        });
      }
    }

    // ── 5. Submission root record ───────────────────────────────────────
    const submissionId = randomUUID();
    await tx.insert(submissions).values({
      id: submissionId,
      organizationId: funnel.organizationId,
      funnelId: funnel.id,
      funnelVersionId: version.id,
      contactId,
      isCompleted: true,
      overallScore: scoreResult.overallScore,
      categoryScores: scoreResult.categoryScores,
      calcResults,
      meta: input.meta,
      completedAt: new Date(),
    });

    // ── 6. Answers, split by type ───────────────────────────────────────
    // Choice types -> answer_selections (one row per selected option).
    // Everything else -> answers (one row per section). See
    // runtime-schema.ts for why these never overlap.
    const selectionRows: (typeof answerSelections.$inferInsert)[] = [];
    const answerRows: (typeof answers.$inferInsert)[] = [];

    for (const section of allSections) {
      if (section.type !== "quiz") continue;
      const content = section.content as QuizSectionContent;
      const raw = input.answers[section.id];
      if (raw === undefined) continue;

      if (
        content.questionType === "single_choice" ||
        content.questionType === "multiple_choice"
      ) {
        const selected = Array.isArray(raw) ? raw : [];
        for (const optionId of selected) {
          selectionRows.push({
            id: randomUUID(),
            submissionId,
            organizationId: funnel.organizationId,
            sectionId: section.id,
            optionId,
          });
        }
      } else if (NON_CHOICE_TYPES.has(content.questionType)) {
        answerRows.push({
          id: randomUUID(),
          submissionId,
          sectionId: section.id,
          questionType: content.questionType as
            | "short_text"
            | "long_text"
            | "number"
            | "scale",
          textValue: typeof raw === "string" ? raw : undefined,
          // decimal columns take string input in Drizzle's mysql2 dialect
          // to avoid JS float rounding at the driver boundary.
          numberValue: typeof raw === "number" ? String(raw) : undefined,
        });
      }
    }

    if (selectionRows.length > 0) {
      await tx.insert(answerSelections).values(selectionRows);
    }
    if (answerRows.length > 0) {
      await tx.insert(answers).values(answerRows);
    }

    // ── 7. Audience membership — persisted for auditability (Module 9) ──
    if (audienceMembershipSet.size > 0) {
      await tx.insert(audienceMemberships).values(
        Array.from(audienceMembershipSet).map((audienceId) => ({
          id: randomUUID(),
          audienceId,
          submissionId,
          contactId,
        })),
      );
    }

    return {
      submissionId,
      contactId,
      scoreResult,
      calcResults,
      audienceIds: Array.from(audienceMembershipSet),
    };
  });
}
