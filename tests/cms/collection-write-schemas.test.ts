import { describe, expect, it } from "vitest";
import {
  createCollectionSchema,
  createFieldSchema,
  itemValuesSchema,
  reorderIdsSchema,
  updateCollectionSchema,
  updateFieldSchema,
} from "@/lib/editor/write/schemas";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

describe("collection schemas", () => {
  it("trims and bounds names", () => {
    expect(createCollectionSchema.parse({ name: "  Posts " })).toEqual({ name: "Posts" });
    expect(() => createCollectionSchema.parse({ name: "   " })).toThrow();
    expect(() => createCollectionSchema.parse({ name: "x".repeat(201) })).toThrow();
  });

  it("rejects unknown keys on update (no mass-assignment of order / funnel / flags)", () => {
    expect(() => updateCollectionSchema.parse({ name: "A", funnelId: "other" })).toThrow();
    expect(() => updateCollectionSchema.parse({ is_published: true })).toThrow();
    expect(updateCollectionSchema.parse({ sorting: null })).toEqual({ sorting: null });
    expect(() => updateCollectionSchema.parse({ sorting: { field: "x", direction: "sideways" } })).toThrow();
  });
});

describe("field schemas", () => {
  it("does not accept a client-supplied built-in `key`, and rejects 'status'", () => {
    expect(() => createFieldSchema.parse({ name: "F", type: "text", key: "name" })).toThrow();
    expect(() => createFieldSchema.parse({ name: "F", type: "status" })).toThrow();
    expect(createFieldSchema.parse({ name: "F", type: "text" })).toMatchObject({ name: "F", type: "text" });
  });

  it("requires uuids for reference targets and count config", () => {
    expect(() => createFieldSchema.parse({ name: "F", type: "reference", reference_collection_id: "nope" })).toThrow();
    expect(
      createFieldSchema.parse({ name: "F", type: "count", data: { count: { collectionId: U1, fieldId: U2 } } }),
    ).toBeTruthy();
    expect(() =>
      createFieldSchema.parse({ name: "F", type: "count", data: { count: { collectionId: "x", fieldId: U2 } } }),
    ).toThrow();
  });

  it("cannot change a field's type or order on update", () => {
    expect(() => updateFieldSchema.parse({ type: "number" })).toThrow();
    expect(() => updateFieldSchema.parse({ order: 3 })).toThrow();
    expect(updateFieldSchema.parse({ hidden: true })).toEqual({ hidden: true });
  });
});

describe("item values and reorder payloads", () => {
  it("accepts scalars, lists and documents keyed by field uuid", () => {
    expect(
      itemValuesSchema.parse({ [U1]: "text", [U2]: ["a"] }),
    ).toEqual({ [U1]: "text", [U2]: ["a"] });
    expect(itemValuesSchema.parse({ [U1]: { type: "doc" } })).toBeTruthy();
    expect(itemValuesSchema.parse({ [U1]: null, [U2]: true })).toBeTruthy();
  });

  it("rejects non-uuid keys, oversized values and too many keys", () => {
    expect(() => itemValuesSchema.parse({ "not-a-uuid": "x" })).toThrow();
    expect(() => itemValuesSchema.parse({ [U1]: "x".repeat(2_000_001) })).toThrow();
    const many = Object.fromEntries(
      Array.from({ length: 201 }, (_, i) => [`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, "x"]),
    );
    expect(() => itemValuesSchema.parse(many)).toThrow();
  });

  it("bounds reorder id lists", () => {
    expect(reorderIdsSchema.parse([U1, U2])).toEqual([U1, U2]);
    expect(() => reorderIdsSchema.parse([])).toThrow();
    expect(() => reorderIdsSchema.parse(["x"])).toThrow();
    expect(() => reorderIdsSchema.parse(Array(501).fill(U1))).toThrow();
  });
});
