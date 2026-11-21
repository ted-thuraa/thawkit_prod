// path: src/lib/quiz/options.ts

import {
  OPTION_ID_PATTERN,
  OPTION_ID_PREFIX,
  QUIZ_LIMITS,
} from "./constants";
import type { QuizIssue } from "./types";

/**
 * The `answer_options` field value: a JSON array stored as text in
 * `collection_item_values.value` (same storage pattern as multi-reference and
 * multi-asset fields). This module parses, canonicalises and serialises it.
 *
 * READ is tolerant (unknown keys are ignored); WRITE is strict and canonical
 * (known keys only, fixed key order, trimmed strings), so what is stored is
 * always the validated shape.
 */

export interface StoredAnswerOption {
  id: string;
  title: string;
  description?: string;
  score: number;
  icon?: string;
  image?: { asset_id: string };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isAssetId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** `opt_` + 8 random chars. Uses Web Crypto (browser and Node ≥ 19). */
export function generateOptionId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  let id = OPTION_ID_PREFIX;
  for (const b of bytes) id += ID_ALPHABET[b % ID_ALPHABET.length];
  return id;
}

export type ParsedOptionsJson =
  | { kind: "empty" }
  | { kind: "ok"; items: unknown[] }
  | { kind: "invalid" };

/** Parses the stored text. Absent/blank ⇒ empty; non-array / bad JSON ⇒ invalid. */
export function parseAnswerOptionsJson(
  raw: string | null | undefined,
): ParsedOptionsJson {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return { kind: "empty" };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? { kind: "ok", items: parsed }
      : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function issue(
  code: QuizIssue["code"],
  message: string,
): QuizIssue {
  return { role: "options", code, message };
}

function optionalTrimmed(
  value: unknown,
  max: number,
  label: string,
  n: number,
  issues: QuizIssue[],
): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") {
    issues.push(issue("invalid", `Option ${n}: ${label} must be text.`));
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    issues.push(
      issue("too_long", `Option ${n}: ${label} must be at most ${max} characters.`),
    );
    return undefined;
  }
  return trimmed === "" ? undefined : trimmed;
}

export interface CanonicalizeResult {
  options: StoredAnswerOption[];
  issues: QuizIssue[];
}

/**
 * Validates and canonicalises raw option objects.
 *
 * `generateId` decides what happens to an option without an id:
 *  - a generator (the default; used by WRITERS) assigns one, so imports and API
 *    consumers may omit ids;
 *  - `null` (used when READING) reports the missing id as an issue — reading
 *    must be deterministic and side-effect free.
 * An id that is present must match `OPTION_ID_PATTERN` and be unique.
 * Count minimums are NOT checked here (they depend on the question type —
 * see `validate.ts`); the upper bound is, to cap the work done on hostile input.
 */
export function canonicalizeAnswerOptions(
  items: readonly unknown[],
  generateId: (() => string) | null = generateOptionId,
): CanonicalizeResult {
  const issues: QuizIssue[] = [];
  const options: StoredAnswerOption[] = [];

  if (items.length > QUIZ_LIMITS.optionsMax) {
    return {
      options,
      issues: [
        issue(
          "too_many",
          `A question can have at most ${QUIZ_LIMITS.optionsMax} answer options.`,
        ),
      ],
    };
  }

  const seen = new Set<string>();

  items.forEach((item, index) => {
    const n = index + 1;
    if (!isRecord(item)) {
      issues.push(issue("invalid", `Option ${n} is not a valid object.`));
      return;
    }
    const before = issues.length;

    // id
    let id: string;
    if (item.id === undefined || item.id === null || item.id === "") {
      if (generateId) {
        id = generateId();
      } else {
        issues.push(issue("required", `Option ${n}: id is required.`));
        id = "";
      }
    } else if (
      typeof item.id === "string" &&
      OPTION_ID_PATTERN.test(item.id)
    ) {
      id = item.id;
    } else {
      issues.push(issue("invalid", `Option ${n}: invalid id.`));
      id = "";
    }
    if (id && seen.has(id)) {
      issues.push(issue("duplicate", `Option ${n}: duplicate option id.`));
    }
    if (id) seen.add(id);

    // title
    let title = "";
    if (typeof item.title !== "string" || item.title.trim() === "") {
      issues.push(issue("required", `Option ${n}: title is required.`));
    } else {
      title = item.title.trim();
      if (title.length > QUIZ_LIMITS.optionTitleMax) {
        issues.push(
          issue(
            "too_long",
            `Option ${n}: title must be at most ${QUIZ_LIMITS.optionTitleMax} characters.`,
          ),
        );
      }
    }

    // score
    let score = 0;
    if (typeof item.score !== "number" || !Number.isFinite(item.score)) {
      issues.push(issue("invalid", `Option ${n}: score must be a number.`));
    } else if (Math.abs(item.score) > QUIZ_LIMITS.scoreAbsMax) {
      issues.push(
        issue(
          "out_of_range",
          `Option ${n}: score must be between -${QUIZ_LIMITS.scoreAbsMax} and ${QUIZ_LIMITS.scoreAbsMax}.`,
        ),
      );
    } else {
      score = item.score;
    }

    const description = optionalTrimmed(
      item.description,
      QUIZ_LIMITS.optionDescriptionMax,
      "description",
      n,
      issues,
    );
    const icon = optionalTrimmed(
      item.icon,
      QUIZ_LIMITS.optionIconMax,
      "icon",
      n,
      issues,
    );

    // image: { asset_id } | null
    let image: { asset_id: string } | undefined;
    if (item.image !== null && item.image !== undefined) {
      if (isRecord(item.image) && isAssetId(item.image.asset_id)) {
        image = { asset_id: item.image.asset_id };
      } else {
        issues.push(issue("invalid", `Option ${n}: invalid image.`));
      }
    }

    if (issues.length === before) {
      // Canonical key order: id, title, description, score, icon, image.
      options.push({
        id,
        title,
        ...(description !== undefined ? { description } : {}),
        score,
        ...(icon !== undefined ? { icon } : {}),
        ...(image ? { image } : {}),
      });
    }
  });

  return { options, issues };
}

/** Stable serialisation of already-canonical options. */
export function serializeAnswerOptions(
  options: readonly StoredAnswerOption[],
): string {
  return JSON.stringify(options);
}

/** Asset ids referenced by raw (possibly unvalidated) options, for batch checks. */
export function collectOptionAssetIds(items: readonly unknown[]): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (isRecord(item) && isRecord(item.image) && isAssetId(item.image.asset_id)) {
      ids.add(item.image.asset_id);
    }
  }
  return [...ids];
}
