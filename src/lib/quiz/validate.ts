// path: src/lib/quiz/validate.ts

import { parseVideoInput, type VideoReference } from "@/lib/video-embed";
import {
  MEDIA_TYPES,
  QUESTION_TYPES,
  QUIZ_DEFAULTS,
  QUIZ_FIELD_KEYS,
  QUIZ_FIELD_ROLES,
  QUIZ_LIMITS,
  QUIZ_STRUCTURAL_ROLES,
  TEXT_INPUT_TYPES,
  TOOLTIP_FORMATS,
  isChoiceType,
  type QuizFieldRole,
  type QuizMediaType,
  type QuizQuestionType,
  type QuizTextInputType,
  type QuizTooltipFormat,
} from "./constants";
import {
  canonicalizeAnswerOptions,
  isAssetId,
  parseAnswerOptionsJson,
  type StoredAnswerOption,
} from "./options";
import type { QuizIssue, QuizRawValues } from "./types";

/**
 * Shared interpretation + validation of a quiz question record. ONE code path
 * answers both "is this record valid?" (CMS editor, server write boundary) and
 * "what does it mean?" (normaliser → components), so the two can never
 * disagree. Pure and isomorphic.
 *
 * Only fields APPLICABLE to the question's type are validated; values left over
 * from a previous type are ignored (and preserved in storage).
 */

// ─── Schema resolution (field key → field id) ────────────────────────────────

export interface QuizSchemaField {
  id: string;
  key: string | null;
  type: string;
  data?: { options?: ReadonlyArray<{ id: string; name: string }> } | null;
}

type EnumRole = "questionType" | "media" | "inputType" | "scoreTooltipFormat";

export interface QuizSchema {
  fieldIdByRole: Readonly<Partial<Record<QuizFieldRole, string>>>;
  roleByFieldId: ReadonlyMap<string, QuizFieldRole>;
  /** option label (lower-cased, trimmed) → option id, per `option`-typed role. */
  optionIdByLabel: Readonly<Partial<Record<EnumRole, ReadonlyMap<string, string>>>>;
}

const ENUM_ROLES: readonly EnumRole[] = [
  "questionType",
  "media",
  "inputType",
  "scoreTooltipFormat",
];

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Finds the quiz structural fields of a collection by their locked keys.
 * Returns null unless BOTH `question_type` (an `option` field) and `options`
 * (an `answer_options` field) exist — i.e. only quiz-shaped collections are
 * ever treated as quizzes. Optional roles that are missing simply fall back
 * to their defaults.
 */
export function resolveQuizSchema(
  fields: ReadonlyArray<QuizSchemaField>,
): QuizSchema | null {
  const byKey = new Map<string, QuizSchemaField>();
  for (const f of fields) if (f.key) byKey.set(f.key, f);

  const fieldIdByRole: Partial<Record<QuizFieldRole, string>> = {};
  const roleByFieldId = new Map<string, QuizFieldRole>();
  for (const role of QUIZ_FIELD_ROLES) {
    const field = byKey.get(QUIZ_FIELD_KEYS[role]);
    if (field) {
      fieldIdByRole[role] = field.id;
      roleByFieldId.set(field.id, role);
    }
  }

  const typeField = byKey.get(QUIZ_FIELD_KEYS.questionType);
  const optionsField = byKey.get(QUIZ_FIELD_KEYS.options);
  if (
    !typeField ||
    typeField.type !== "option" ||
    !optionsField ||
    optionsField.type !== "answer_options"
  ) {
    return null;
  }
  for (const role of QUIZ_STRUCTURAL_ROLES) {
    if (!fieldIdByRole[role]) return null;
  }

  const optionIdByLabel: Partial<Record<EnumRole, Map<string, string>>> = {};
  for (const role of ENUM_ROLES) {
    const id = fieldIdByRole[role];
    const field = id ? fields.find((f) => f.id === id) : undefined;
    if (field?.type === "option") {
      optionIdByLabel[role] = new Map(
        (field.data?.options ?? []).map((o) => [norm(o.name), o.id]),
      );
    }
  }

  return { fieldIdByRole, roleByFieldId, optionIdByLabel };
}

/** Maps stored values (by field id) to values by role. */
export function toQuizRaw(
  schema: QuizSchema,
  valuesByFieldId: Readonly<Record<string, string | undefined>>,
): QuizRawValues {
  const raw: QuizRawValues = {};
  for (const [role, fieldId] of Object.entries(schema.fieldIdByRole)) {
    const value = valuesByFieldId[fieldId as string];
    if (value !== undefined) raw[role as QuizFieldRole] = value;
  }
  return raw;
}

// ─── Interpreted record ──────────────────────────────────────────────────────

export type InterpretedMedia =
  | { type: "none" }
  | { type: "image"; assetId: string; alt: string | null }
  | { type: "video"; source: "upload"; assetId: string }
  | { type: "video"; source: "embed"; ref: VideoReference };

export type InterpretedConfig =
  | { type: "single_choice" | "multiple_choice"; options: StoredAnswerOption[] }
  | { type: "text"; inputType: QuizTextInputType; characterLimit: number }
  | {
      type: "numeric";
      min: number | null;
      max: number | null;
      allowDecimals: boolean;
    }
  | {
      type: "sliding_scale";
      min: number;
      max: number;
      start: number;
      labels: { left: string | null; center: string | null; right: string | null };
      tooltip: { show: boolean; format: QuizTooltipFormat };
    };

export interface InterpretedQuiz {
  title: string;
  description: string | null;
  showDescription: boolean;
  required: boolean;
  media: InterpretedMedia;
  config: InterpretedConfig;
}

export interface InterpretResult {
  value: InterpretedQuiz | null;
  issues: QuizIssue[];
}

// ─── Primitive parsers ───────────────────────────────────────────────────────

const blank = (v: string | undefined): v is undefined =>
  v === undefined || v.trim() === "";

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (blank(v)) return fallback;
  const s = v.trim().toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  return fallback;
}

type NumberParse =
  | { kind: "absent" }
  | { kind: "ok"; value: number }
  | { kind: "invalid" };

function parseNumber(v: string | undefined): NumberParse {
  if (blank(v)) return { kind: "absent" };
  const n = Number(v.trim());
  return Number.isFinite(n) ? { kind: "ok", value: n } : { kind: "invalid" };
}

function resolveEnum<T extends string>(
  schema: QuizSchema,
  role: EnumRole,
  raw: string | undefined,
  allowed: readonly T[],
): T | "unknown" | "absent" {
  if (blank(raw)) return "absent";
  const byLabel = schema.optionIdByLabel[role]?.get(norm(raw));
  const candidate = byLabel ?? raw.trim();
  return (allowed as readonly string[]).includes(candidate)
    ? (candidate as T)
    : "unknown";
}

const trimmedOrNull = (v: string | undefined): string | null =>
  blank(v) ? null : v.trim();

// ─── Interpretation ──────────────────────────────────────────────────────────

export function interpretQuizRaw(
  raw: QuizRawValues,
  schema: QuizSchema,
): InterpretResult {
  const issues: QuizIssue[] = [];
  const add = (
    role: QuizFieldRole,
    code: QuizIssue["code"],
    message: string,
  ) => issues.push({ role, code, message });

  // — common —
  const title = raw.title?.trim() ?? "";
  if (!title) add("title", "required", "Question is required.");
  else if (title.length > QUIZ_LIMITS.titleMax) {
    add("title", "too_long", `Question must be at most ${QUIZ_LIMITS.titleMax} characters.`);
  }

  const description = trimmedOrNull(raw.description);
  if (description && description.length > QUIZ_LIMITS.descriptionMax) {
    add(
      "description",
      "too_long",
      `Description must be at most ${QUIZ_LIMITS.descriptionMax} characters.`,
    );
  }

  const showDescription = parseBool(raw.showDescription, QUIZ_DEFAULTS.showDescription);
  const required = parseBool(raw.required, QUIZ_DEFAULTS.required);

  const typeResolved = resolveEnum<QuizQuestionType>(
    schema,
    "questionType",
    raw.questionType,
    QUESTION_TYPES,
  );
  let type: QuizQuestionType | null = null;
  if (typeResolved === "absent") {
    add("questionType", "required", "Question type is required.");
  } else if (typeResolved === "unknown") {
    add("questionType", "invalid", "Unknown question type.");
  } else {
    type = typeResolved;
  }

  // — media (applies to every type) —
  const media = interpretMedia(raw, schema, add);

  // — type-specific —
  let config: InterpretedConfig | null = null;
  if (type) config = interpretConfig(type, raw, schema, add);

  if (issues.length > 0 || !type || !config) return { value: null, issues };
  return {
    value: { title, description, showDescription, required, media, config },
    issues,
  };
}

type AddIssue = (
  role: QuizFieldRole,
  code: QuizIssue["code"],
  message: string,
) => void;

function interpretMedia(
  raw: QuizRawValues,
  schema: QuizSchema,
  add: AddIssue,
): InterpretedMedia {
  const resolved = resolveEnum<QuizMediaType>(schema, "media", raw.media, MEDIA_TYPES);
  if (resolved === "unknown") {
    add("media", "invalid", "Unknown media type.");
    return { type: "none" };
  }
  const mediaType: QuizMediaType =
    resolved === "absent" ? QUIZ_DEFAULTS.media : resolved;

  if (mediaType === "image") {
    const assetId = raw.mediaImage?.trim();
    if (!assetId) {
      add("mediaImage", "required", "Choose an image.");
    } else if (!isAssetId(assetId)) {
      add("mediaImage", "invalid", "The selected image is not valid.");
    }
    const alt = trimmedOrNull(raw.mediaImageAlt);
    if (alt && alt.length > QUIZ_LIMITS.altMax) {
      add("mediaImageAlt", "too_long", `Alt text must be at most ${QUIZ_LIMITS.altMax} characters.`);
    }
    return { type: "image", assetId: assetId ?? "", alt };
  }

  if (mediaType === "video") {
    const file = raw.mediaVideoFile?.trim();
    const link = raw.mediaVideoUrl?.trim();
    if (file && link) {
      add("mediaVideoUrl", "conflict", "Use either an uploaded video or a video link, not both.");
    } else if (!file && !link) {
      add("mediaVideoFile", "required", "Choose a video file or paste a video link.");
    } else if (file) {
      if (!isAssetId(file)) add("mediaVideoFile", "invalid", "The selected video is not valid.");
      return { type: "video", source: "upload", assetId: file };
    } else if (link) {
      if (link.length > QUIZ_LIMITS.videoUrlMax) {
        add("mediaVideoUrl", "too_long", `Video link must be at most ${QUIZ_LIMITS.videoUrlMax} characters.`);
      } else {
        const ref = parseVideoInput(link);
        if (!ref) {
          add("mediaVideoUrl", "unsupported", "Use a YouTube or Loom link.");
        } else {
          return { type: "video", source: "embed", ref };
        }
      }
    }
    return { type: "none" };
  }

  return { type: "none" };
}

function interpretConfig(
  type: QuizQuestionType,
  raw: QuizRawValues,
  schema: QuizSchema,
  add: AddIssue,
): InterpretedConfig | null {
  if (isChoiceType(type)) {
    const parsed = parseAnswerOptionsJson(raw.options);
    if (parsed.kind === "invalid") {
      add("options", "invalid", "Answer options are not valid.");
      return null;
    }
    const items = parsed.kind === "ok" ? parsed.items : [];
    // Reading is side-effect free: a stored option without an id is an issue
    // (writers assign ids before persisting).
    const { options, issues } = canonicalizeAnswerOptions(items, null);
    for (const i of issues) add("options", i.code, i.message);
    if (issues.length === 0 && items.length < QUIZ_LIMITS.optionsMin) {
      add(
        "options",
        "too_few",
        `Add at least ${QUIZ_LIMITS.optionsMin} answer options.`,
      );
    }
    return issues.length === 0 && options.length >= QUIZ_LIMITS.optionsMin
      ? { type: type as "single_choice" | "multiple_choice", options }
      : null;
  }

  if (type === "text") {
    const inputResolved = resolveEnum<QuizTextInputType>(schema, "inputType", raw.inputType, TEXT_INPUT_TYPES);
    let inputType: QuizTextInputType = QUIZ_DEFAULTS.inputType;
    if (inputResolved === "unknown") add("inputType", "invalid", "Unknown input type.");
    else if (inputResolved !== "absent") inputType = inputResolved;

    let characterLimit: number = QUIZ_DEFAULTS.characterLimit;
    const n = parseNumber(raw.characterLimit);
    if (n.kind === "invalid") {
      add("characterLimit", "invalid", "Character limit must be a number.");
    } else if (n.kind === "ok") {
      if (
        !Number.isInteger(n.value) ||
        n.value < 1 ||
        n.value > QUIZ_LIMITS.characterLimitMax
      ) {
        add(
          "characterLimit",
          "out_of_range",
          `Character limit must be a whole number between 1 and ${QUIZ_LIMITS.characterLimitMax}.`,
        );
      } else {
        characterLimit = n.value;
      }
    }
    return { type: "text", inputType, characterLimit };
  }

  if (type === "numeric") {
    const allowDecimals = parseBool(raw.allowDecimals, QUIZ_DEFAULTS.allowDecimals);
    const from = parseNumber(raw.rangeFrom);
    const to = parseNumber(raw.rangeTo);
    let min: number | null = null;
    let max: number | null = null;

    const check = (
      role: "rangeFrom" | "rangeTo",
      label: string,
      p: NumberParse,
    ): number | null => {
      if (p.kind === "absent") return null;
      if (p.kind === "invalid") {
        add(role, "invalid", `${label} must be a number.`);
        return null;
      }
      if (Math.abs(p.value) > QUIZ_LIMITS.numericAbsMax) {
        add(role, "out_of_range", `${label} is out of range.`);
        return null;
      }
      if (!allowDecimals && !Number.isInteger(p.value)) {
        add(role, "invalid", `${label} must be a whole number when decimals are not allowed.`);
        return null;
      }
      return p.value;
    };
    min = check("rangeFrom", "Range from", from);
    max = check("rangeTo", "Range to", to);
    if (min !== null && max !== null && min > max) {
      add("rangeTo", "out_of_range", "Range to must be greater than or equal to range from.");
    }
    return { type: "numeric", min, max, allowDecimals };
  }

  // sliding_scale
  const from = parseNumber(raw.scoreRangeFrom);
  const to = parseNumber(raw.scoreRangeTo);
  const start = parseNumber(raw.startingScore);

  const bound = (
    role: "scoreRangeFrom" | "scoreRangeTo",
    label: string,
    p: NumberParse,
  ): number | null => {
    if (p.kind === "absent") {
      add(role, "required", `${label} is required.`);
      return null;
    }
    if (p.kind === "invalid" || !Number.isInteger(p.value)) {
      add(role, "invalid", `${label} must be a whole number.`);
      return null;
    }
    if (Math.abs(p.value) > QUIZ_LIMITS.scaleAbsMax) {
      add(role, "out_of_range", `${label} is out of range.`);
      return null;
    }
    return p.value;
  };
  const min = bound("scoreRangeFrom", "Score range from", from);
  const max = bound("scoreRangeTo", "Score range to", to);
  let rangeOk = false;
  if (min !== null && max !== null) {
    if (min >= max) {
      add("scoreRangeTo", "out_of_range", "Score range to must be greater than score range from.");
    } else if (max - min > QUIZ_LIMITS.scaleSpanMax) {
      add("scoreRangeTo", "out_of_range", `The scale can span at most ${QUIZ_LIMITS.scaleSpanMax} steps.`);
    } else {
      rangeOk = true;
    }
  }

  let startValue = 0;
  if (rangeOk && min !== null && max !== null) {
    startValue = Math.floor((min + max) / 2);
    if (start.kind === "invalid" || (start.kind === "ok" && !Number.isInteger(start.value))) {
      add("startingScore", "invalid", "Starting score must be a whole number.");
    } else if (start.kind === "ok") {
      if (start.value < min || start.value > max) {
        add("startingScore", "out_of_range", "Starting score must be within the score range.");
      } else {
        startValue = start.value;
      }
    }
  }

  const label = (v: string | undefined, role: QuizFieldRole, name: string) => {
    const t = trimmedOrNull(v);
    if (t && t.length > QUIZ_LIMITS.labelMax) {
      add(role, "too_long", `${name} must be at most ${QUIZ_LIMITS.labelMax} characters.`);
      return null;
    }
    return t;
  };
  const left = label(raw.leftLabel, "leftLabel", "Left label");
  const center = label(raw.centerLabel, "centerLabel", "Center label");
  const right = label(raw.rightLabel, "rightLabel", "Right label");

  const showTooltip = parseBool(raw.showScoreTooltip, QUIZ_DEFAULTS.showScoreTooltip);
  let format: QuizTooltipFormat = QUIZ_DEFAULTS.scoreTooltipFormat;
  if (showTooltip) {
    const f = resolveEnum<QuizTooltipFormat>(schema, "scoreTooltipFormat", raw.scoreTooltipFormat, TOOLTIP_FORMATS);
    if (f === "unknown") add("scoreTooltipFormat", "invalid", "Unknown tooltip format.");
    else if (f !== "absent") format = f;
  }

  if (!rangeOk || min === null || max === null) return null;
  return {
    type: "sliding_scale",
    min,
    max,
    start: startValue,
    labels: { left, center, right },
    tooltip: { show: showTooltip, format },
  };
}

/** Issues only — for the editor and the server write boundary. */
export function validateQuizRaw(
  raw: QuizRawValues,
  schema: QuizSchema,
): QuizIssue[] {
  return interpretQuizRaw(raw, schema).issues;
}
