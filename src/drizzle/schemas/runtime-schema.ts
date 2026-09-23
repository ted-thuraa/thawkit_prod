// db/schemas/runtime-schema.ts

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Runtime / analytics domain — the WRITE-HEAVY path (architecture roadmap
 * Modules 6-9). Everything in campaigns-schema.ts and
 * funnel-content-schema.ts is the operator-facing DRAFT the builder edits;
 * everything here is what gets written once per respondent run, read
 * constantly by the CRM/audience/analytics surfaces, and NEVER read by the
 * public runner itself (Module 6: the runner executes entirely against the
 * CDN-served compiled schema — these tables exist to record what happened
 * after the fact, not to serve the funnel).
 *
 * TENANCY: `organizationId` is denormalized onto `submissions` and
 * `answer_selections` (not just `contacts`, which already needs it as its
 * dedupe key). This one goes a step further than the Phase 2 rationale for
 * `funnels`/`campaigns`: `answer_selections` is filtered by
 * (sectionId, optionId) — Module 8's flagship "contacts who selected
 * Option X" query — and section/option ids are author-chosen strings, NOT
 * guaranteed globally unique (the mock itself uses human-readable ids like
 * "sec_quiz_01" that two different workspaces' funnels could plausibly
 * both produce). Without organizationId directly on this table, a
 * segmentation query filtered only by (sectionId, optionId) is a real
 * cross-tenant leak vector, not just a missed join — which is exactly what
 * Module 1's "structurally impossible... even if an id from another
 * workspace is passed" bar is about. `answers` (free-text/number) has no
 * equivalent documented query pattern, so it's deliberately left without
 * its own organizationId — always reached via submissionId instead.
 *
 * DIALECT: MySQL now, PostgreSQL later — same notes as the other schema
 * files apply: `json()` -> `jsonb()`, `datetime()`+`CURRENT_TIMESTAMP` ->
 * `timestamp()`+`.defaultNow()`, `decimal()` needs no change (both
 * dialects support arbitrary-precision DECIMAL identically).
 * ─────────────────────────────────────────────────────────────────────────
 */

import { sql } from "drizzle-orm";
import {
  mysqlTable,
  varchar,
  datetime,
  text,
  decimal,
  json,
  boolean,
  int,
  mysqlEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import { organization } from "./auth-schema";
//import { funnel } from "./campaigns-schema";

// ─── Submission metadata shape ─────────────────────────────────────────────
//
// Not part of pageSchema.ts (it's captured passively at submission time,
// not authored) — defined locally, matches Module 8's "browser meta-
// information" requirement (UA, referrer, UTM parameters from the URL).
export type SubmissionMeta = {
  userAgent?: string;
  referrer?: string;
  utm?: Record<string, string>;
};

// ─── Contacts ───────────────────────────────────────────────────────────────
//
// Created (or matched) at submission time — see db/actions/recordSubmission.ts
// for the dedupe algorithm. Deliberately NOT created for anonymous
// submissions (lead form disabled, or the respondent used Skip) — a
// submission with no captured email has `submissions.contactId = null`.

// export const contacts = mysqlTable(
//   "contact",
//   {
//     id: varchar("id", { length: 191 }).primaryKey(),
//     organizationId: varchar("organization_id", { length: 191 })
//       .notNull()
//       .references(() => organization.id, { onDelete: "cascade" }),
//     email: varchar("email", { length: 255 }).notNull(),
//     firstName: varchar("first_name", { length: 191 }),
//     lastName: varchar("last_name", { length: 191 }),
//     phone: varchar("phone", { length: 64 }),
//     // Full raw lead-form payload — every custom field an operator's
//     // LeadFormConfig defines (industry, checkboxes, numbers, ...) is
//     // author-configurable per funnel, not a fixed relational shape, so it
//     // stays JSON exactly like theme/lead_form/calculations do on `funnels`.
//     leadData: json("lead_data").$type<LeadData>(),
//     createdAt: datetime("created_at")
//       .notNull()
//       .default(sql`CURRENT_TIMESTAMP`),
//     updatedAt: datetime("updated_at")
//       .notNull()
//       .default(sql`CURRENT_TIMESTAMP`)
//       .$onUpdate(() => new Date()),
//   },
//   (t) => ({
//     orgIdx: index("contact_org_idx").on(t.organizationId),
//     // Module 8's contact dedupe key: email, scoped per workspace. Two
//     // different workspaces are free to both have a contact with the same
//     // email — dedupe is not global.
//     dedupeUnique: uniqueIndex("contact_org_email_idx").on(
//       t.organizationId,
//       t.email,
//     ),
//   }),
// );

// ─── Submissions ────────────────────────────────────────────────────────────
//
// The root record of one respondent's funnel run. References a SPECIFIC
// funnel_version (never the live draft) — this is what makes score
// computation replayable and immune to later edits on the live funnel, per
// architecture roadmap Module 5's "score must always reference the funnel
// version snapshot at submission time" requirement.

// export const submissions = mysqlTable(
//   "submission",
//   {
//     id: varchar("id", { length: 191 }).primaryKey(),
//     // Denormalized tenant scope — see the file-level TENANCY note. This is
//     // the most frequently CRM-queried table in the runtime domain.
//     organizationId: varchar("organization_id", { length: 191 })
//       .notNull()
//       .references(() => organization.id, { onDelete: "cascade" }),
//     funnelId: varchar("funnel_id", { length: 191 })
//       .notNull()
//       .references(() => funnel.id, { onDelete: "cascade" }),
//     funnelVersionId: varchar("funnel_version_id", { length: 191 })
//       .notNull()
//       .references(() => funnelVersions.id),
//     contactId: varchar("contact_id", { length: 191 }).references(
//       () => contacts.id,
//       { onDelete: "set null" },
//     ),

//     isCompleted: boolean("is_completed").notNull().default(false),

//     // Score result, persisted once at submission time (never recomputed on
//     // read) — questionScores are NOT duplicated here since `answers` /
//     // `answer_selections` already hold that same detail relationally and
//     // queryably; storing it a second time in this JSON blob would just be
//     // another place for it to drift.
//     overallScore: int("overall_score"),
//     categoryScores: json("category_scores").$type<CategoryScoreResult[]>(),
//     calcResults: json("calc_results").$type<CalcResults>(),

//     meta: json("meta").$type<SubmissionMeta>(),

//     startedAt: datetime("started_at")
//       .notNull()
//       .default(sql`CURRENT_TIMESTAMP`),
//     completedAt: datetime("completed_at"),
//   },
//   (t) => ({
//     orgIdx: index("submission_org_idx").on(t.organizationId),
//     funnelIdx: index("submission_funnel_idx").on(t.funnelId),
//     versionIdx: index("submission_version_idx").on(t.funnelVersionId),
//     contactIdx: index("submission_contact_idx").on(t.contactId),
//   }),
// );

// ─── Answers (non-choice question types) ───────────────────────────────────
//
// Holds exactly ONE row per section for short_text / long_text / number /
// scale questions. Choice-type answers (single_choice / multiple_choice)
// are NEVER stored here — they live entirely in `answer_selections` below,
// one row per selected option. This split mirrors QuizAnswer's own union
// shape (`string[] | string | number`) and, more importantly, avoids ever
// storing the same answer in two places where they could drift out of sync.
//
// `sectionId` is intentionally NOT a foreign key: it's a snapshot reference
// into a specific `funnel_versions.compiledSchema`, not a live row in
// `pages` — the page/section that produced this answer may since have been
// edited or deleted in the draft, and this record must remain interpretable
// regardless (Module 2's "backward compatibility on schema change"
// requirement).

// export const answers = mysqlTable(
//   "answer",
//   {
//     id: varchar("id", { length: 191 }).primaryKey(),
//     submissionId: varchar("submission_id", { length: 191 })
//       .notNull()
//       .references(() => submissions.id, { onDelete: "cascade" }),
//     sectionId: varchar("section_id", { length: 191 }).notNull(),
//     questionType: mysqlEnum("question_type", [
//       "short_text",
//       "long_text",
//       "number",
//       "scale",
//     ])
//       .notNull()
//       .$type<Exclude<QuestionType, "single_choice" | "multiple_choice">>(),
//     textValue: text("text_value"),
//     // DECIMAL, not FLOAT/DOUBLE — same principle helpers.ts's calc engine
//     // already applies (null propagation over zero fallback for financial
//     // formulas): imprecise floating-point storage on values that feed
//     // calc_ref expressions (MAU, ARPU, churn %) would silently corrupt the
//     // exact figures those formulas depend on. Drizzle's mysql2 decimal
//     // column is typed as `string` for insert/select to avoid JS float
//     // rounding at the boundary — see recordSubmission.ts for the
//     // number -> string conversion at write time.
//     numberValue: decimal("number_value", { precision: 15, scale: 4 }),
//   },
//   (t) => ({
//     submissionIdx: index("answer_submission_idx").on(t.submissionId),
//   }),
// );

// ─── Answer Selections (choice question types) ─────────────────────────────
//
// THE table Module 8 calls out by name: "contacts who selected Option X on
// Question 3" must be queryable without a full table scan. One row per
// selected option (multiple_choice can produce several rows per section
// per submission; single_choice produces exactly one).

// export const answerSelections = mysqlTable(
//   "answer_selection",
//   {
//     id: varchar("id", { length: 191 }).primaryKey(),
//     submissionId: varchar("submission_id", { length: 191 })
//       .notNull()
//       .references(() => submissions.id, { onDelete: "cascade" }),
//     // Denormalized — see the file-level TENANCY note for why this table
//     // specifically needs its own copy rather than relying on a join
//     // through `submissions`.
//     organizationId: varchar("organization_id", { length: 191 })
//       .notNull()
//       .references(() => organization.id, { onDelete: "cascade" }),
//     sectionId: varchar("section_id", { length: 191 }).notNull(),
//     optionId: varchar("option_id", { length: 191 }).notNull(),
//   },
//   (t) => ({
//     submissionIdx: index("selection_submission_idx").on(t.submissionId),
//     // The segmentation query itself: scoped to a workspace first (leftmost
//     // column — matches how every such query will actually be written),
//     // then narrowed by section + option.
//     segmentationIdx: index("selection_org_section_option_idx").on(
//       t.organizationId,
//       t.sectionId,
//       t.optionId,
//     ),
//   }),
// );

// ─── Audience Memberships ───────────────────────────────────────────────────
//
// Persisted, auditable record of audience matches — Module 9: "membership
// changes must be logged for auditability (when did contact X join/leave
// audience Y?)". This is distinct from (and does not replace) the
// frontend's own in-memory `audienceMembership: Set<string>`
// (store.ts) — that Set drives the INSTANT result-page render right after
// submission; these rows are the durable source of truth for CRM
// filtering, export, and webhook delivery afterward. Both are produced by
// the exact same `resolveAudienceMembership()` pure function
// (helpers.ts) — client and server never re-derive membership with
// different logic, per Module 9's "consistent expression language"
// requirement.

// export const audienceMemberships = mysqlTable(
//   "audience_membership",
//   {
//     id: varchar("id", { length: 191 }).primaryKey(),
//     audienceId: varchar("audience_id", { length: 191 })
//       .notNull()
//       .references(() => audiences.id, { onDelete: "cascade" }),
//     submissionId: varchar("submission_id", { length: 191 })
//       .notNull()
//       .references(() => submissions.id, { onDelete: "cascade" }),
//     // Nullable, mirrors submissions.contactId — an anonymous submission
//     // (no captured email) can still match an audience; there's simply no
//     // Contact record to attribute that match to for CRM purposes.
//     contactId: varchar("contact_id", { length: 191 }).references(
//       () => contacts.id,
//       { onDelete: "cascade" },
//     ),
//     joinedAt: datetime("joined_at")
//       .notNull()
//       .default(sql`CURRENT_TIMESTAMP`),
//   },
//   (t) => ({
//     audienceIdx: index("membership_audience_idx").on(t.audienceId),
//     submissionIdx: index("membership_submission_idx").on(t.submissionId),
//     contactIdx: index("membership_contact_idx").on(t.contactId),
//     // One row per (audience, submission) — guards against a duplicate
//     // insert if recordSubmission() were ever retried for the same
//     // submission (e.g. a queued/retried write after a transient failure).
//     uniqueMembership: uniqueIndex("membership_audience_submission_idx").on(
//       t.audienceId,
//       t.submissionId,
//     ),
//   }),
// );
