import { describe, expect, it } from "vitest";
import {
  buildAssetFolderPath,
  flattenAssetFolderTree,
  getFolderAndDescendantIds,
  hasChildFolders,
  isDescendantAssetFolder,
} from "@/lib/assets/asset-folder-utils";
import type { AssetFolder } from "@/types/funnel";

const f = (id: string, parent: string | null, name = id, order = 0): AssetFolder => ({
  id, asset_folder_id: parent, name, depth: 0, order, is_published: false,
  created_at: "", updated_at: "", deleted_at: null,
});

const TREE = [
  f("b", null, "Beta", 1), f("a", null, "Alpha", 0),
  f("a1", "a", "A-one", 0), f("a2", "a", "A-two", 1), f("a1x", "a1", "Deep"),
];

describe("flattenAssetFolderTree", () => {
  it("lists regular folders beneath the root in sibling order, depth-first", () => {
    const flat = flattenAssetFolderTree(TREE, null, new Set(), 1);
    expect(flat.map((n) => [n.id, n.depth])).toEqual([
      ["a", 1], ["a1", 2], ["a1x", 3], ["a2", 2], ["b", 1],
    ]);
    expect(flat.map((n) => n.index)).toEqual([0, 1, 2, 3, 4]);
    expect(flat[1].parentId).toBe("a");
  });

  it("omits the children of collapsed folders", () => {
    const flat = flattenAssetFolderTree(TREE, null, new Set(["a"]), 1);
    expect(flat.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("falls back to name for equal order (stable result)", () => {
    const flat = flattenAssetFolderTree([f("z", null, "Zed"), f("y", null, "Yak")]);
    expect(flat.map((n) => n.id)).toEqual(["y", "z"]);
  });

  it("does not render orphans whose parent no longer exists (stale reference)", () => {
    const flat = flattenAssetFolderTree([f("a", null), f("orphan", "deleted-parent")]);
    expect(flat.map((n) => n.id)).toEqual(["a"]);
  });

  it("terminates on corrupt cyclic data", () => {
    const flat = flattenAssetFolderTree([f("x", "y"), f("y", "x")]);
    expect(flat).toEqual([]);
  });

  it("is empty with no folders (root alone is shown by the UI)", () => {
    expect(flattenAssetFolderTree([], null, new Set(), 1)).toEqual([]);
  });
});

describe("tree queries", () => {
  it("hasChildFolders treats 'root' as the virtual root", () => {
    expect(hasChildFolders("root", TREE)).toBe(true);
    expect(hasChildFolders("root", [])).toBe(false);
    expect(hasChildFolders("a", TREE)).toBe(true);
    expect(hasChildFolders("b", TREE)).toBe(false);
  });

  it("isDescendantAssetFolder", () => {
    expect(isDescendantAssetFolder("a1x", "a", TREE)).toBe(true);
    expect(isDescendantAssetFolder("a", "a", TREE)).toBe(false);
    expect(isDescendantAssetFolder("b", "a", TREE)).toBe(false);
  });

  it("getFolderAndDescendantIds", () => {
    expect(getFolderAndDescendantIds("a", TREE).sort()).toEqual(["a", "a1", "a1x", "a2"]);
    expect(getFolderAndDescendantIds("b", TREE)).toEqual(["b"]);
  });

  it("buildAssetFolderPath", () => {
    expect(buildAssetFolderPath("a1x", TREE)).toEqual(["Alpha", "A-one", "Deep"]);
    expect(buildAssetFolderPath(null, TREE)).toEqual([]);
  });
});
