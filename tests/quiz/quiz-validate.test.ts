import { describe, expect, it } from "vitest";
import {
  QUIZ_DEFAULTS,
  QUIZ_LIMITS,
  interpretQuizRaw,
  resolveQuizSchema,
  toQuizRaw,
  validateQuizRaw,
  type QuizRawValues,
} from "@/lib/quiz";
import { sampleFields, sampleSchema } from "./helpers";

const schema = sampleSchema();
const ASSET = "22222222-2222-4222-8222-222222222222";
const OPTIONS = JSON.stringify([
  { id: "opt_aaa", title: "A", score: 1 },
  { id: "opt_bbb", title: "B", score: 2 },
]);

const base = (over: QuizRawValues): QuizRawValues => ({ title: "A question?", ...over });
const choice = (over: QuizRawValues = {}) => base({ questionType: "Single choice", options: OPTIONS, ...over });
const issuesOf = (raw: QuizRawValues) => validateQuizRaw(raw, schema);
const roles = (raw: QuizRawValues) => issuesOf(raw).map((i) => i.role);

describe("resolveQuizSchema", () => {
  it("resolves every role of the sample by its locked key", () => {
    expect(Object.keys(schema.fieldIdByRole)).toHaveLength(24);
    expect(schema.roleByFieldId.size).toBe(24);
  });

  it("is null unless BOTH structural fields exist with the right types", () => {
    const fields = sampleFields();
    expect(resolveQuizSchema(fields.filter((f) => f.key !== "options"))).toBeNull();
    expect(resolveQuizSchema(fields.filter((f) => f.key !== "question_type"))).toBeNull();
    expect(resolveQuizSchema(fields.map((f) => (f.key === "question_type" ? { ...f, type: "text" } : f)))).toBeNull();
    expect(resolveQuizSchema(fields.map((f) => (f.key === "options" ? { ...f, type: "text" } : f)))).toBeNull();
    expect(resolveQuizSchema([])).toBeNull();
  });

  it("ignores user fields (key null) even if named like a role, and tolerates missing optional roles", () => {
    const fields = sampleFields()
      .filter((f) => f.key !== "character_limit")
      .map((f) => (f.key === "description" ? { ...f, key: null } : f));
    const s = resolveQuizSchema(fields)!;
    expect(s.fieldIdByRole.characterLimit).toBeUndefined();
    expect(s.fieldIdByRole.description).toBeUndefined();
    expect(s.fieldIdByRole.questionType).toBeDefined();
  });

  it("maps option labels to ids (case/space-insensitive)", () => {
    expect(schema.optionIdByLabel.questionType?.get("single choice")).toBe("single_choice");
    expect(schema.optionIdByLabel.media?.get("video")).toBe("video");
  });
});

describe("toQuizRaw", () => {
  it("maps field-id values to roles and skips unknown fields", () => {
    const f = schema.fieldIdByRole;
    expect(toQuizRaw(schema, { [f.title!]: "T", [f.required!]: "false", "other-field": "x" })).toEqual({ title: "T", required: "false" });
  });
});

describe("common rules", () => {
  it("requires a title and a known question type", () => {
    expect(roles({})).toEqual(expect.arrayContaining(["title", "questionType"]));
    expect(roles(base({ questionType: "Nope" }))).toContain("questionType");
    expect(roles({ title: "   ", questionType: "Text" })).toContain("title");
  });

  it("bounds title and description length", () => {
    expect(roles(choice({ title: "x".repeat(QUIZ_LIMITS.titleMax + 1) }))).toContain("title");
    expect(issuesOf(choice({ title: "x".repeat(QUIZ_LIMITS.titleMax) }))).toEqual([]);
    expect(roles(choice({ description: "x".repeat(QUIZ_LIMITS.descriptionMax + 1) }))).toContain("description");
  });

  it("applies documented defaults", () => {
    const { value } = interpretQuizRaw(choice(), schema);
    expect(value).toMatchObject({
      showDescription: QUIZ_DEFAULTS.showDescription,
      required: QUIZ_DEFAULTS.required,
      media: { type: "none" },
    });
  });

  it("parses booleans tolerantly and falls back to the default for junk", () => {
    const v = (raw: string) => interpretQuizRaw(choice({ required: raw }), schema).value!.required;
    expect([v("true"), v("1"), v("TRUE")]).toEqual([true, true, true]);
    expect([v("false"), v("0")]).toEqual([false, false]);
    expect(v("maybe")).toBe(QUIZ_DEFAULTS.required);
  });

  it("accepts the machine id as well as the label for enum fields", () => {
    expect(interpretQuizRaw(choice({ questionType: "multiple_choice" }), schema).value?.config.type).toBe("multiple_choice");
  });
});

describe("choice questions", () => {
  it.each(["Single choice", "Multiple choice"])("%s: valid with ≥ 2 options", (t) => {
    expect(issuesOf(choice({ questionType: t }))).toEqual([]);
  });

  it("requires at least two options", () => {
    expect(roles(choice({ options: undefined }))).toContain("options");
    expect(roles(choice({ options: "[]" }))).toContain("options");
    expect(roles(choice({ options: JSON.stringify([{ id: "opt_aaa", title: "A", score: 1 }]) }))).toContain("options");
    expect(issuesOf(choice({ options: undefined }))[0].code).toBe("too_few");
  });

  it("rejects malformed option JSON and invalid options", () => {
    expect(issuesOf(choice({ options: "{not json" }))[0]).toMatchObject({ role: "options", code: "invalid" });
    expect(roles(choice({ options: JSON.stringify([{ id: "opt_aaa", title: "", score: 1 }, { id: "opt_bbb", title: "B", score: 1 }]) }))).toContain("options");
  });

  it("flags duplicate option ids and options without ids (when reading)", () => {
    const dup = JSON.stringify([{ id: "opt_aaa", title: "A", score: 1 }, { id: "opt_aaa", title: "B", score: 1 }]);
    expect(issuesOf(choice({ options: dup })).some((i) => i.code === "duplicate")).toBe(true);
    const noId = JSON.stringify([{ title: "A", score: 1 }, { title: "B", score: 1 }]);
    expect(issuesOf(choice({ options: noId })).length).toBeGreaterThan(0);
  });

  it("derives allowMultiple from the type alone — there is no separate flag", () => {
    expect(interpretQuizRaw(choice({ questionType: "Single choice" }), schema).value!.config.type).toBe("single_choice");
    expect(interpretQuizRaw(choice({ questionType: "Multiple choice" }), schema).value!.config.type).toBe("multiple_choice");
  });
});

describe("text questions", () => {
  const text = (over: QuizRawValues = {}) => base({ questionType: "Text", ...over });

  it("is valid with no configuration and applies defaults (single line, 1000)", () => {
    const { value, issues } = interpretQuizRaw(text(), schema);
    expect(issues).toEqual([]);
    expect(value!.config).toEqual({ type: "text", inputType: "single_line", characterLimit: 1000 });
  });

  it("does not require options", () => {
    expect(issuesOf(text({ options: undefined }))).toEqual([]);
  });

  it("validates input type and character limit", () => {
    expect(interpretQuizRaw(text({ inputType: "Multi line", characterLimit: "500" }), schema).value!.config).toEqual({ type: "text", inputType: "multi_line", characterLimit: 500 });
    expect(roles(text({ inputType: "Rich" }))).toContain("inputType");
    for (const bad of ["0", "-5", "1.5", "10001", "abc"]) expect(roles(text({ characterLimit: bad }))).toContain("characterLimit");
    expect(issuesOf(text({ characterLimit: "1" }))).toEqual([]);
    expect(issuesOf(text({ characterLimit: "10000" }))).toEqual([]);
  });
});

describe("numeric questions", () => {
  const num = (over: QuizRawValues = {}) => base({ questionType: "Numeric", ...over });

  it("is valid unbounded (no range) with integers by default", () => {
    expect(interpretQuizRaw(num(), schema).value!.config).toEqual({ type: "numeric", min: null, max: null, allowDecimals: false });
  });

  it("validates range ordering and allows equal bounds", () => {
    expect(issuesOf(num({ rangeFrom: "0", rangeTo: "10" }))).toEqual([]);
    expect(issuesOf(num({ rangeFrom: "5", rangeTo: "5" }))).toEqual([]);
    expect(roles(num({ rangeFrom: "10", rangeTo: "0" }))).toContain("rangeTo");
  });

  it("accepts one-sided ranges and negative bounds", () => {
    expect(issuesOf(num({ rangeFrom: "-5" }))).toEqual([]);
    expect(issuesOf(num({ rangeTo: "100" }))).toEqual([]);
    expect(issuesOf(num({ rangeFrom: "-10", rangeTo: "-1" }))).toEqual([]);
  });

  it("requires whole-number bounds when decimals are not allowed, decimals otherwise", () => {
    expect(roles(num({ rangeFrom: "0.5", rangeTo: "10" }))).toContain("rangeFrom");
    expect(issuesOf(num({ rangeFrom: "0.5", rangeTo: "10.5", allowDecimals: "true" }))).toEqual([]);
  });

  it("rejects non-numeric and out-of-range bounds", () => {
    expect(roles(num({ rangeFrom: "abc" }))).toContain("rangeFrom");
    expect(roles(num({ rangeTo: "1e13" }))).toContain("rangeTo");
    expect(roles(num({ rangeTo: "Infinity" }))).toContain("rangeTo");
  });
});

describe("sliding-scale questions", () => {
  const scale = (over: QuizRawValues = {}) =>
    base({ questionType: "Sliding scale", scoreRangeFrom: "1", scoreRangeTo: "10", ...over });

  it("requires both range bounds", () => {
    expect(roles(base({ questionType: "Sliding scale" }))).toEqual(expect.arrayContaining(["scoreRangeFrom", "scoreRangeTo"]));
    expect(roles(scale({ scoreRangeTo: undefined }))).toContain("scoreRangeTo");
  });

  it("requires from < to (strictly) and whole numbers", () => {
    expect(roles(scale({ scoreRangeFrom: "5", scoreRangeTo: "5" }))).toContain("scoreRangeTo");
    expect(roles(scale({ scoreRangeFrom: "9", scoreRangeTo: "2" }))).toContain("scoreRangeTo");
    expect(roles(scale({ scoreRangeFrom: "1.5" }))).toContain("scoreRangeFrom");
    expect(issuesOf(scale({ scoreRangeFrom: "-5", scoreRangeTo: "5" }))).toEqual([]);
  });

  it("caps the span", () => {
    expect(issuesOf(scale({ scoreRangeFrom: "0", scoreRangeTo: String(QUIZ_LIMITS.scaleSpanMax) }))).toEqual([]);
    expect(roles(scale({ scoreRangeFrom: "0", scoreRangeTo: String(QUIZ_LIMITS.scaleSpanMax + 1) }))).toContain("scoreRangeTo");
  });

  it("defaults the starting score to the midpoint (floored, also for negative ranges)", () => {
    const start = (raw: QuizRawValues) => (interpretQuizRaw(raw, schema).value!.config as { start: number }).start;
    expect(start(scale())).toBe(5); // floor((1+10)/2)
    expect(start(scale({ scoreRangeFrom: "0", scoreRangeTo: "100" }))).toBe(50);
    expect(start(scale({ scoreRangeFrom: "-5", scoreRangeTo: "0" }))).toBe(-3); // floor(-2.5)
  });

  it("validates the starting score is a whole number within the range (inclusive)", () => {
    expect(issuesOf(scale({ startingScore: "1" }))).toEqual([]);
    expect(issuesOf(scale({ startingScore: "10" }))).toEqual([]);
    expect(roles(scale({ startingScore: "0" }))).toContain("startingScore");
    expect(roles(scale({ startingScore: "11" }))).toContain("startingScore");
    expect(roles(scale({ startingScore: "5.5" }))).toContain("startingScore");
    expect(roles(scale({ startingScore: "x" }))).toContain("startingScore");
  });

  it("does not report a starting-score error when the range itself is invalid", () => {
    expect(roles(scale({ scoreRangeFrom: "9", scoreRangeTo: "2", startingScore: "50" }))).not.toContain("startingScore");
  });

  it("bounds labels (optional) and trims them", () => {
    expect(roles(scale({ leftLabel: "x".repeat(61) }))).toContain("leftLabel");
    expect(roles(scale({ centerLabel: "x".repeat(61) }))).toContain("centerLabel");
    expect(roles(scale({ rightLabel: "x".repeat(61) }))).toContain("rightLabel");
    const { value } = interpretQuizRaw(scale({ leftLabel: "  Low ", centerLabel: "  " }), schema);
    expect((value!.config as { labels: unknown }).labels).toEqual({ left: "Low", center: null, right: null });
  });

  it("validates the tooltip format only when the tooltip is on", () => {
    expect(issuesOf(scale({ showScoreTooltip: "false", scoreTooltipFormat: "garbage" }))).toEqual([]);
    expect(roles(scale({ showScoreTooltip: "true", scoreTooltipFormat: "garbage" }))).toContain("scoreTooltipFormat");
    const cfg = (raw: QuizRawValues) => (interpretQuizRaw(raw, schema).value!.config as { tooltip: unknown }).tooltip;
    expect(cfg(scale({ showScoreTooltip: "true", scoreTooltipFormat: "Percent" }))).toEqual({ show: true, format: "percent" });
    expect(cfg(scale({ showScoreTooltip: "true" }))).toEqual({ show: true, format: "actual" });
    expect(cfg(scale())).toEqual({ show: false, format: "actual" });
  });
});

describe("type switching is non-destructive and only validates what applies", () => {
  it("ignores leftover values of other types", () => {
    const leftovers: QuizRawValues = {
      characterLimit: "abc", // invalid, but irrelevant to a choice question
      rangeFrom: "9", rangeTo: "1",
      scoreRangeFrom: "x",
      inputType: "Rich",
    };
    expect(issuesOf(choice(leftovers))).toEqual([]);
    expect(issuesOf(base({ questionType: "Text", ...leftovers, characterLimit: "100", inputType: "Single line" }))).toEqual([]);
  });

  it("a choice question's options are ignored once it becomes a text question", () => {
    expect(issuesOf(base({ questionType: "Text", options: "{broken" }))).toEqual([]);
  });
});

describe("media", () => {
  it("defaults to none and ignores media fields when media is none", () => {
    expect(interpretQuizRaw(choice({ mediaImage: "junk", mediaVideoUrl: "junk" }), schema).value!.media).toEqual({ type: "none" });
  });

  it("image: requires a valid asset id, bounds alt text", () => {
    expect(roles(choice({ media: "Image" }))).toContain("mediaImage");
    expect(roles(choice({ media: "Image", mediaImage: "not-a-uuid" }))).toContain("mediaImage");
    expect(issuesOf(choice({ media: "Image", mediaImage: ASSET }))).toEqual([]);
    expect(roles(choice({ media: "Image", mediaImage: ASSET, mediaImageAlt: "x".repeat(QUIZ_LIMITS.altMax + 1) }))).toContain("mediaImageAlt");
    expect(interpretQuizRaw(choice({ media: "Image", mediaImage: ASSET, mediaImageAlt: " a cat " }), schema).value!.media).toEqual({ type: "image", assetId: ASSET, alt: "a cat" });
  });

  it("video: requires EXACTLY one of file or link", () => {
    expect(roles(choice({ media: "Video" }))).toContain("mediaVideoFile");
    const both = issuesOf(choice({ media: "Video", mediaVideoFile: ASSET, mediaVideoUrl: "https://youtu.be/aqz-KE-bpKQ" }));
    expect(both[0]).toMatchObject({ role: "mediaVideoUrl", code: "conflict" });
    expect(interpretQuizRaw(choice({ media: "Video", mediaVideoFile: ASSET }), schema).value!.media).toEqual({ type: "video", source: "upload", assetId: ASSET });
  });

  it("video link: only YouTube / Loom, never an arbitrary URL", () => {
    const ok = interpretQuizRaw(choice({ media: "Video", mediaVideoUrl: "https://www.youtube.com/watch?v=aqz-KE-bpKQ" }), schema).value!.media;
    expect(ok).toEqual({ type: "video", source: "embed", ref: { provider: "youtube", video_id: "aqz-KE-bpKQ" } });
    for (const bad of ["https://evil.example/video.mp4", "javascript:alert(1)", "https://vimeo.com/123", "https://youtube.com.evil.com/watch?v=aqz-KE-bpKQ"]) {
      const i = issuesOf(choice({ media: "Video", mediaVideoUrl: bad }));
      expect(i[0]).toMatchObject({ role: "mediaVideoUrl", code: "unsupported" });
    }
    expect(roles(choice({ media: "Video", mediaVideoUrl: "https://youtu.be/" + "a".repeat(600) }))).toContain("mediaVideoUrl");
  });

  it("an unknown media type is reported", () => {
    expect(roles(choice({ media: "Hologram" }))).toContain("media");
  });

  it("ignores the unused video source once one is chosen for the mode", () => {
    const { value } = interpretQuizRaw(choice({ media: "Video", mediaVideoUrl: "https://youtu.be/aqz-KE-bpKQ", mediaImage: "junk" }), schema);
    expect(value!.media).toMatchObject({ source: "embed" });
  });
});

describe("issue reporting", () => {
  it("returns every problem at once, each attributed to a role", () => {
    const i = issuesOf({ questionType: "Sliding scale", leftLabel: "x".repeat(99) });
    expect(i.map((x) => x.role)).toEqual(expect.arrayContaining(["title", "scoreRangeFrom", "scoreRangeTo", "leftLabel"]));
    for (const x of i) expect(x.message.length).toBeGreaterThan(0);
  });

  it("a valid record yields value and no issues; an invalid one yields null", () => {
    expect(interpretQuizRaw(choice(), schema)).toMatchObject({ issues: [], value: expect.any(Object) });
    expect(interpretQuizRaw({}, schema).value).toBeNull();
  });
});
