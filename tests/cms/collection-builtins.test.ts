import { describe, expect, it } from "vitest";
import {
  SYSTEM_FIELD_KEYS,
  getNewCollectionBuiltInFields,
  serializeItemValue,
  uniqueName,
} from "@/lib/editor/write/collection-builtins";

describe("built-in fields of a new collection", () => {
  const fields = getNewCollectionBuiltInFields();

  it("are ordered sequentially from 0", () => {
    expect(fields.map((f) => f.order)).toEqual(fields.map((_, i) => i));
  });

  it("contain id, name, slug and the two dates — and NO status field", () => {
    expect(fields.map((f) => f.key)).toEqual(["id", "name", "slug", "created_at", "updated_at"]);
    expect(fields.some((f) => (f.type as string) === "status")).toBe(false);
    expect(fields.some((f) => f.key === "status")).toBe(false);
  });

  it("marks only name and slug as client-fillable; system fields are server-owned", () => {
    expect(fields.filter((f) => f.fillable).map((f) => f.key)).toEqual(["name", "slug"]);
    for (const key of ["id", "created_at", "updated_at"]) expect(SYSTEM_FIELD_KEYS.has(key)).toBe(true);
  });
});

describe("serializeItemValue", () => {
  it("treats empty-ish values as 'no value'", () => {
    for (const v of [null, undefined, "", Number.NaN, Infinity]) expect(serializeItemValue(v)).toBeNull();
  });
  it("keeps strings, stringifies numbers and booleans", () => {
    expect(serializeItemValue("hi")).toBe("hi");
    expect(serializeItemValue(0)).toBe("0");
    expect(serializeItemValue(12.5)).toBe("12.5");
    expect(serializeItemValue(true)).toBe("true");
    expect(serializeItemValue(false)).toBe("false");
  });
  it("JSON-encodes lists and documents", () => {
    expect(serializeItemValue(["a", "b"])).toBe('["a","b"]');
    expect(serializeItemValue({ type: "doc" })).toBe('{"type":"doc"}');
  });
});

describe("uniqueName", () => {
  it("returns the base when free, else the next free suffix (case-insensitive)", () => {
    expect(uniqueName("Blog", [])).toBe("Blog");
    expect(uniqueName("Blog", ["blog"])).toBe("Blog 2");
    expect(uniqueName("Blog", ["Blog", "Blog 2", "BLOG 3"])).toBe("Blog 4");
  });
});
