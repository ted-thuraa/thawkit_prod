// path: src/lib/quiz/constants.ts

/**
 * Single source of truth for the Quiz question model: field keys, enum ids,
 * labels, defaults and limits. Imported by the sample definition, the shared
 * validator/normaliser, the CMS item editor, the server write boundary and
 * (later) the quiz components, so none of them can drift.
 *
 * Pure module — no React, no server-only imports.
 */

export const QUIZ_SAMPLE_ID = "quiz";
export const QUIZ_COLLECTION_NAME = "Quiz";

// ─── Enums ───────────────────────────────────────────────────────────────────
// An `option` CMS field stores the option *label* as its value; the option `id`
// (these constants) is the stable machine value. The sample defines each option
// with `id === enum value`, and the normaliser maps stored label → id.

export const QUESTION_TYPES = [
  "single_choice",
  "multiple_choice",
  "text",
  "numeric",
  "sliding_scale",
] as const;
export type QuizQuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuizQuestionType, string> = {
  single_choice: "Single choice",
  multiple_choice: "Multiple choice",
  text: "Text",
  numeric: "Numeric",
  sliding_scale: "Sliding scale",
};

export const MEDIA_TYPES = ["none", "image", "video"] as const;
export type QuizMediaType = (typeof MEDIA_TYPES)[number];
export const MEDIA_TYPE_LABELS: Record<QuizMediaType, string> = {
  none: "None",
  image: "Image",
  video: "Video",
};

export const TEXT_INPUT_TYPES = ["single_line", "multi_line"] as const;
export type QuizTextInputType = (typeof TEXT_INPUT_TYPES)[number];
export const TEXT_INPUT_TYPE_LABELS: Record<QuizTextInputType, string> = {
  single_line: "Single line",
  multi_line: "Multi line",
};

export const TOOLTIP_FORMATS = ["actual", "percent"] as const;
export type QuizTooltipFormat = (typeof TOOLTIP_FORMATS)[number];
export const TOOLTIP_FORMAT_LABELS: Record<QuizTooltipFormat, string> = {
  actual: "Actual value",
  percent: "Percent",
};

/** Question types whose answer is a pick from `options`. */
export const CHOICE_QUESTION_TYPES: readonly QuizQuestionType[] = [
  "single_choice",
  "multiple_choice",
];

export function isChoiceType(type: QuizQuestionType): boolean {
  return CHOICE_QUESTION_TYPES.includes(type);
}

// ─── Field keys (locked, stable machine identity) ───────────────────────────

/** Role → CMS field `key`. `title` is the built-in `name` field. */
export const QUIZ_FIELD_KEYS = {
  title: "name",
  description: "description",
  showDescription: "show_description",
  questionType: "question_type",
  required: "required",
  options: "options",
  media: "media",
  mediaImage: "media_image",
  mediaImageAlt: "media_image_alt",
  mediaVideoFile: "media_video_file",
  mediaVideoUrl: "media_video_url",
  inputType: "input_type",
  characterLimit: "character_limit",
  rangeFrom: "range_from",
  rangeTo: "range_to",
  allowDecimals: "allow_decimals",
  scoreRangeFrom: "score_range_from",
  scoreRangeTo: "score_range_to",
  startingScore: "starting_score",
  leftLabel: "left_label",
  centerLabel: "center_label",
  rightLabel: "right_label",
  showScoreTooltip: "show_score_tooltip",
  scoreTooltipFormat: "score_tooltip_format",
} as const;

export type QuizFieldRole = keyof typeof QUIZ_FIELD_KEYS;

export const QUIZ_FIELD_ROLES = Object.keys(QUIZ_FIELD_KEYS) as QuizFieldRole[];

/** A collection is quiz-shaped when it has BOTH of these structural fields. */
export const QUIZ_STRUCTURAL_ROLES: readonly QuizFieldRole[] = [
  "questionType",
  "options",
];

// ─── Defaults (resolved at normalisation, not persisted) ─────────────────────

export const QUIZ_DEFAULTS = {
  showDescription: true,
  required: true,
  media: "none" as QuizMediaType,
  inputType: "single_line" as QuizTextInputType,
  characterLimit: 1000,
  allowDecimals: false,
  showScoreTooltip: false,
  scoreTooltipFormat: "actual" as QuizTooltipFormat,
} as const;

// ─── Limits ──────────────────────────────────────────────────────────────────

export const QUIZ_LIMITS = {
  titleMax: 500,
  descriptionMax: 2000,
  altMax: 300,
  videoUrlMax: 500,
  optionTitleMax: 200,
  optionDescriptionMax: 500,
  optionIconMax: 16,
  optionsMin: 2,
  optionsMax: 50,
  /** |score| bound: permissive on purpose (scoring rules are not final). */
  scoreAbsMax: 1_000_000,
  characterLimitMax: 10_000,
  numericAbsMax: 1e12,
  scaleAbsMax: 1_000_000,
  scaleSpanMax: 1000,
  labelMax: 60,
} as const;

// ─── Answer option ids ───────────────────────────────────────────────────────

export const OPTION_ID_PREFIX = "opt_";
/** `opt_` + 3–32 URL-safe characters. */
export const OPTION_ID_PATTERN = /^opt_[A-Za-z0-9_-]{3,32}$/;
