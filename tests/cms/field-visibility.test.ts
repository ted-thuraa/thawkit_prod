import { describe, expect, it } from "vitest";
import { indexFieldsById, isFieldVisible } from "@/lib/collection-field-visibility";
import type { CollectionField } from "@/types/funnel";

type F = Pick<CollectionField, "id" | "type" | "data" | "default">;

const field = (id: string, type: CollectionField["type"], data: CollectionField["data"] = {}): F => ({ id, type, data, default: null });

const select = field("sel", "option", { options: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }] });
const flag = field("flag", "boolean");
const text = field("txt", "text");
const all = [select, flag, text];
const byId = indexFieldsById(all);

const visible = (f: Pick<F, "data">, values: Record<string, unknown>) => isFieldVisible(f, byId, values);
const dependent = (...showWhen: { fieldId: string; equals: string[] }[]) => ({ data: { showWhen } });

describe("isFieldVisible", () => {
  it("is always visible without rules (including empty rule lists)", () => {
    expect(visible({ data: {} }, {})).toBe(true);
    expect(visible({ data: null }, {})).toBe(true);
    expect(visible(dependent(), {})).toBe(true);
  });

  it("option sources compare by option ID, mapping the stored label (case/space-insensitive)", () => {
    const f = dependent({ fieldId: "sel", equals: ["a"] });
    expect(visible(f, { sel: "Alpha" })).toBe(true);
    expect(visible(f, { sel: "  alpha " })).toBe(true);
    expect(visible(f, { sel: "Beta" })).toBe(false);
    expect(visible(f, { sel: "" })).toBe(false);
    expect(visible(f, {})).toBe(false);
  });

  it("an unknown option label falls back to the raw text (a machine id still matches)", () => {
    expect(visible(dependent({ fieldId: "sel", equals: ["zzz"] }), { sel: "zzz" })).toBe(true);
    expect(visible(dependent({ fieldId: "sel", equals: ["a"] }), { sel: "Unknown" })).toBe(false);
  });

  it("matches any of several accepted values", () => {
    const f = dependent({ fieldId: "sel", equals: ["a", "b"] });
    expect(visible(f, { sel: "Alpha" })).toBe(true);
    expect(visible(f, { sel: "Beta" })).toBe(true);
  });

  it("boolean sources: absent is false; accepts true / 'true' / '1'", () => {
    const on = dependent({ fieldId: "flag", equals: ["true"] });
    const off = dependent({ fieldId: "flag", equals: ["false"] });
    for (const v of [true, "true", "TRUE", "1"]) expect(visible(on, { flag: v }), String(v)).toBe(true);
    for (const v of [false, "false", "", undefined, null, "0", "garbage"]) expect(visible(on, { flag: v }), String(v)).toBe(false);
    expect(visible(off, {})).toBe(true);
  });

  it("other sources compare trimmed raw text", () => {
    const f = dependent({ fieldId: "txt", equals: ["go"] });
    expect(visible(f, { txt: " go " })).toBe(true);
    expect(visible(f, { txt: "stop" })).toBe(false);
    expect(visible(dependent({ fieldId: "txt", equals: ["5"] }), { txt: 5 })).toBe(true); // numbers stringify
  });

  it("multiple conditions are ANDed", () => {
    const f = dependent({ fieldId: "sel", equals: ["a"] }, { fieldId: "flag", equals: ["true"] });
    expect(visible(f, { sel: "Alpha", flag: true })).toBe(true);
    expect(visible(f, { sel: "Alpha", flag: false })).toBe(false);
    expect(visible(f, { sel: "Beta", flag: true })).toBe(false);
  });

  it("FAILS OPEN when the source field no longer exists (never makes a field unreachable)", () => {
    expect(visible(dependent({ fieldId: "deleted", equals: ["x"] }), {})).toBe(true);
    // …even alongside a satisfied/unsatisfied real condition, a missing one does not block
    expect(visible(dependent({ fieldId: "deleted", equals: ["x"] }, { fieldId: "flag", equals: ["true"] }), { flag: true })).toBe(true);
    expect(visible(dependent({ fieldId: "deleted", equals: ["x"] }, { fieldId: "flag", equals: ["true"] }), { flag: false })).toBe(false);
  });

  it("does not mutate its inputs", () => {
    const values = { sel: "Alpha" };
    const f = dependent({ fieldId: "sel", equals: ["a"] });
    const before = JSON.stringify({ values, f, all });
    visible(f, values);
    expect(JSON.stringify({ values, f, all })).toBe(before);
  });
});

describe("indexFieldsById", () => {
  it("indexes by id", () => {
    expect(indexFieldsById(all).get("flag")).toBe(flag);
    expect(indexFieldsById([]).size).toBe(0);
  });
});
