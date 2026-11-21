// path: src/lib/quiz/sample.ts

import type {
  SampleCollectionDefinition,
  SampleFieldDefinition,
  SampleFieldVisibilityRule,
} from "@/lib/sample-collections";
import {
  MEDIA_TYPES,
  MEDIA_TYPE_LABELS,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  QUIZ_COLLECTION_NAME,
  QUIZ_FIELD_KEYS as K,
  QUIZ_SAMPLE_ID,
  TEXT_INPUT_TYPES,
  TEXT_INPUT_TYPE_LABELS,
  TOOLTIP_FORMATS,
  TOOLTIP_FORMAT_LABELS,
} from "./constants";
import { serializeAnswerOptions, type StoredAnswerOption } from "./options";

/**
 * The "Quiz" sample collection: reusable question definitions (single choice,
 * multiple choice, text, numeric, sliding scale) for the quiz components.
 *
 * Structural fields are LOCKED (stable keys) so validators and components can
 * find them; type-specific fields are hidden table columns and shown in the
 * item editor only while they apply (`showWhen`). See
 * docs/quiz-cms-collection-integration-plan.md §4.
 */

const enumData = <T extends string>(
  ids: readonly T[],
  labels: Record<T, string>,
) => ({ options: ids.map((id) => ({ id, name: labels[id] })) });

const when = (
  fieldKey: string,
  ...equals: string[]
): SampleFieldVisibilityRule => ({ fieldKey, equals });

/** Every Quiz field is user-fillable and LOCKED (stable key). `order` is set below. */
const field = (
  def: Omit<SampleFieldDefinition, "order" | "fillable" | "locked">,
): SampleFieldDefinition => ({ fillable: true, locked: true, order: 0, ...def });

const TYPE_IS = (...types: (typeof QUESTION_TYPES)[number][]) =>
  when(K.questionType, ...types);

const FIELD_DEFINITIONS: SampleFieldDefinition[] = [
  field({ name: "Description", key: K.description, type: "text", hidden: false }),
  field({
    name: "Show description",
    key: K.showDescription,
    type: "boolean",
    hidden: true,
    default: "true",
  }),
  field({
    name: "Question type",
    key: K.questionType,
    type: "option",
    hidden: false,
    default: QUESTION_TYPE_LABELS.single_choice,
    data: enumData(QUESTION_TYPES, QUESTION_TYPE_LABELS),
  }),
  field({
    name: "Required",
    key: K.required,
    type: "boolean",
    hidden: false,
    default: "true",
  }),
  field({
    name: "Answer options",
    key: K.options,
    type: "answer_options",
    hidden: true,
    showWhen: [TYPE_IS("single_choice", "multiple_choice")],
  }),

  // Media
  field({
    name: "Media",
    key: K.media,
    type: "option",
    hidden: true,
    data: enumData(MEDIA_TYPES, MEDIA_TYPE_LABELS),
  }),
  field({
    name: "Image",
    key: K.mediaImage,
    type: "image",
    hidden: true,
    showWhen: [when(K.media, "image")],
  }),
  field({
    name: "Image alt text",
    key: K.mediaImageAlt,
    type: "text",
    hidden: true,
    showWhen: [when(K.media, "image")],
  }),
  field({
    name: "Video file",
    key: K.mediaVideoFile,
    type: "video",
    hidden: true,
    showWhen: [when(K.media, "video")],
  }),
  field({
    name: "Video link (YouTube or Loom)",
    key: K.mediaVideoUrl,
    type: "text",
    hidden: true,
    showWhen: [when(K.media, "video")],
  }),

  // Text questions
  field({
    name: "Input type",
    key: K.inputType,
    type: "option",
    hidden: true,
    data: enumData(TEXT_INPUT_TYPES, TEXT_INPUT_TYPE_LABELS),
    showWhen: [TYPE_IS("text")],
  }),
  field({
    name: "Character limit",
    key: K.characterLimit,
    type: "number",
    hidden: true,
    showWhen: [TYPE_IS("text")],
  }),

  // Numeric questions
  field({ name: "Range from", key: K.rangeFrom, type: "number", hidden: true, showWhen: [TYPE_IS("numeric")] }),
  field({ name: "Range to", key: K.rangeTo, type: "number", hidden: true, showWhen: [TYPE_IS("numeric")] }),
  field({ name: "Allow decimals", key: K.allowDecimals, type: "boolean", hidden: true, showWhen: [TYPE_IS("numeric")] }),

  // Sliding-scale questions
  field({ name: "Score range from", key: K.scoreRangeFrom, type: "number", hidden: true, showWhen: [TYPE_IS("sliding_scale")] }),
  field({ name: "Score range to", key: K.scoreRangeTo, type: "number", hidden: true, showWhen: [TYPE_IS("sliding_scale")] }),
  field({ name: "Starting score", key: K.startingScore, type: "number", hidden: true, showWhen: [TYPE_IS("sliding_scale")] }),
  field({ name: "Left label", key: K.leftLabel, type: "text", hidden: true, showWhen: [TYPE_IS("sliding_scale")] }),
  field({ name: "Center label", key: K.centerLabel, type: "text", hidden: true, showWhen: [TYPE_IS("sliding_scale")] }),
  field({ name: "Right label", key: K.rightLabel, type: "text", hidden: true, showWhen: [TYPE_IS("sliding_scale")] }),
  field({
    name: "Show score tooltip",
    key: K.showScoreTooltip,
    type: "boolean",
    hidden: true,
    showWhen: [TYPE_IS("sliding_scale")],
  }),
  field({
    name: "Tooltip format",
    key: K.scoreTooltipFormat,
    type: "option",
    hidden: true,
    data: enumData(TOOLTIP_FORMATS, TOOLTIP_FORMAT_LABELS),
    showWhen: [TYPE_IS("sliding_scale"), when(K.showScoreTooltip, "true")],
  }),
];

// Built-ins occupy the leading positions; the server re-sequences orders anyway,
// this just keeps the definition internally consistent.
const FIRST_CUSTOM_ORDER = 3;
const CUSTOM_FIELDS: SampleFieldDefinition[] = FIELD_DEFINITIONS.map((f, i) => ({
  ...f,
  order: FIRST_CUSTOM_ORDER + i,
}));

// ─── Sample questions (one per type, plus a media example) ───────────────────

const opts = (options: StoredAnswerOption[]) => serializeAnswerOptions(options);

const TYPE = QUESTION_TYPE_LABELS;

const ITEMS: SampleCollectionDefinition["items"] = [
  {
    values: {
      [K.title]: "How would you describe your current experience level?",
      slug: "experience-level",
      [K.description]: "Pick the option that fits you best.",
      [K.showDescription]: "true",
      [K.questionType]: TYPE.single_choice,
      [K.required]: "true",
      [K.options]: opts([
        { id: "opt_beginner", title: "Beginner", description: "I'm just getting started", score: 1, icon: "🌱" },
        { id: "opt_intermediate", title: "Intermediate", description: "I know the basics", score: 2, icon: "🌿" },
        { id: "opt_advanced", title: "Advanced", description: "I'm confident and consistent", score: 3, icon: "🌳" },
        { id: "opt_expert", title: "Expert", description: "I could teach others", score: 4, icon: "🏆" },
      ]),
    },
  },
  {
    values: {
      [K.title]: "Which goals matter most to you right now?",
      slug: "top-goals",
      [K.description]: "Select all that apply.",
      [K.showDescription]: "true",
      [K.questionType]: TYPE.multiple_choice,
      [K.required]: "true",
      [K.options]: opts([
        { id: "opt_audience", title: "Grow my audience", score: 3, icon: "📣" },
        { id: "opt_revenue", title: "Increase revenue", score: 4, icon: "💰" },
        { id: "opt_time", title: "Save time", score: 2, icon: "⏱️" },
        { id: "opt_quality", title: "Improve quality", score: 3, icon: "✨" },
        { id: "opt_skills", title: "Learn new skills", score: 1, icon: "📚" },
      ]),
    },
  },
  {
    values: {
      [K.title]: "What is the biggest challenge you are facing?",
      slug: "biggest-challenge",
      [K.description]: "A few sentences is plenty.",
      [K.showDescription]: "true",
      [K.questionType]: TYPE.text,
      [K.required]: "false",
      [K.inputType]: TEXT_INPUT_TYPE_LABELS.multi_line,
      [K.characterLimit]: "500",
    },
  },
  {
    values: {
      [K.title]: "How many hours per week can you commit?",
      slug: "weekly-hours",
      [K.showDescription]: "false",
      [K.questionType]: TYPE.numeric,
      [K.required]: "true",
      [K.rangeFrom]: "0",
      [K.rangeTo]: "80",
      [K.allowDecimals]: "false",
    },
  },
  {
    values: {
      [K.title]: "How confident are you that you will reach your goals?",
      slug: "goal-confidence",
      [K.showDescription]: "false",
      [K.questionType]: TYPE.sliding_scale,
      [K.required]: "true",
      [K.scoreRangeFrom]: "1",
      [K.scoreRangeTo]: "10",
      [K.startingScore]: "5",
      [K.leftLabel]: "Not at all confident",
      [K.centerLabel]: "Somewhat",
      [K.rightLabel]: "Very confident",
      [K.showScoreTooltip]: "true",
      [K.scoreTooltipFormat]: TOOLTIP_FORMAT_LABELS.actual,
    },
  },
  {
    values: {
      [K.title]: "After watching the intro, which sounds most like you?",
      slug: "intro-video-question",
      [K.description]: "Watch the short video first.",
      [K.showDescription]: "true",
      [K.questionType]: TYPE.single_choice,
      [K.required]: "true",
      [K.media]: MEDIA_TYPE_LABELS.video,
      [K.mediaVideoUrl]: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
      [K.options]: opts([
        { id: "opt_planner", title: "The planner", score: 1 },
        { id: "opt_doer", title: "The doer", score: 2 },
        { id: "opt_explorer", title: "The explorer", score: 3 },
      ]),
    },
  },
];

export const QUIZ_SAMPLE: SampleCollectionDefinition = {
  id: QUIZ_SAMPLE_ID,
  name: QUIZ_COLLECTION_NAME,
  builtInLabels: { name: "Question" },
  customFields: CUSTOM_FIELDS,
  items: ITEMS,
};
