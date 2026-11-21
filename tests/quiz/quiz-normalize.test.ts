import { describe, expect, it } from "vitest";
import {
  QUIZ_FIELD_KEYS,
  normalizeQuizQuestion,
  normalizeQuizQuestions,
  type QuizFieldRole,
  type QuizItemInput,
} from "@/lib/quiz";
import { sampleSchema } from "./helpers";
import { QUIZ_SAMPLE } from "@/lib/quiz/sample";

const schema = sampleSchema();
const f = schema.fieldIdByRole;
const ASSET_A = "33333333-3333-4333-8333-333333333333";
const ASSET_B = "44444444-4444-4444-8444-444444444444";

/** Build an item addressed by ROLE for readability. */
function byRole(values: Partial<Record<keyof typeof f, string>>, id = "q1", order = 3): QuizItemInput {
  const v: Record<string, string> = {};
  for (const [role, value] of Object.entries(values)) v[f[role as keyof typeof f]!] = value as string;
  return { id, collection_id: "col-1", manual_order: order, values: v };
}

const OPTIONS = JSON.stringify([
  { id: "opt_aaa", title: "A", description: "first", score: 1, icon: "🙂", image: { asset_id: ASSET_A } },
  { id: "opt_bbb", title: "B", score: -2.5 },
]);

describe("normalizeQuizQuestion", () => {
  it("single choice: typed, derived allowMultiple=false, options with resolved assets", () => {
    const r = normalizeQuizQuestion(
      byRole({ title: "Pick", questionType: "Single choice", options: OPTIONS }),
      schema,
      (id) => (id === ASSET_A ? { public_url: "https://cdn/a.png" } : null),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.question).toMatchObject({
      id: "q1", collectionId: "col-1", order: 3, title: "Pick", type: "single_choice", allowMultiple: false,
      description: null, showDescription: true, required: true, media: null,
    });
    if (r.question.type !== "single_choice") throw new Error("type");
    expect(r.question.options).toEqual([
      { id: "opt_aaa", title: "A", description: "first", score: 1, icon: "🙂", image: { assetId: ASSET_A, url: "https://cdn/a.png" } },
      { id: "opt_bbb", title: "B", description: null, score: -2.5, icon: null, image: null },
    ]);
  });

  it("multiple choice: allowMultiple=true derived from the type", () => {
    const r = normalizeQuizQuestion(byRole({ title: "Pick", questionType: "Multiple choice", options: OPTIONS }), schema);
    expect(r.ok && r.question.type === "multiple_choice" && r.question.allowMultiple).toBe(true);
  });

  it("an unresolved asset url is null, not an error", () => {
    const r = normalizeQuizQuestion(byRole({ title: "Pick", questionType: "Single choice", options: OPTIONS }), schema);
    expect(r.ok && r.question.type === "single_choice" && r.question.options[0].image).toEqual({ assetId: ASSET_A, url: null });
  });

  it("text / numeric / sliding scale carry their resolved configuration", () => {
    const t = normalizeQuizQuestion(byRole({ title: "T", questionType: "Text", inputType: "Multi line", characterLimit: "250" }), schema);
    expect(t.ok && t.question).toMatchObject({ type: "text", inputType: "multi_line", characterLimit: 250 });
    const n = normalizeQuizQuestion(byRole({ title: "N", questionType: "Numeric", rangeFrom: "1", rangeTo: "9", allowDecimals: "false" }), schema);
    expect(n.ok && n.question).toMatchObject({ type: "numeric", min: 1, max: 9, allowDecimals: false });
    const s = normalizeQuizQuestion(
      byRole({ title: "S", questionType: "Sliding scale", scoreRangeFrom: "0", scoreRangeTo: "100", leftLabel: "Low", showScoreTooltip: "true", scoreTooltipFormat: "Percent" }),
      schema,
    );
    expect(s.ok && s.question).toMatchObject({
      type: "sliding_scale", min: 0, max: 100, start: 50,
      labels: { left: "Low", center: null, right: null }, tooltip: { show: true, format: "percent" },
    });
  });

  it("applies defaults for every omitted optional value", () => {
    const r = normalizeQuizQuestion(byRole({ title: "T", questionType: "Text" }), schema);
    expect(r.ok && r.question).toMatchObject({ required: true, showDescription: true, inputType: "single_line", characterLimit: 1000, media: null });
  });

  it("media: image with url + alt; upload video; embed video with a built embed url", () => {
    const img = normalizeQuizQuestion(byRole({ title: "T", questionType: "Text", media: "Image", mediaImage: ASSET_A, mediaImageAlt: "alt" }), schema, () => ({ public_url: "https://cdn/i.png" }));
    expect(img.ok && img.question.media).toEqual({ type: "image", assetId: ASSET_A, url: "https://cdn/i.png", alt: "alt" });
    const up = normalizeQuizQuestion(byRole({ title: "T", questionType: "Text", media: "Video", mediaVideoFile: ASSET_B }), schema, () => ({ public_url: "https://cdn/v.mp4" }));
    expect(up.ok && up.question.media).toEqual({ type: "video", source: "upload", assetId: ASSET_B, url: "https://cdn/v.mp4" });
    const emb = normalizeQuizQuestion(byRole({ title: "T", questionType: "Text", media: "Video", mediaVideoUrl: "https://youtu.be/aqz-KE-bpKQ" }), schema);
    expect(emb.ok && emb.question.media).toMatchObject({ type: "video", source: "embed", provider: "youtube", videoId: "aqz-KE-bpKQ" });
    if (emb.ok && emb.question.media?.type === "video" && emb.question.media.source === "embed") {
      expect(emb.question.media.embedUrl).toMatch(/^https:\/\/www\.youtube(-nocookie)?\.com\/embed\/aqz-KE-bpKQ/);
    }
  });

  it("never throws: invalid records return issues", () => {
    for (const values of [{}, { title: "x" }, { title: "x", questionType: "Single choice" }, { title: "x", questionType: "Single choice", options: "}{" }]) {
      const r = normalizeQuizQuestion(byRole(values as never), schema);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues.length).toBeGreaterThan(0);
    }
  });

  it("is pure: the same input gives deeply equal output and the input is not mutated", () => {
    const input = byRole({ title: "Pick", questionType: "Single choice", options: OPTIONS });
    const before = JSON.stringify(input);
    expect(normalizeQuizQuestion(input, schema)).toEqual(normalizeQuizQuestion(input, schema));
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("normalizeQuizQuestions", () => {
  it("splits valid and invalid, preserving input order and reporting why", () => {
    const good1 = byRole({ title: "A", questionType: "Text" }, "a", 1);
    const bad = byRole({ title: "B" }, "b", 2);
    const good2 = byRole({ title: "C", questionType: "Numeric" }, "c", 3);
    const { questions, invalid } = normalizeQuizQuestions([good1, bad, good2], schema);
    expect(questions.map((q) => q.id)).toEqual(["a", "c"]);
    expect(invalid).toHaveLength(1);
    expect(invalid[0].itemId).toBe("b");
    expect(invalid[0].issues.some((i) => i.role === "questionType")).toBe(true);
  });

  it("handles an empty list", () => {
    expect(normalizeQuizQuestions([], schema)).toEqual({ questions: [], invalid: [] });
  });
});

describe("the shipped sample questions normalise cleanly", () => {
  it("every sample item produces a valid typed question of the expected type", () => {
    const roleByKey = new Map<string, QuizFieldRole>(
      (Object.entries(QUIZ_FIELD_KEYS) as [QuizFieldRole, string][]).map(([role, key]) => [key, role]),
    );
    const types: string[] = [];
    QUIZ_SAMPLE.items.forEach((sampleItem, i) => {
      const values: Record<string, string> = {};
      for (const [key, value] of Object.entries(sampleItem.values)) {
        const role = roleByKey.get(key);
        if (role) values[f[role]!] = value;
      }
      const r = normalizeQuizQuestion({ id: `s${i}`, collection_id: "c", manual_order: i + 1, values }, schema);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (r.ok) types.push(r.question.type);
    });
    expect(types).toEqual(["single_choice", "multiple_choice", "text", "numeric", "sliding_scale", "single_choice"]);
  });
});
