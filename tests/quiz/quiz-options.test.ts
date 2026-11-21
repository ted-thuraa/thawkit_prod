import { describe, expect, it } from "vitest";
import {
  canonicalizeAnswerOptions,
  collectOptionAssetIds,
  generateOptionId,
  isAssetId,
  parseAnswerOptionsJson,
  serializeAnswerOptions,
} from "@/lib/quiz";

const ASSET = "11111111-1111-4111-8111-111111111111";

describe("parseAnswerOptionsJson", () => {
  it("treats absent / blank as empty and non-arrays / bad JSON as invalid", () => {
    for (const v of [undefined, null, "", "   "]) expect(parseAnswerOptionsJson(v)).toEqual({ kind: "empty" });
    for (const v of ["{}", "5", '"x"', "[", "nope"]) expect(parseAnswerOptionsJson(v)).toEqual({ kind: "invalid" });
    expect(parseAnswerOptionsJson("[]")).toEqual({ kind: "ok", items: [] });
  });
});

describe("generateOptionId", () => {
  it("produces valid, practically unique ids", () => {
    const ids = new Set(Array.from({ length: 500 }, generateOptionId));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^opt_[a-z0-9]{8}$/);
  });
});

describe("canonicalizeAnswerOptions (write mode)", () => {
  it("assigns missing ids, trims, drops empties and orders keys canonically", () => {
    const { options, issues } = canonicalizeAnswerOptions(
      [{ title: "  Yes ", description: "  ", score: 2, icon: " 👍 ", image: null, extra: "dropped" }],
      () => "opt_gen1",
    );
    expect(issues).toEqual([]);
    expect(options).toEqual([{ id: "opt_gen1", title: "Yes", score: 2, icon: "👍" }]);
    expect(Object.keys(options[0])).toEqual(["id", "title", "score", "icon"]);
    expect(serializeAnswerOptions(options)).toBe('[{"id":"opt_gen1","title":"Yes","score":2,"icon":"👍"}]');
  });

  it("keeps description and image in the canonical position", () => {
    const { options } = canonicalizeAnswerOptions([
      { id: "opt_abc", title: "A", description: "d", score: 0, icon: "x", image: { asset_id: ASSET } },
    ]);
    expect(Object.keys(options[0])).toEqual(["id", "title", "description", "score", "icon", "image"]);
  });

  it("accepts zero, negative and fractional scores", () => {
    const { options, issues } = canonicalizeAnswerOptions([
      { id: "opt_aaa", title: "Zero", score: 0 },
      { id: "opt_bbb", title: "Neg", score: -2 },
      { id: "opt_ccc", title: "Frac", score: 0.25 },
    ]);
    expect(issues).toEqual([]);
    expect(options.map((o) => o.score)).toEqual([0, -2, 0.25]);
  });

  it.each([
    [{ title: "", score: 1 }, "title is required"],
    [{ title: "   ", score: 1 }, "title is required"],
    [{ title: "x", score: "1" }, "score must be a number"],
    [{ title: "x", score: Number.NaN }, "score must be a number"],
    [{ title: "x", score: Infinity }, "score must be a number"],
    [{ title: "x", score: 1_000_001 }, "score must be between"],
    [{ title: "x".repeat(201), score: 1 }, "title must be at most 200"],
    [{ title: "x", score: 1, description: "d".repeat(501) }, "description must be at most 500"],
    [{ title: "x", score: 1, icon: "i".repeat(17) }, "icon must be at most 16"],
    [{ title: "x", score: 1, description: 5 }, "description must be text"],
    [{ title: "x", score: 1, image: { asset_id: "not-a-uuid" } }, "invalid image"],
    [{ title: "x", score: 1, image: "http://evil" }, "invalid image"],
    [{ id: "bad id", title: "x", score: 1 }, "invalid id"],
    [{ id: "opt_", title: "x", score: 1 }, "invalid id"],
    ["string", "not a valid object"],
    [null, "not a valid object"],
    [[1], "not a valid object"],
  ])("rejects %j", (input, message) => {
    const { options, issues } = canonicalizeAnswerOptions([input]);
    expect(options).toEqual([]);
    expect(issues.map((i) => i.message).join(" ")).toContain(message);
  });

  it("flags duplicate ids", () => {
    const { issues } = canonicalizeAnswerOptions([
      { id: "opt_same", title: "A", score: 1 },
      { id: "opt_same", title: "B", score: 2 },
    ]);
    expect(issues.some((i) => i.code === "duplicate")).toBe(true);
  });

  it("caps the list at 50 before doing any per-item work", () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ id: `opt_item${i}`, title: "x", score: 1 }));
    const { issues } = canonicalizeAnswerOptions(many);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("too_many");
    expect(canonicalizeAnswerOptions(many.slice(0, 50)).issues).toEqual([]);
  });

  it("collects every valid problem, not just the first", () => {
    const { issues } = canonicalizeAnswerOptions([{ title: "", score: "x" }, { title: "ok", score: 1, id: "??" }]);
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });
});

describe("canonicalizeAnswerOptions (read mode, no generator)", () => {
  it("reports a missing id instead of inventing one (reading is side-effect free)", () => {
    const { options, issues } = canonicalizeAnswerOptions([{ title: "A", score: 1 }], null);
    expect(options).toEqual([]);
    expect(issues[0]).toMatchObject({ code: "required" });
    expect(issues[0].message).toContain("id is required");
  });
});

describe("asset id helpers", () => {
  it("isAssetId accepts UUIDs only", () => {
    expect(isAssetId(ASSET)).toBe(true);
    for (const v of ["", "abc", 5, null, undefined, `${ASSET}x`, "../etc/passwd"]) expect(isAssetId(v)).toBe(false);
  });

  it("collectOptionAssetIds returns the distinct valid image asset ids", () => {
    expect(
      collectOptionAssetIds([
        { image: { asset_id: ASSET } },
        { image: { asset_id: ASSET } },
        { image: { asset_id: "nope" } },
        { image: null },
        "junk",
      ]),
    ).toEqual([ASSET]);
  });
});
