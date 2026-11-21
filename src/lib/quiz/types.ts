// path: src/lib/quiz/types.ts

import type { VideoProvider } from "@/lib/video-embed";
import type { QuizFieldRole } from "./constants";

/**
 * The normalised question contract the quiz components (and any other
 * consumer) receive. Produced by `normalizeQuizQuestion`; never hand-built.
 */

export interface QuizMediaImage {
  type: "image";
  assetId: string;
  url: string | null;
  alt: string | null;
}

export type QuizMediaVideo =
  | { type: "video"; source: "upload"; assetId: string; url: string | null }
  | {
      type: "video";
      source: "embed";
      provider: VideoProvider;
      videoId: string;
      embedUrl: string;
    };

export type QuizMedia = QuizMediaImage | QuizMediaVideo;

export interface QuizOption {
  /** Stable, immutable, unique within its question. */
  id: string;
  title: string;
  description: string | null;
  /** Finite number; aggregation rules belong to the (future) scoring layer. */
  score: number;
  icon: string | null;
  image: { assetId: string; url: string | null } | null;
}

interface QuizQuestionBase {
  /** Collection item UUID — the question's identity. */
  id: string;
  collectionId: string;
  /** `manual_order` of the item. */
  order: number;
  title: string;
  description: string | null;
  showDescription: boolean;
  required: boolean;
  media: QuizMedia | null;
}

export type QuizQuestion = QuizQuestionBase &
  (
    | { type: "single_choice"; options: QuizOption[]; allowMultiple: false }
    | { type: "multiple_choice"; options: QuizOption[]; allowMultiple: true }
    | {
        type: "text";
        inputType: "single_line" | "multi_line";
        characterLimit: number;
      }
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
        labels: {
          left: string | null;
          center: string | null;
          right: string | null;
        };
        tooltip: { show: boolean; format: "actual" | "percent" };
      }
  );

/** A validation / normalisation problem, attributable to a field role. */
export interface QuizIssue {
  role: QuizFieldRole;
  code:
    | "required"
    | "invalid"
    | "out_of_range"
    | "too_long"
    | "too_few"
    | "too_many"
    | "duplicate"
    | "conflict"
    | "unsupported";
  message: string;
}

export type QuizNormalizeResult =
  | { ok: true; question: QuizQuestion }
  | { ok: false; issues: QuizIssue[] };

/** Stored text per role (what the CMS persists), before interpretation. */
export type QuizRawValues = Partial<Record<QuizFieldRole, string>>;

// Runtime answer shapes are deliberately NOT defined here: respondent answers
// are a separate runtime domain (see docs/quiz-cms-collection-integration-plan.md §6).
