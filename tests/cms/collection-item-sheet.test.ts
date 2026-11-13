// @vitest-environment jsdom
/**
 * Workflows 2 & 3 — the REAL CollectionItemSheet (create + edit) with the REAL
 * stores. Mocked: server-action adapters, toasts, and the heavy field widgets
 * that aren't exercised here (rich text, asset cards, reference picker…).
 */
import "../file-manager/jsdom-polyfills";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { read, write, toast } = vi.hoisted(() => ({
  read: {
    getItems: vi.fn(), searchItems: vi.fn(), getFields: vi.fn(), getItemById: vi.fn(),
    getItemSlugs: vi.fn(), getAllFields: vi.fn(), getReferencedItemsBatch: vi.fn(), refresh: vi.fn(),
  },
  write: {
    createItem: vi.fn(), updateItem: vi.fn(), duplicateItem: vi.fn(), deleteItems: vi.fn(), reorderItems: vi.fn(),
  },
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}));

vi.mock("@/lib/auth/auth", () => ({ auth: {}, getServerSession: vi.fn() }));
vi.mock("@/lib/editor/editor-read-api", () => ({
  collectionsReadApi: read,
  assetsReadApi: { fetchPage: vi.fn(), getByIds: vi.fn(), getFolders: vi.fn() },
  pagesReadApi: { getLayers: vi.fn() },
}));
vi.mock("@/lib/editor/editor-collection-write-api", () => ({ collectionsWriteApi: write }));
vi.mock("@/lib/editor/editor-asset-write-api", () => ({ assetsWriteApi: {}, assetFoldersApi: {}, assetsApi: {} }));
vi.mock("@/lib/assets/uploadthing-client", () => ({ useUploadThing: () => ({ startUpload: vi.fn(), isUploading: false }) }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/app/(main)/campaign/[campaignId]/edit/_components/RichTextEditor", () => ({ default: () => null }));
vi.mock("@/app/(main)/campaign/[campaignId]/edit/_components/RichTextEditorSheet", () => ({ default: () => null }));
vi.mock("@/app/(main)/campaign/[campaignId]/edit/_components/ReferenceFieldCombobox", () => ({ default: () => null }));
vi.mock("@/app/(main)/campaign/[campaignId]/edit/_components/ColorFieldInput", () => ({ default: () => null }));
vi.mock("@/app/(main)/campaign/[campaignId]/edit/_components/AssetFieldCard", () => ({ default: () => null, SortableAssetFieldCard: () => null }));
vi.mock("@/app/(main)/campaign/[campaignId]/edit/_components/CMS/CollectionLinkFieldInput", () => ({ default: () => null }));

import CollectionItemSheet from "@/app/(main)/campaign/[campaignId]/edit/_components/CMS/CollectionItemSheet";
import { useCollectionsStore } from "@/stores/editor/useCollectionsStore";
import type { Collection, CollectionField, CollectionItemWithValues } from "@/types/funnel";

const C1 = "11111111-1111-4111-8111-111111111111";
const NAME = "f-name";
const SLUG = "f-slug";

const collection: Collection = {
  id: C1, name: "Posts", uuid: C1, order: 0, sorting: null, created_at: "", updated_at: "", deleted_at: null,
  is_published: false, draft_items_count: 0, has_published_version: false,
};
const field = (id: string, key: string, name: string): CollectionField =>
  ({ id, collection_id: C1, name, key, type: "text", default: null, fillable: true, order: 0, hidden: false, reference_collection_id: null, data: {} }) as unknown as CollectionField;
const item = (id: string, name: string, slug: string): CollectionItemWithValues =>
  ({ id, collection_id: C1, manual_order: 0, values: { [NAME]: name, [SLUG]: slug }, is_published: false, is_publishable: true, content_hash: null }) as unknown as CollectionItemWithValues;

const ok = <T>(data: T) => Promise.resolve({ data });
const fail = (error: string) => Promise.resolve({ error });

function seed(items: CollectionItemWithValues[] = []) {
  useCollectionsStore.setState({
    collections: [collection],
    fields: { [C1]: [field(NAME, "name", "Name"), field(SLUG, "slug", "Slug")] },
    items: { [C1]: items },
    itemsTotalCount: { [C1]: items.length },
    lastItemsQuery: { [C1]: { page: 1, limit: 25 } },
    selectedCollectionId: C1,
  });
}

function mount(props: { itemId?: string | null } = {}) {
  const onOpenChange = vi.fn();
  const onSuccess = vi.fn();
  const onDeleteItem = vi.fn();
  render(h(CollectionItemSheet, { open: true, onOpenChange, collectionId: C1, itemId: props.itemId ?? null, onSuccess, onDeleteItem }));
  return { onOpenChange, onSuccess, onDeleteItem };
}
const inputs = () => screen.getAllByRole("textbox") as HTMLInputElement[];
/** Types a name and waits for the slug auto-fill, like a real user would. */
async function typeName(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(inputs()[0], text);
  await waitFor(() => expect(inputs()[1].value).not.toBe(""));
}
const submitButton = () => screen.getAllByRole("button").find((b) => b.getAttribute("form") === "collection-item-form")! as HTMLButtonElement;

beforeEach(() => {
  for (const fn of [...Object.values(read), ...Object.values(write), toast, toast.error, toast.success]) fn.mockReset();
  read.getItems.mockResolvedValue({ data: { items: [], total: 0 } });
  useCollectionsStore.getState().reset();
  seed([item("i1", "Existing", "existing")]);
});
afterEach(() => cleanup());

describe("create mode (workflow 3)", () => {
  it("titles itself 'Create' and offers a Create button", async () => {
    mount();
    expect(await screen.findByText(/Create Posts Item/)).toBeTruthy();
    expect(submitButton().textContent).toBe("Create");
  });

  it("auto-fills the slug from the name, then persists via the server and closes", async () => {
    write.createItem.mockReturnValue(ok(item("new", "Hello World", "hello-world")));
    const { onSuccess } = mount();
    const user = userEvent.setup();
    await user.type(inputs()[0], "Hello World");
    await waitFor(() => expect(inputs()[1].value).toBe("hello-world"));

    fireEvent.click(submitButton());
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(write.createItem).toHaveBeenCalledTimes(1);
    expect(write.createItem).toHaveBeenCalledWith(C1, { [NAME]: "Hello World", [SLUG]: "hello-world" });
    expect(write.updateItem).not.toHaveBeenCalled();
  });

  it("validates required name and slug on the client without a network call", async () => {
    const { onSuccess } = mount();
    fireEvent.click(submitButton());
    expect(await screen.findByText("Name is required")).toBeTruthy();
    expect(screen.getByText("Slug is required")).toBeTruthy();
    expect(write.createItem).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("rejects a slug already used in the loaded items before calling the server", async () => {
    const { onSuccess } = mount();
    const user = userEvent.setup();
    await typeName(user, "Another");
    await user.clear(inputs()[1]);
    await user.type(inputs()[1], "existing");
    fireEvent.click(submitButton());
    expect(await screen.findByText("This slug already exists in this collection")).toBeTruthy();
    expect(write.createItem).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("a server rejection keeps the sheet open WITH the user's input and explains why", async () => {
    write.createItem.mockReturnValue(fail("This slug already exists in this collection."));
    const { onSuccess, onOpenChange } = mount();
    const user = userEvent.setup();
    await typeName(user, "Typed Title");
    fireEvent.click(submitButton());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to create item", { description: "This slug already exists in this collection." }));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(inputs()[0].value).toBe("Typed Title"); // nothing lost
    expect(screen.getByText("This slug already exists in this collection.")).toBeTruthy(); // surfaced on the slug field
    expect(submitButton().disabled).toBe(false); // can retry
  });

  it("shows 'Saving…' and ignores a second submit while the request is in flight", async () => {
    let finish: (v: unknown) => void = () => {};
    write.createItem.mockImplementation(() => new Promise((r) => (finish = r)));
    const { onSuccess } = mount();
    const user = userEvent.setup();
    await typeName(user, "Slow");
    fireEvent.click(submitButton());
    await waitFor(() => expect(submitButton().textContent).toBe("Saving..."));
    expect(submitButton().disabled).toBe(true);
    fireEvent.click(submitButton());
    fireEvent.submit(document.getElementById("collection-item-form")!);
    expect(write.createItem).toHaveBeenCalledTimes(1);
    await act(async () => finish({ data: item("n", "Slow", "slow") }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });
});

describe("edit mode (workflow 2)", () => {
  it("opens an item that is already loaded, pre-populated, titled 'Edit'", async () => {
    mount({ itemId: "i1" });
    expect(await screen.findByText(/Edit Posts Item/)).toBeTruthy();
    await waitFor(() => expect(inputs()[0].value).toBe("Existing"));
    expect(inputs()[1].value).toBe("existing");
    expect(submitButton().textContent).toBe("Save");
    expect(read.getItemById).not.toHaveBeenCalled();
  });

  it("saves through updateItem for THAT item and collection — never a create", async () => {
    write.updateItem.mockReturnValue(ok(item("i1", "Renamed", "existing")));
    const { onSuccess } = mount({ itemId: "i1" });
    const user = userEvent.setup();
    await waitFor(() => expect(inputs()[0].value).toBe("Existing"));
    await user.clear(inputs()[0]);
    await user.type(inputs()[0], "Renamed");
    fireEvent.click(submitButton());
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(write.updateItem).toHaveBeenCalledWith(C1, "i1", { [NAME]: "Renamed", [SLUG]: "existing" });
    expect(write.createItem).not.toHaveBeenCalled();
    expect(useCollectionsStore.getState().items[C1][0].values[NAME]).toBe("Renamed"); // store holds the persisted item
  });

  it("allows saving an item with its own slug (uniqueness ignores itself)", async () => {
    write.updateItem.mockReturnValue(ok(item("i1", "Existing", "existing")));
    const { onSuccess } = mount({ itemId: "i1" });
    await waitFor(() => expect(inputs()[0].value).toBe("Existing"));
    fireEvent.click(submitButton());
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it("a failed save keeps the sheet open and reports the server's reason", async () => {
    write.updateItem.mockReturnValue(fail("Name is required."));
    const { onSuccess } = mount({ itemId: "i1" });
    const user = userEvent.setup();
    await waitFor(() => expect(inputs()[0].value).toBe("Existing"));
    await user.type(inputs()[0], "!");
    fireEvent.click(submitButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to save item", { description: "Name is required." }));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(inputs()[0].value).toBe("Existing!");
  });

  it("deep link to an item NOT in the loaded page fetches it by id, and can't be saved until it arrives", async () => {
    let arrive: (v: unknown) => void = () => {};
    read.getItemById.mockImplementation(() => new Promise((r) => (arrive = r)));
    mount({ itemId: "far-away" });
    await waitFor(() => expect(read.getItemById).toHaveBeenCalledWith(C1, "far-away"));
    expect(submitButton().disabled).toBe(true);
    expect(submitButton().textContent).toBe("Loading...");
    // Even with a fully valid form, a forced submit while the item is still
    // loading must neither create a duplicate nor save blind.
    const user = userEvent.setup();
    await typeName(user, "Typed while loading");
    fireEvent.submit(document.getElementById("collection-item-form")!);
    await new Promise((r) => setTimeout(r, 50));
    expect(write.createItem).not.toHaveBeenCalled();
    expect(write.updateItem).not.toHaveBeenCalled();

    await act(async () => arrive({ data: item("far-away", "From Page 9", "from-page-9") }));
    await waitFor(() => expect(inputs()[0].value).toBe("From Page 9"));
    expect(submitButton().disabled).toBe(false);
  });

  it("an id that doesn't exist in this collection closes the sheet with an explanation", async () => {
    read.getItemById.mockReturnValue(fail("Item not found."));
    const { onOpenChange } = mount({ itemId: "ghost" });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Item not found", expect.anything()));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(write.createItem).not.toHaveBeenCalled();
  });

  it("delete is delegated to the host with the right id", async () => {
    const { onDeleteItem } = mount({ itemId: "i1" });
    await screen.findByText(/Edit Posts Item/);
    const user = userEvent.setup();
    const menuTrigger = screen.getAllByRole("button").find((b) => b.getAttribute("aria-haspopup") === "menu")!;
    await user.click(menuTrigger);
    await user.click(await screen.findByText("Delete"));
    expect(onDeleteItem).toHaveBeenCalledWith("i1");
  });

  it("create mode has no delete menu", async () => {
    mount();
    await screen.findByText(/Create Posts Item/);
    expect(screen.queryByText("Delete")).toBeNull();
    expect(screen.getAllByRole("button").some((b) => b.getAttribute("aria-haspopup") === "menu")).toBe(false);
  });
});

describe("excluded features are gone from the sheet", () => {
  it("shows no status pill, locale or Airtable affordances", async () => {
    mount({ itemId: "i1" });
    await screen.findByText(/Edit Posts Item/);
    for (const text of [/draft/i, /staged/i, /published/i, /airtable/i, /translat/i, /locale/i]) {
      expect(screen.queryByText(text)).toBeNull();
    }
  });
});
