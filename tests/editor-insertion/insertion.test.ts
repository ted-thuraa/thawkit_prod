// Regression tests for Element Library insertion (containers, columns, rows,
// grids, ... into a section). Runs the REAL usePagesStore.addLayerFromTemplate;
// only network/server-action modules are stubbed.
//
// Run:  npm i -D vitest && npx vitest run --config tests/vitest.config.ts

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/actions/editor/editor-actions", () => ({
  createPageAction: vi.fn(),
  deletePageAction: vi.fn(),
  duplicatePageAction: vi.fn(),
  savePageLayersAction: vi.fn(),
}));
vi.mock("@/stores/editor/useComponentsStore", () => ({
  triggerThumbnailGeneration: vi.fn(),
  useComponentsStore: { getState: () => ({}) },
}));
vi.mock("@/stores/editor/useEditorBootstrapStore", () => ({
  useEditorBootstrapStore: { getState: () => ({ campaignId: "c1" }) },
}));
vi.mock("@/lib/editor/editor-read-api", () => ({ pagesReadApi: {} }));

import type { Layer } from "@/types/funnel";
import { usePagesStore } from "@/stores/editor/usePagesStore";
import { elementCategories } from "@/lib/editor/element-catalog";
import { buildLayerFromTemplate } from "@/lib/editor/insert-template";
import { findLayerById, findParentAndIndex } from "@/lib/editor/layer-tree-utils";
import { getLayerFromTemplate } from "@/lib/templates/blocks";

const PAGE = "p1";
const ALL_KEYS = Object.values(elementCategories).flat();

const body = (children: Layer[]): Layer[] => [
  { id: "body", name: "body", classes: "", children } as Layer,
];
const section = (children: Layer[] = []): Layer =>
  ({ id: "sec1", name: "section", classes: "", children }) as Layer;

function seed(layers: Layer[] = body([section()])) {
  usePagesStore
    .getState()
    .hydrateFromBootstrap(
      [{ id: PAGE } as never],
      [{ page_id: PAGE, layers } as never],
    );
}
const tree = () => usePagesStore.getState().pagesByPageId[PAGE].layers;
const add = (selected: string | null, key: string, pos?: never) =>
  usePagesStore.getState().addLayerFromTemplate(PAGE, selected, key, pos);

const walk = (l: Layer, f: (n: Layer) => void) => {
  f(l);
  l.children?.forEach((c) => walk(c, f));
};
const idsOf = (l: Layer) => {
  const out: string[] = [];
  walk(l, (n) => out.push(n.id));
  return out;
};
const settingsIds = (layers: Layer[]) => {
  const out: string[] = [];
  layers.forEach((l) => walk(l, (n) => n.settings?.id && out.push(n.settings.id)));
  return out;
};

beforeEach(() => seed());

describe("catalog ↔ registry (drift guard)", () => {
  it.each(ALL_KEYS)("catalog key %s resolves in the block registry", (key) => {
    expect(getLayerFromTemplate(key)).not.toBeNull();
  });
});

describe("insert every catalog element into a selected section", () => {
  it.each(ALL_KEYS.filter((k) => k !== "section"))("%s", (key) => {
    const before = tree();
    const result = add("sec1", key);

    expect(result).not.toBeNull();
    expect(tree()).not.toBe(before);
    const sec = findLayerById(tree(), "sec1")!;
    expect(sec.children).toHaveLength(1);

    const inserted = findLayerById(tree(), result!.newLayerId)!;
    expect(inserted).toBeDefined();
    const ids = idsOf(inserted);
    expect(new Set(ids).size).toBe(ids.length); // unique nested ids
    expect(result!.parentToExpand).toBe("sec1");
  });

  it("section always goes to the body, even with a section selected", () => {
    const result = add("sec1", "section")!;
    const loc = findParentAndIndex(tree(), result.newLayerId)!;
    expect(loc.parent?.id).toBe("body");
    expect(findLayerById(tree(), "sec1")!.children).toHaveLength(0);
  });
});

describe("layout templates keep their nested structure", () => {
  it.each([
    ["columns", 3],
    ["rows", 3],
    ["grid", 5],
  ])("%s inserts %i nodes", (key, count) => {
    const r = add("sec1", key)!;
    expect(idsOf(findLayerById(tree(), r.newLayerId)!)).toHaveLength(count);
  });

  it("can nest a block inside an inserted container", () => {
    const c = add("sec1", "container")!;
    const d = add(c.newLayerId, "div")!;
    expect(findParentAndIndex(tree(), d.newLayerId)!.parent?.id).toBe(c.newLayerId);
  });
});

describe("placement rules", () => {
  it("inserts as a sibling when the selected layer is a leaf", () => {
    const img = add("sec1", "image")!;
    const r = add(img.newLayerId, "div")!;
    expect(findParentAndIndex(tree(), r.newLayerId)!.parent?.id).toBe("sec1");
  });

  it("honours insertPosition above/below a sibling", () => {
    const a = add("sec1", "div")!;
    const b = add("sec1", "div")!;
    const above = add("sec1", "hr", { siblingId: b.newLayerId, position: "above" } as never)!;
    const below = add("sec1", "hr", { siblingId: a.newLayerId, position: "below" } as never)!;
    const order = findLayerById(tree(), "sec1")!.children!.map((c) => c.id);
    expect(order).toEqual([a.newLayerId, below.newLayerId, above.newLayerId, b.newLayerId]);
  });

  it("selecting a form nests a new field inside it", () => {
    const f = add("sec1", "form")!;
    const r = add(f.newLayerId, "input")!;
    expect(findParentAndIndex(tree(), r.newLayerId)!.parent?.id).toBe(f.newLayerId);
  });

  it("a field selected inside a form gets a sibling field, not a nested one", () => {
    const f = add("sec1", "form")!;
    const first = add(f.newLayerId, "input")!;
    const second = add(first.newLayerId, "input")!;
    expect(findParentAndIndex(tree(), second.newLayerId)!.parent?.id).toBe(f.newLayerId);
  });
});

describe("unique ids", () => {
  it("keeps settings.id unique when a form is inserted twice", () => {
    add("sec1", "form");
    add("sec1", "form");
    const ids = settingsIds(tree());
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("re-points label `for` at the renamed control", () => {
    add("sec1", "input");
    const r = add("sec1", "input")!;
    const inserted = findLayerById(tree(), r.newLayerId)!;
    const controlIds = new Set<string>();
    const forRefs: string[] = [];
    walk(inserted, (n) => {
      if (n.settings?.id) controlIds.add(n.settings.id);
      if (typeof n.attributes?.for === "string") forRefs.push(n.attributes.for);
    });
    forRefs.forEach((ref) => expect(controlIds.has(ref)).toBe(true));
  });

  it("buildLayerFromTemplate never mutates the page tree it reads", () => {
    const layers = tree();
    const snapshot = JSON.stringify(layers);
    buildLayerFromTemplate("form", layers);
    expect(JSON.stringify(layers)).toBe(snapshot);
  });
});

describe("failure is explicit and leaves state untouched", () => {
  it("unknown template: returns null, logs, does not change the tree", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = tree();
    expect(add("sec1", "definitely-not-a-template")).toBeNull();
    expect(tree()).toBe(before);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("not found"));
    spy.mockRestore();
  });

  it("unknown page: returns null and logs", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(usePagesStore.getState().addLayerFromTemplate("nope", "sec1", "div")).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
