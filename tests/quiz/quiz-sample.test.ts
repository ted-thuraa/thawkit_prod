import { describe, expect, it } from "vitest";
import { QUIZ_SAMPLE } from "@/lib/quiz/sample";
import {
  SAMPLE_COLLECTIONS,
  getSampleCollectionById,
  getSampleCollectionOptions,
} from "@/lib/sample-collections";
import { buildSampleFieldPlan } from "@/lib/editor/write/sample-fields";
import { isFieldVisible, indexFieldsById } from "@/lib/collection-field-visibility";
import {
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  QUIZ_FIELD_KEYS,
  QUIZ_SAMPLE_ID,
  validateQuizRaw,
  toQuizRaw,
  type QuizFieldRole,
} from "@/lib/quiz";
import { sampleFields, sampleSchema } from "./helpers";

const ids = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};

describe("registration", () => {
  it("is a registered sample with a unique id, placed after Quiz Categories", () => {
    expect(getSampleCollectionById(QUIZ_SAMPLE_ID)).toBe(QUIZ_SAMPLE);
    const all = SAMPLE_COLLECTIONS.map((s) => s.id);
    expect(new Set(all).size).toBe(all.length);
    expect(all.indexOf("quiz")).toBe(all.indexOf("quiz categories") + 1);
  });

  it("appears in the Samples menu as 'Quiz'", () => {
    expect(getSampleCollectionOptions()).toContainEqual({ id: "quiz", name: "Quiz" });
  });

  it("leaves the other samples untouched (no new optional properties on them)", () => {
    for (const s of SAMPLE_COLLECTIONS.filter((x) => x.id !== "quiz")) {
      expect(s.builtInLabels).toBeUndefined();
      for (const f of s.customFields) {
        expect(f.locked).toBeUndefined();
        expect(f.data).toBeUndefined();
        expect(f.showWhen).toBeUndefined();
        expect(f.default).toBeUndefined();
      }
    }
  });
});

describe("field plan", () => {
  const plan = buildSampleFieldPlan(QUIZ_SAMPLE, ids());
  const byKey = new Map(plan.map((p) => [p.lookupKey, p]));

  it("orders built-ins → quiz fields → built-ins, sequentially, with unique ids", () => {
    expect(plan.map((p) => p.order)).toEqual(plan.map((_, i) => i));
    expect(new Set(plan.map((p) => p.id)).size).toBe(plan.length);
    expect(plan.slice(0, 3).map((p) => p.persistKey)).toEqual(["id", "name", "slug"]);
    expect(plan.slice(-2).map((p) => p.persistKey)).toEqual(["created_at", "updated_at"]);
    expect(plan).toHaveLength(5 + 23);
  });

  it("covers every quiz role exactly once", () => {
    const keys = plan.map((p) => p.persistKey).filter(Boolean);
    for (const key of Object.values(QUIZ_FIELD_KEYS)) expect(keys.filter((k) => k === key)).toHaveLength(1);
  });

  it("persists a key for EVERY quiz field (locked) and relabels the built-in name", () => {
    for (const def of QUIZ_SAMPLE.customFields) {
      expect(def.locked, def.name).toBe(true);
      expect(byKey.get(def.key)!.persistKey, def.name).toBe(def.key);
    }
    expect(byKey.get("name")!.name).toBe("Question");
  });

  it("defines the question-type option with stable ids and labels, and a default", () => {
    const f = byKey.get("question_type")!;
    expect(f.type).toBe("option");
    expect(f.data.options).toEqual(QUESTION_TYPES.map((id) => ({ id, name: QUESTION_TYPE_LABELS[id] })));
    expect(f.defaultValue).toBe("Single choice");
  });

  it("uses the template-only answer_options type for the options field", () => {
    expect(byKey.get("options")!.type).toBe("answer_options");
  });

  it("defaults only the booleans that default to true (other defaults resolve at read time)", () => {
    const defaults = Object.fromEntries(plan.filter((p) => p.defaultValue !== null).map((p) => [p.persistKey, p.defaultValue]));
    expect(defaults).toEqual({ show_description: "true", question_type: "Single choice", required: "true" });
  });

  it("shows description, question type and required by default; everything type-specific is a hidden column", () => {
    const visible = QUIZ_SAMPLE.customFields.filter((f) => !f.hidden).map((f) => f.key);
    expect(visible).toEqual(["description", "question_type", "required"]);
  });

  it("resolves every showWhen to existing sibling field IDS", () => {
    const allIds = new Set(plan.map((p) => p.id));
    let withRules = 0;
    for (const p of plan) {
      for (const c of p.data.showWhen ?? []) {
        withRules++;
        expect(allIds.has(c.fieldId)).toBe(true);
        expect(c.fieldId).not.toBe(p.id);
        expect(c.equals.length).toBeGreaterThan(0);
      }
    }
    expect(withRules).toBeGreaterThan(15);
  });

  it("rejects malformed definitions (programming errors)", () => {
    const base = { id: "x", name: "X", items: [] };
    const field = { name: "F", key: "f", type: "text" as const, fillable: true, hidden: false, order: 1 };
    expect(() => buildSampleFieldPlan({ ...base, customFields: [{ ...field, locked: true, key: null }] }, ids())).toThrow(/needs a key/);
    expect(() => buildSampleFieldPlan({ ...base, customFields: [field, { ...field, name: "G" }] }, ids())).toThrow(/duplicate field key/);
    expect(() => buildSampleFieldPlan({ ...base, customFields: [{ ...field, showWhen: [{ fieldKey: "nope", equals: ["a"] }] }] }, ids())).toThrow(/unknown field "nope"/);
  });

  it("unlocked sample fields stay editable (key NOT persisted) — existing samples behave as before", () => {
    const people = SAMPLE_COLLECTIONS.find((s) => s.id === "people")!;
    const p = buildSampleFieldPlan(people, ids());
    for (const def of people.customFields) {
      const row = p.find((r) => r.lookupKey === def.key)!;
      expect(row.persistKey).toBeNull();
      expect(row.defaultValue).toBeNull();
      expect(row.data).toEqual({});
    }
    expect(p.find((r) => r.lookupKey === "name")!.name).toBe("Name"); // no relabel
  });
});

describe("conditional display of the shipped fields", () => {
  const fields = sampleFields();
  const byId = indexFieldsById(fields);
  const typeId = sampleSchema().fieldIdByRole.questionType!;
  const keyToField = new Map(fields.map((f) => [f.key, f]));
  const visible = (key: string, values: Record<string, unknown>) => isFieldVisible(keyToField.get(key)!, byId, values);

  it.each([
    ["Single choice", ["options"], ["character_limit", "range_from", "score_range_from"]],
    ["Multiple choice", ["options"], ["character_limit", "range_from", "score_range_from"]],
    ["Text", ["input_type", "character_limit"], ["options", "range_from", "score_range_from"]],
    ["Numeric", ["range_from", "range_to", "allow_decimals"], ["options", "character_limit", "score_range_from"]],
    ["Sliding scale", ["score_range_from", "score_range_to", "starting_score", "left_label"], ["options", "character_limit", "range_from"]],
  ])("%s shows its own fields and hides the others", (label, shown, hidden) => {
    const values = { [typeId]: label };
    for (const k of shown) expect(visible(k, values), `${k} should show`).toBe(true);
    for (const k of hidden) expect(visible(k, values), `${k} should hide`).toBe(false);
  });

  it("always shows common fields", () => {
    for (const k of ["description", "show_description", "question_type", "required", "media"]) expect(visible(k, {})).toBe(true);
  });

  it("media-dependent fields follow the media selection", () => {
    const mediaId = sampleSchema().fieldIdByRole.media!;
    expect(visible("media_image", { [mediaId]: "Image" })).toBe(true);
    expect(visible("media_image", { [mediaId]: "None" })).toBe(false);
    expect(visible("media_video_url", { [mediaId]: "Video" })).toBe(true);
    expect(visible("media_video_url", { [mediaId]: "Image" })).toBe(false);
    expect(visible("media_video_url", {})).toBe(false);
  });

  it("tooltip format needs BOTH a scale question AND the tooltip switched on", () => {
    const tooltipId = sampleSchema().fieldIdByRole.showScoreTooltip!;
    const scale = { [typeId]: "Sliding scale" };
    expect(visible("score_tooltip_format", { ...scale, [tooltipId]: true })).toBe(true);
    expect(visible("score_tooltip_format", { ...scale, [tooltipId]: "true" })).toBe(true);
    expect(visible("score_tooltip_format", { ...scale, [tooltipId]: false })).toBe(false);
    expect(visible("score_tooltip_format", scale)).toBe(false);
    expect(visible("score_tooltip_format", { [typeId]: "Text", [tooltipId]: true })).toBe(false);
  });
});

describe("sample content", () => {
  const schema = sampleSchema();
  const f = schema.fieldIdByRole;
  const roleByKey = new Map((Object.entries(QUIZ_FIELD_KEYS) as [QuizFieldRole, string][]).map(([r, k]) => [k, r]));

  it("has one question of every type, plus a media example", () => {
    expect(QUIZ_SAMPLE.items).toHaveLength(6);
    const types = new Set(QUIZ_SAMPLE.items.map((i) => i.values[QUIZ_FIELD_KEYS.questionType]));
    expect(types).toEqual(new Set(QUESTION_TYPES.map((t) => QUESTION_TYPE_LABELS[t])));
    expect(QUIZ_SAMPLE.items.some((i) => i.values[QUIZ_FIELD_KEYS.media] === "Video")).toBe(true);
  });

  it("every item is valid under the shared validator — the sample path bypasses the write boundary, so this is the guard", () => {
    for (const item of QUIZ_SAMPLE.items) {
      const byField: Record<string, string> = {};
      for (const [key, value] of Object.entries(item.values)) {
        const role = roleByKey.get(key);
        if (role) byField[f[role]!] = value;
      }
      expect(validateQuizRaw(toQuizRaw(schema, byField), schema), item.values.slug).toEqual([]);
    }
  });

  it("slugs are present, unique and URL-safe; titles are unique", () => {
    const slugs = QUIZ_SAMPLE.items.map((i) => i.values.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    const titles = QUIZ_SAMPLE.items.map((i) => i.values[QUIZ_FIELD_KEYS.title]);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("references no images (sample assets are not provisioned in ThawKit)", () => {
    for (const item of QUIZ_SAMPLE.items) expect(item.images).toBeUndefined();
  });
});
