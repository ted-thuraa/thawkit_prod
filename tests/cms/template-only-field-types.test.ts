import { describe, expect, it } from "vitest";
import {
  DISPLAYABLE_FIELD_TYPES,
  FIELD_TYPES,
  FIELD_TYPES_BY_CATEGORY,
  TEMPLATE_ONLY_FIELD_TYPES,
  bindableFields,
  buildFieldGroups,
  getFieldIcon,
  getFieldTypeLabel,
  isBindableFieldType,
  isCatalogFieldType,
  isTemplateOnlyFieldType,
  isValidFieldType,
  supportsDefaultValue,
} from "@/lib/collection-field-utils";
import { createFieldSchema, FIELD_TYPE_VALUES, updateFieldSchema } from "@/lib/editor/write/schemas";
import { collectReferencedAssetIds } from "@/lib/editor/bootstrap/collect-asset-ids";
import type { CollectionField } from "@/types/funnel";

const ASSET = "55555555-5555-4555-8555-555555555555";

describe("template-only field types", () => {
  it("answer_options is template-only and NOT in the user catalogue", () => {
    expect(isTemplateOnlyFieldType("answer_options")).toBe(true);
    expect(TEMPLATE_ONLY_FIELD_TYPES.map((t) => t.value)).toEqual(["answer_options"]);
    expect(FIELD_TYPES.some((t) => (t.value as string) === "answer_options")).toBe(false);
    expect(isCatalogFieldType("answer_options")).toBe(false);
    for (const t of FIELD_TYPES) expect(isTemplateOnlyFieldType(t.value)).toBe(false);
  });

  it("is absent from every user-facing list", () => {
    expect(isValidFieldType("answer_options")).toBe(false);
    expect(DISPLAYABLE_FIELD_TYPES.map((t) => t as string)).not.toContain("answer_options");
    const menu = FIELD_TYPES_BY_CATEGORY.flatMap((c) => c.types.map((t) => t.value as string));
    expect(menu).not.toContain("answer_options");
  });

  it("cannot be created or reconfigured through the public field schemas", () => {
    expect((FIELD_TYPE_VALUES as readonly string[]).includes("answer_options")).toBe(false);
    expect(() => createFieldSchema.parse({ name: "Options", type: "answer_options" })).toThrow();
    expect(() => updateFieldSchema.parse({ type: "answer_options" })).toThrow(); // type is not updatable at all
  });

  it("still has an icon and label for display (table headers, field lists)", () => {
    expect(getFieldIcon("answer_options")).toBe("listUnordered");
    expect(getFieldTypeLabel("answer_options")).toBe("Answer options");
    expect(supportsDefaultValue("answer_options")).toBe(false);
    // existing types unaffected
    expect(getFieldIcon("text")).toBeTruthy();
    expect(getFieldTypeLabel("date_only")).toBe("Date");
    expect(getFieldTypeLabel("not-a-type")).toBe("not-a-type");
  });

  it("isCatalogFieldType narrows catalogue types and rejects unknown / uncatalogued ones", () => {
    expect(isCatalogFieldType("text")).toBe(true);
    expect(isCatalogFieldType("count")).toBe(true);
    for (const t of ["icon", "nope", "", undefined]) expect(isCatalogFieldType(t as string | undefined)).toBe(false);
  });
});

describe("binding sources exclude template-only fields", () => {
  const field = (id: string, type: CollectionField["type"], key: string | null = null): CollectionField =>
    ({ id, name: id, key, type, collection_id: "c1", order: 0, hidden: false, fillable: true, default: null, data: {}, reference_collection_id: null }) as unknown as CollectionField;
  const fields = [field("n", "text", "name"), field("o", "answer_options", "options"), field("d", "number")];

  it("bindableFields / isBindableFieldType", () => {
    expect(isBindableFieldType("answer_options")).toBe(false);
    expect(isBindableFieldType("text")).toBe(true);
    expect(isBindableFieldType("multi_reference")).toBe(true); // handled by its own existing rule
    expect(bindableFields(fields).map((f) => f.id)).toEqual(["n", "d"]);
    expect(bindableFields([])).toEqual([]);
  });

  it("buildFieldGroups never offers the JSON options field as a source (collection layer or dynamic page)", () => {
    const collections = [{ id: "c1", name: "Quiz" }] as never;
    const viaLayer = buildFieldGroups({
      parentCollectionLayers: [{ layerId: "layer-1", collectionId: "c1" }],
      fieldsByCollectionId: { c1: fields },
      collections,
    } as never);
    const viaPage = buildFieldGroups({
      parentCollectionLayers: [],
      page: { is_dynamic: true, settings: { cms: { collection_id: "c1" } } },
      fieldsByCollectionId: { c1: fields },
      collections,
    } as never);
    for (const groups of [viaLayer, viaPage]) {
      const offered = (groups ?? []).flatMap((g) => g.fields.map((f) => f.id));
      expect(offered).toEqual(expect.arrayContaining(["n", "d"]));
      expect(offered).not.toContain("o");
    }
  });
});

describe("asset discovery inside answer options", () => {
  const f = (type: CollectionField["type"], id = "fld") => ({ id, type }) as unknown as CollectionField;
  const discover = (type: CollectionField["type"], value: string) =>
    collectReferencedAssetIds({ json: [], fields: { c: [f(type)] }, items: { c: [{ values: { fld: value } }] } });

  it("finds option images by the shared asset_id key", () => {
    expect(discover("answer_options", JSON.stringify([{ id: "opt_a", title: "A", score: 1, image: { asset_id: ASSET } }]))).toEqual([ASSET]);
  });

  it("is safe on malformed / non-array / empty values", () => {
    for (const v of ["", "{", "{}", "not json", "5", "[1,2]", "null"]) expect(discover("answer_options", v)).toEqual([]);
  });

  it("does not scan unrelated JSON-looking text fields", () => {
    expect(discover("text", JSON.stringify([{ image: { asset_id: ASSET } }]))).toEqual([]);
  });
});
