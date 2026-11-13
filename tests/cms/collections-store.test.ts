/**
 * useCollectionsStore persistence contract: every mutation goes through the
 * server-action facade, writes are server-confirmed (failures reject with the
 * server's message and leave state untouched), and the regressions found in the
 * Ycode port stay fixed (setCmsSection wiping data, stale responses
 * overwriting newer ones, leftover status/publish API).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { read, write } = vi.hoisted(() => ({
  read: {
    getItems: vi.fn(), searchItems: vi.fn(), getFields: vi.fn(), getItemById: vi.fn(),
    getItemSlugs: vi.fn(), getAllFields: vi.fn(), getReferencedItemsBatch: vi.fn(), refresh: vi.fn(),
  },
  write: {
    create: vi.fn(), createSample: vi.fn(), update: vi.fn(), delete: vi.fn(), reorder: vi.fn(),
    createField: vi.fn(), updateField: vi.fn(), deleteField: vi.fn(), reorderFields: vi.fn(),
    createItem: vi.fn(), updateItem: vi.fn(), duplicateItem: vi.fn(), deleteItems: vi.fn(), reorderItems: vi.fn(),
  },
}));

vi.mock("@/lib/auth/auth", () => ({ auth: {}, getServerSession: vi.fn() }));
vi.mock("@/lib/editor/editor-read-api", () => ({
  collectionsReadApi: read,
  assetsReadApi: { fetchPage: vi.fn(), getByIds: vi.fn(), getFolders: vi.fn() },
  pagesReadApi: { getLayers: vi.fn() },
}));
vi.mock("@/lib/editor/editor-collection-write-api", () => ({ collectionsWriteApi: write }));
vi.mock("@/lib/editor/editor-asset-write-api", () => ({ assetsWriteApi: {}, assetFoldersApi: {}, assetsApi: {} }));

import { useCollectionsStore } from "@/stores/editor/useCollectionsStore";
import { usePagesStore } from "@/stores/editor/usePagesStore";
import type { Collection, CollectionField, CollectionItemWithValues } from "@/types/funnel";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";

const col = (id: string, order = 0, extra: Partial<Collection> = {}): Collection => ({
  id, name: id.slice(0, 4), uuid: id, order, sorting: null, created_at: "", updated_at: "", deleted_at: null,
  is_published: false, draft_items_count: 0, has_published_version: false, ...extra,
});
const fld = (id: string, collectionId: string, key: string | null = null): CollectionField =>
  ({ id, collection_id: collectionId, name: id, key, type: "text", order: 0, hidden: false, fillable: true, data: {} }) as unknown as CollectionField;
const itm = (id: string, collectionId: string, values: Record<string, string> = {}): CollectionItemWithValues =>
  ({ id, collection_id: collectionId, manual_order: 0, values, is_published: false, is_publishable: true, content_hash: null }) as unknown as CollectionItemWithValues;

const store = () => useCollectionsStore.getState();
const ok = <T>(data: T) => Promise.resolve({ data });
const fail = (error: string) => Promise.resolve({ error });

beforeEach(() => {
  for (const fn of [...Object.values(read), ...Object.values(write)]) fn.mockReset();
  read.getItems.mockResolvedValue({ data: { items: [], total: 0 } });
  read.getFields.mockResolvedValue({ data: [] });
  store().reset();
  useCollectionsStore.setState({
    collections: [col(C1, 0), col(C2, 1)],
    fields: { [C1]: [fld("f1", C1, "name")] },
    items: { [C1]: [itm("i1", C1, { f1: "One" }), itm("i2", C1, { f1: "Two" })] },
    itemsTotalCount: { [C1]: 2 },
    lastItemsQuery: { [C1]: { page: 1, limit: 25 } },
    selectedCollectionId: C1,
  });
});

describe("regressions from the Ycode port", () => {
  it("switching the CMS section keeps collections, fields and items", () => {
    store().setCmsSection("globals");
    store().setCmsSection("collections");
    expect(store().collections).toHaveLength(2);
    expect(store().fields[C1]).toHaveLength(1);
    expect(store().items[C1]).toHaveLength(2);
    expect(store().selectedCollectionId).toBe(C1);
  });

  it("no longer exposes the per-item status / publish API", () => {
    const s = store() as unknown as Record<string, unknown>;
    for (const name of ["setItemStatus", "setItemPublishable", "loadPublishedItems"]) {
      expect(s[name]).toBeUndefined();
    }
  });

  it("a slow older items response cannot overwrite a newer one", async () => {
    let releaseOld: (v: unknown) => void = () => {};
    read.getItems
      .mockImplementationOnce(() => new Promise((r) => (releaseOld = r)))
      .mockImplementationOnce(() => ok({ items: [itm("new", C1)], total: 1 }));
    const first = store().loadItems(C1, 2, 25);
    await store().loadItems(C1, 3, 25);
    releaseOld({ data: { items: [itm("STALE", C1)], total: 99 } });
    await first;
    expect(store().items[C1].map((i) => i.id)).toEqual(["new"]);
    expect(store().itemsTotalCount[C1]).toBe(1);
    expect(store().lastItemsQuery[C1]).toMatchObject({ page: 3 });
  });
});

describe("collections", () => {
  it("createCollection stores the server-built collection AND its fields (no client field fan-out)", async () => {
    const created = col("33333333-3333-4333-8333-333333333333", 2, { name: "New" });
    const fields = [fld("n", created.id, "name"), fld("s", created.id, "slug")];
    write.create.mockReturnValue(ok({ collection: created, fields }));
    const result = await store().createCollection({ name: "New" });
    expect(result.id).toBe(created.id);
    expect(write.create).toHaveBeenCalledWith("New");
    expect(write.createField).not.toHaveBeenCalled();
    expect(store().collections.map((c) => c.id)).toContain(created.id);
    expect(store().fields[created.id]).toEqual(fields);
    expect(store().items[created.id]).toEqual([]);
  });

  it("createCollection surfaces the server error and changes nothing", async () => {
    write.create.mockReturnValue(fail("Failed to create the collection."));
    await expect(store().createCollection({ name: "X" })).rejects.toThrow("Failed to create the collection.");
    expect(store().collections).toHaveLength(2);
    expect(store().error).toBe("Failed to create the collection.");
  });

  it("createSampleCollection hydrates fields and items from the server", async () => {
    const created = col("44444444-4444-4444-8444-444444444444", 2);
    write.createSample.mockReturnValue(ok({ collection: created, fields: [fld("a", created.id)], items: [itm("x", created.id)] }));
    await store().createSampleCollection("blog-posts");
    expect(write.createSample).toHaveBeenCalledWith("blog-posts");
    expect(store().items[created.id]).toHaveLength(1);
    expect(store().itemsTotalCount[created.id]).toBe(1);
  });

  it("deleteCollection removes it everywhere, clears the selection and resets page bindings", async () => {
    write.delete.mockReturnValue(ok({ id: C1 }));
    const cleanup = vi.spyOn(usePagesStore.getState(), "cleanupDeletedCollection");
    await store().deleteCollection(C1);
    expect(store().collections.map((c) => c.id)).toEqual([C2]);
    expect(store().fields[C1]).toBeUndefined();
    expect(store().items[C1]).toBeUndefined();
    expect(store().itemsTotalCount[C1]).toBeUndefined();
    expect(store().lastItemsQuery[C1]).toBeUndefined();
    expect(store().selectedCollectionId).toBeNull();
    expect(cleanup).toHaveBeenCalledWith(C1);
  });

  it("deleteCollection refused by the server (in use) leaves everything in place", async () => {
    write.delete.mockReturnValue(fail("This collection is still in use. Remove its usages before deleting it."));
    await expect(store().deleteCollection(C1)).rejects.toThrow(/still in use/);
    expect(store().collections).toHaveLength(2);
    expect(store().items[C1]).toHaveLength(2);
    expect(store().selectedCollectionId).toBe(C1);
  });

  it("reorderCollections is optimistic and rolls back if the server rejects", async () => {
    write.reorder.mockReturnValue(fail("nope"));
    const before = store().collections.map((c) => c.id);
    const p = store().reorderCollections([C2, C1]);
    expect(store().collections.map((c) => c.id)).toEqual([C2, C1]); // applied immediately
    await expect(p).rejects.toThrow("nope");
    expect(store().collections.map((c) => c.id)).toEqual(before);
  });

  it("updateCollection applies the server's version", async () => {
    write.update.mockReturnValue(ok(col(C1, 0, { name: "Renamed" })));
    await store().updateCollection(C1, { name: "Renamed" });
    expect(store().collections.find((c) => c.id === C1)!.name).toBe("Renamed");
  });
});

describe("fields", () => {
  it("createField reloads the collection's fields (the server shifts the trailing built-ins)", async () => {
    const created = fld("custom", C1);
    write.createField.mockReturnValue(ok(created));
    read.getFields.mockReturnValue(ok([fld("f1", C1, "name"), created, fld("d", C1, "created_at")]));
    await store().createField(C1, { name: "Body", type: "text", order: 1, fillable: true, key: null, hidden: false } as never);
    expect(store().fields[C1].map((f) => f.id)).toEqual(["f1", "custom", "d"]);
  });

  it("createField sends only what the server accepts (no key / order / fillable)", async () => {
    write.createField.mockReturnValue(ok(fld("c", C1)));
    await store().createField(C1, { name: "Body", type: "text", order: 7, fillable: false, key: "name", hidden: true } as never);
    expect(write.createField).toHaveBeenCalledWith(C1, {
      name: "Body", type: "text", default: null, reference_collection_id: null, data: undefined,
    });
  });

  it("deleteField is server-gated and resets a sort on the deleted field", async () => {
    useCollectionsStore.setState({ collections: [col(C1, 0, { sorting: { field: "f1", direction: "asc" } }), col(C2, 1)] });
    write.deleteField.mockReturnValue(fail("This field is still in use. Remove its usages before deleting it."));
    await expect(store().deleteField(C1, "f1")).rejects.toThrow(/still in use/);
    expect(store().fields[C1]).toHaveLength(1);
    expect(store().collections[0].sorting).toEqual({ field: "f1", direction: "asc" });

    write.deleteField.mockReturnValue(ok({ id: "f1" }));
    await store().deleteField(C1, "f1");
    expect(store().fields[C1]).toHaveLength(0);
    expect(store().collections[0].sorting).toBeNull();
  });

  it("reorderFields rolls back when the server rejects", async () => {
    useCollectionsStore.setState({ fields: { [C1]: [fld("a", C1), fld("b", C1)] } });
    write.reorderFields.mockReturnValue(fail("nope"));
    await expect(store().reorderFields(C1, ["b", "a"])).rejects.toThrow("nope");
    expect(store().fields[C1].map((f) => f.id)).toEqual(["a", "b"]);
  });
});

describe("items — server-confirmed writes", () => {
  it("createItem forwards raw form values and reloads the current query", async () => {
    const created = itm("new", C1, { f1: "Hello" });
    write.createItem.mockReturnValue(ok(created));
    read.getItems.mockReturnValue(ok({ items: [...store().items[C1], created], total: 3 }));
    const values = { f1: "Hello", rich: { type: "doc" }, multi: ["a", "b"], flag: true };
    const result = await store().createItem(C1, values);
    expect(result.id).toBe("new");
    expect(write.createItem).toHaveBeenCalledWith(C1, values); // objects / arrays untouched — the server serializes
    expect(store().items[C1].map((i) => i.id)).toContain("new");
    expect(store().itemsTotalCount[C1]).toBe(3);
  });

  it("createItem failure rejects with the server message and adds no phantom row", async () => {
    write.createItem.mockReturnValue(fail("This slug already exists in this collection."));
    await expect(store().createItem(C1, { f1: "x" })).rejects.toThrow("This slug already exists in this collection.");
    expect(store().items[C1]).toHaveLength(2);
    expect(store().itemsTotalCount[C1]).toBe(2);
    expect(read.getItems).not.toHaveBeenCalled();
  });

  it("updateItem swaps in the PERSISTED item and returns it", async () => {
    const saved = itm("i1", C1, { f1: "One (saved)" });
    write.updateItem.mockReturnValue(ok(saved));
    const result = await store().updateItem(C1, "i1", { f1: "One (saved)" });
    expect(result).toBe(saved);
    expect(store().items[C1].find((i) => i.id === "i1")).toBe(saved);
    expect(store().items[C1].find((i) => i.id === "i2")!.values.f1).toBe("Two"); // others untouched
  });

  it("updateItem failure rejects and leaves the row untouched", async () => {
    write.updateItem.mockReturnValue(fail("Name is required."));
    await expect(store().updateItem(C1, "i1", { f1: "" })).rejects.toThrow("Name is required.");
    expect(store().items[C1].find((i) => i.id === "i1")!.values.f1).toBe("One");
  });

  it("deleteItems removes rows and decrements the total by what the server deleted", async () => {
    write.deleteItems.mockReturnValue(ok({ deleted: 2 }));
    await store().deleteItems(C1, ["i1", "i2"]);
    expect(write.deleteItems).toHaveBeenCalledWith(C1, ["i1", "i2"]);
    expect(store().items[C1]).toEqual([]);
    expect(store().itemsTotalCount[C1]).toBe(0);
  });

  it("deleteItem failure keeps the rows and the count", async () => {
    write.deleteItems.mockReturnValue(fail("Failed to delete the item(s)."));
    await expect(store().deleteItem(C1, "i1")).rejects.toThrow();
    expect(store().items[C1]).toHaveLength(2);
    expect(store().itemsTotalCount[C1]).toBe(2);
  });

  it("duplicateItem reloads the table so the copy lands where the sort puts it", async () => {
    const copy = itm("copy", C1, { f1: "One (Copy)" });
    write.duplicateItem.mockReturnValue(ok(copy));
    read.getItems.mockReturnValue(ok({ items: [...store().items[C1], copy], total: 3 }));
    await store().duplicateItem(C1, "i1");
    expect(store().items[C1].map((i) => i.id)).toContain("copy");
  });

  it("reloadItemsFor re-runs a SEARCH query as a search, not a plain page", async () => {
    read.searchItems.mockReturnValue(ok({ items: [itm("hit", C1)], total: 1 }));
    await store().searchItems(C1, "one", 1, 25);
    read.searchItems.mockClear();
    await store().reloadItemsFor(C1);
    expect(read.searchItems).toHaveBeenCalledWith(C1, "one", expect.objectContaining({ page: 1, limit: 25 }));
  });
});
