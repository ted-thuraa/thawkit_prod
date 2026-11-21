// path: src/lib/quiz/normalize.ts

import { buildVideoEmbedUrl } from "@/lib/video-embed";
import {
  interpretQuizRaw,
  toQuizRaw,
  type InterpretedMedia,
  type QuizSchema,
} from "./validate";
import type {
  QuizIssue,
  QuizMedia,
  QuizNormalizeResult,
  QuizOption,
  QuizQuestion,
} from "./types";
import type { StoredAnswerOption } from "./options";

/**
 * Turns a CMS item into the typed `QuizQuestion` contract consumed by the
 * quiz components. Pure and isomorphic; never throws — problems are returned
 * as issues so callers can render a placeholder (editor) or skip the question
 * (runtime) instead of crashing.
 */

/** The slice of a CMS item the normaliser needs. */
export interface QuizItemInput {
  id: string;
  collection_id: string;
  manual_order: number;
  /** field id → stored text */
  values: Readonly<Record<string, string | undefined>>;
}

/** Resolved assets by id (from `includeAssets`): only the public URL is needed. */
export type QuizAssetLookup = (
  assetId: string,
) => { public_url: string | null } | null | undefined;

function toMedia(media: InterpretedMedia, assets?: QuizAssetLookup): QuizMedia | null {
  const url = (id: string) => assets?.(id)?.public_url ?? null;
  switch (media.type) {
    case "none":
      return null;
    case "image":
      return { type: "image", assetId: media.assetId, url: url(media.assetId), alt: media.alt };
    case "video":
      if (media.source === "upload") {
        return { type: "video", source: "upload", assetId: media.assetId, url: url(media.assetId) };
      }
      return {
        type: "video",
        source: "embed",
        provider: media.ref.provider,
        videoId: media.ref.video_id,
        // `parseVideoInput` already validated provider/id, so this is non-null;
        // fall back to "" defensively rather than throwing.
        embedUrl: buildVideoEmbedUrl(media.ref) ?? "",
      };
  }
}

function toOption(option: StoredAnswerOption, assets?: QuizAssetLookup): QuizOption {
  return {
    id: option.id,
    title: option.title,
    description: option.description ?? null,
    score: option.score,
    icon: option.icon ?? null,
    image: option.image
      ? {
          assetId: option.image.asset_id,
          url: assets?.(option.image.asset_id)?.public_url ?? null,
        }
      : null,
  };
}

export function normalizeQuizQuestion(
  item: QuizItemInput,
  schema: QuizSchema,
  assets?: QuizAssetLookup,
): QuizNormalizeResult {
  const { value, issues } = interpretQuizRaw(toQuizRaw(schema, item.values), schema);
  if (!value) return { ok: false, issues };

  const base = {
    id: item.id,
    collectionId: item.collection_id,
    order: item.manual_order,
    title: value.title,
    description: value.description,
    showDescription: value.showDescription,
    required: value.required,
    media: toMedia(value.media, assets),
  };
  const c = value.config;

  let question: QuizQuestion;
  switch (c.type) {
    case "single_choice":
      question = { ...base, type: "single_choice", allowMultiple: false, options: c.options.map((o) => toOption(o, assets)) };
      break;
    case "multiple_choice":
      question = { ...base, type: "multiple_choice", allowMultiple: true, options: c.options.map((o) => toOption(o, assets)) };
      break;
    case "text":
      question = { ...base, type: "text", inputType: c.inputType, characterLimit: c.characterLimit };
      break;
    case "numeric":
      question = { ...base, type: "numeric", min: c.min, max: c.max, allowDecimals: c.allowDecimals };
      break;
    case "sliding_scale":
      question = { ...base, type: "sliding_scale", min: c.min, max: c.max, start: c.start, labels: c.labels, tooltip: c.tooltip };
      break;
  }
  return { ok: true, question };
}

export interface NormalizedQuestions {
  /** Valid questions, in input order. */
  questions: QuizQuestion[];
  /** Questions that failed normalisation, with why. */
  invalid: Array<{ itemId: string; issues: QuizIssue[] }>;
}

/** Normalises a list; invalid records are reported, never thrown or silently dropped. */
export function normalizeQuizQuestions(
  items: readonly QuizItemInput[],
  schema: QuizSchema,
  assets?: QuizAssetLookup,
): NormalizedQuestions {
  const questions: QuizQuestion[] = [];
  const invalid: NormalizedQuestions["invalid"] = [];
  for (const item of items) {
    const result = normalizeQuizQuestion(item, schema, assets);
    if (result.ok) questions.push(result.question);
    else invalid.push({ itemId: item.id, issues: result.issues });
  }
  return { questions, invalid };
}
