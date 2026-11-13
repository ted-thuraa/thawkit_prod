// Reference discovery behind "where is this collection / field used?".
// Pure module — no mocks.
import { describe, expect, it } from "vitest";
import {
  countFieldsDependingOnField,
  fieldsDependingOnCollection,
  referencesTarget,
  scanRows,
  type FieldDependencyRow,
} from "@/lib/collection-usage-scan";

const COL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FIELD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const col = { kind: "collection", id: COL } as const;
const field = { kind: "field", id: FIELD } as const;

describe("referencesTarget — collections", () => {
  it("finds a collection layer's variables.collection.id at any depth", () => {
    const layers = [
      { id: "root", children: [{ id: "a", children: [{ id: "b", variables: { collection: { id: COL } } }] }] },
    ];
    expect(referencesTarget(layers, col)).toBe(true);
  });

  it("finds page settings.cms.collection_id", () => {
    expect(referencesTarget({ cms: { collection_id: COL } }, col)).toBe(true);
  });

  it("finds option sources, sort sources and visibility reference collections", () => {
    expect(referencesTarget({ settings: { optionsSource: { collectionId: COL } } }, col)).toBe(true);
    expect(referencesTarget({ settings: { sortByCollectionId: COL } }, col)).toBe(true);
    expect(
      referencesTarget(
        { variables: { conditionalVisibility: { groups: [{ conditions: [{ referenceCollectionId: COL }] }] } } },
        col,
      ),
    ).toBe(true);
  });

  it("ignores other collections and unrelated string values", () => {
    expect(referencesTarget({ variables: { collection: { id: OTHER } } }, col)).toBe(false);
    // the id as plain text content is not a reference
    expect(referencesTarget({ text: COL, name: COL }, col)).toBe(false);
  });

  it("only matches a collection id under a collection key, never a field key", () => {
    expect(referencesTarget({ field_id: COL }, col)).toBe(false);
  });
});

describe("referencesTarget — fields", () => {
  it("finds dynamic field variables (inline marks, text and attributes)", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "x", marks: [{ type: "dynamicVariable", attrs: { variable: { type: "field", data: { field_id: FIELD } } } }] },
          ],
        },
      ],
    };
    expect(referencesTarget(doc, field)).toBe(true);
  });

  it("finds sort fields, slug bindings and visibility conditions", () => {
    expect(referencesTarget({ variables: { collection: { id: COL, sort_by: FIELD } } }, field)).toBe(true);
    expect(referencesTarget({ cms: { slug_field_id: FIELD } }, field)).toBe(true);
    expect(referencesTarget({ conditions: [{ fieldId: FIELD }] }, field)).toBe(true);
    expect(referencesTarget({ sortByFieldIds: ["x", FIELD] }, field)).toBe(true);
  });

  it("does not treat sort keywords or other ids as a match", () => {
    expect(referencesTarget({ sort_by: "manual" }, field)).toBe(false);
    expect(referencesTarget({ field_id: OTHER }, field)).toBe(false);
  });
});

describe("nested serialized structures", () => {
  it("walks JSON documents stored inside strings", () => {
    const inner = JSON.stringify({ a: [{ field_id: FIELD }] });
    expect(referencesTarget({ value: inner }, field)).toBe(true);
    const twice = JSON.stringify({ wrapped: inner });
    expect(referencesTarget({ value: twice }, field)).toBe(true);
  });

  it("is not fooled by strings that merely mention the id or are invalid JSON", () => {
    expect(referencesTarget({ value: `{ not json ${FIELD}` }, field)).toBe(false);
    expect(referencesTarget({ value: `see ${FIELD}` }, field)).toBe(false);
  });
});

describe("malformed and hostile input", () => {
  it("never throws on null / primitives / empty ids", () => {
    for (const v of [null, undefined, 0, "", true, [], {}, [null], { a: null }]) {
      expect(referencesTarget(v, col)).toBe(false);
    }
    expect(referencesTarget({ collection_id: "" }, { kind: "collection", id: "" })).toBe(false);
  });

  it("is bounded on extremely deep structures", () => {
    let deep: unknown = { collection_id: COL };
    for (let i = 0; i < 5000; i++) deep = { child: deep };
    expect(() => referencesTarget(deep, col)).not.toThrow();
    expect(referencesTarget(deep, col)).toBe(false); // beyond the depth budget
  });

  it("is bounded on very wide structures", () => {
    const wide = Array.from({ length: 300_000 }, () => ({ x: 1 }));
    wide.push({ collection_id: COL } as never);
    expect(() => referencesTarget(wide, col)).not.toThrow();
  });
});

describe("scanRows", () => {
  it("reports each row once, sorted by name, across all its JSON columns", () => {
    const rows = [
      { id: "p2", name: "Zeta", data: [{}, { cms: { collection_id: COL } }] },
      { id: "p1", name: "Alpha", data: [{ variables: { collection: { id: COL } } }, { cms: { collection_id: COL } }] },
      { id: "p3", name: "Unrelated", data: [{ variables: { collection: { id: OTHER } } }] },
      { id: "p1", name: "Alpha (dup row)", data: [{ cms: { collection_id: COL } }] },
    ];
    expect(scanRows(rows, col)).toEqual([
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Zeta" },
    ]);
  });
});

describe("field dependencies", () => {
  const base = { referenceCollectionId: null, data: {} };
  const rows: FieldDependencyRow[] = [
    { ...base, id: "f1", name: "Author", type: "reference", collectionId: OTHER, collectionName: "Posts", referenceCollectionId: COL },
    { ...base, id: "f2", name: "Tags", type: "multi_reference", collectionId: OTHER, collectionName: "Posts", referenceCollectionId: COL },
    { ...base, id: "f3", name: "Post count", type: "count", collectionId: COL, collectionName: "Authors", data: { count: { collectionId: OTHER, fieldId: "f1" } } },
    { ...base, id: "f4", name: "Authors", type: "count", collectionId: "third", collectionName: "Teams", data: { count: { collectionId: COL, fieldId: "fx" } } },
    { ...base, id: "f5", name: "Self", type: "reference", collectionId: COL, collectionName: "Authors", referenceCollectionId: COL },
    { ...base, id: "f6", name: "Elsewhere", type: "reference", collectionId: OTHER, collectionName: "Posts", referenceCollectionId: "third" },
  ];

  it("lists reference and count fields of OTHER collections that depend on a collection", () => {
    const deps = fieldsDependingOnCollection(rows, COL);
    expect(deps.map((d) => [d.id, d.fieldType]).sort()).toEqual([
      ["f1", "reference"],
      ["f2", "multi_reference"],
      ["f4", "count"],
    ]);
  });

  it("does not count a collection's own self-reference", () => {
    expect(fieldsDependingOnCollection(rows, COL).some((d) => d.id === "f5")).toBe(false);
  });

  it("lists count fields that count a given reference field", () => {
    expect(countFieldsDependingOnField(rows, "f1").map((d) => d.id)).toEqual(["f3"]);
    expect(countFieldsDependingOnField(rows, "nope")).toEqual([]);
  });
});
