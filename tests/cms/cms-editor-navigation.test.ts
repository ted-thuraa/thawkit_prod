// @vitest-environment jsdom
/**
 * Workflows 1–3 at the UI layer: the REAL CmsContentEditor + REAL
 * useCampaignEditorUrl + REAL zustand stores, driven by a tiny in-memory
 * router (push/replace update the URL and re-render consumers, like Next).
 * Mocked: server-action adapters (network edge), toasts, and the two heavy
 * dialogs (the item sheet / field dialog are replaced by probes that expose
 * the props the editor hands them).
 */
import "../file-manager/jsdom-polyfills";
import { createElement as h, useSyncExternalStore } from "react";
import { act, cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── In-memory router ─────────────────────────────────────────────────────────
const nav = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { url: "/campaign/camp_1/edit/cms", history: [] as Array<{ kind: string; url: string }> };
  const set = (kind: string, url: string) => {
    state.url = url;
    state.history.push({ kind, url });
    listeners.forEach((l) => l());
  };
  return {
    state,
    set,
    subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)),
    get: () => state.url,
  };
});

vi.mock("next/navigation", () => {
  const snapshot = () => nav.get();
  const useUrl = () => useSyncExternalStore(nav.subscribe, snapshot, snapshot);
  return {
    usePathname: () => new URL(useUrl(), "http://x").pathname,
    useSearchParams: () => new URL(useUrl(), "http://x").searchParams,
    useRouter: () => ({
      push: (u: string) => nav.set("push", u),
      replace: (u: string) => nav.set("replace", u),
      back: () => {},
      prefetch: () => {},
    }),
  };
});

// ── Network edges ────────────────────────────────────────────────────────────
const { read, write, toast, sheetProps } = vi.hoisted(() => ({
  read: {
    getItems: vi.fn(),
    searchItems: vi.fn(),
    getFields: vi.fn(),
    getItemById: vi.fn(),
    getItemSlugs: vi.fn(),
    getAllFields: vi.fn(),
    getReferencedItemsBatch: vi.fn(),
    refresh: vi.fn(),
  },
  write: { getFieldUsage: vi.fn(), getUsage: vi.fn() },
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
  sheetProps: { current: null as null | Record<string, unknown>, mounts: 0 },
}));

vi.mock("@/lib/auth/auth", () => ({ auth: {}, getServerSession: vi.fn() }));
vi.mock("@/lib/editor/editor-read-api", () => ({
  collectionsReadApi: new Proxy(read, { get: (t, k) => (t as never)[k] }),
  assetsReadApi: { fetchPage: vi.fn(), getByIds: vi.fn(), getFolders: vi.fn() },
  pagesReadApi: { getLayers: vi.fn() },
  callEditorAction: vi.fn(),
}));
vi.mock("@/lib/editor/editor-collection-write-api", () => ({
  collectionsWriteApi: new Proxy(write, { get: (t, k) => (t as never)[k] ?? vi.fn() }),
}));
vi.mock("@/lib/editor/editor-asset-write-api", () => ({
  assetsWriteApi: {},
  assetFoldersApi: {},
  assetsApi: {},
}));
vi.mock("@/lib/assets/uploadthing-client", () => ({
  useUploadThing: () => ({ startUpload: vi.fn(), isUploading: false }),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/app/(main)/campaign/[campaignId]/edit/_components/CMS/CollectionItemSheet", () => ({
  default: (props: Record<string, unknown>) => {
    sheetProps.current = props;
    return h("div", {
      "data-testid": "item-sheet",
      "data-item-id": String(props.itemId ?? ""),
      "data-collection-id": String(props.collectionId),
      "data-open": String(props.open),
    });
  },
}));
vi.mock("@/app/(main)/campaign/[campaignId]/edit/_components/CMS/FieldFormDialog", () => ({
  default: () => null,
}));
vi.mock("@/app/(main)/campaign/[campaignId]/edit/_components/FieldsDropdown", () => ({
  default: () => null,
}));

import CmsContentEditor from "@/app/(main)/campaign/[campaignId]/edit/_components/CMS/cmsContentEditor";
import { useCollectionsStore } from "@/stores/editor/useCollectionsStore";
import type { Collection, CollectionField, CollectionItemWithValues } from "@/types/funnel";

// ── Fixtures ─────────────────────────────────────────────────────────────────
const CAMP = "camp_1";
const COL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const url = (path = "", q = "") => `/campaign/${CAMP}/edit/cms${path}${q}`;

const collection = (id: string, name: string, order: number): Collection => ({
  id, name, uuid: id, order, sorting: null, created_at: "", updated_at: "", deleted_at: null, is_published: false,
  draft_items_count: 0, has_published_version: false,
});
const fieldsOf = (cid: string): CollectionField[] =>
  (["name", "slug"] as const).map((k, i) => ({
    id: `${cid}-f-${k}`, collection_id: cid, name: k === "name" ? "Name" : "Slug", key: k, type: "text",
    default: null, fillable: true, order: i, hidden: false, reference_collection_id: null, data: {},
    created_at: "", updated_at: "", deleted_at: null, is_published: false,
  })) as unknown as CollectionField[];
const itemsOf = (cid: string, labels: string[]): CollectionItemWithValues[] =>
  labels.map((label, i) => ({
    id: `${cid}-i-${i}`, collection_id: cid, manual_order: i, values: { [`${cid}-f-name`]: label, [`${cid}-f-slug`]: label.toLowerCase() },
    created_at: "", updated_at: "", deleted_at: null, is_published: false, is_publishable: true, content_hash: null,
  }));

function seedStore(opts: { A?: string[]; B?: string[]; lastA?: Record<string, unknown> } = {}) {
  const A = opts.A ?? ["Alpha", "Beta", "Gamma"];
  const B = opts.B ?? ["Bravo"];
  useCollectionsStore.setState({
    collections: [collection(COL_A, "Posts", 0), collection(COL_B, "Authors", 1)],
    fields: { [COL_A]: fieldsOf(COL_A), [COL_B]: fieldsOf(COL_B) },
    items: { [COL_A]: itemsOf(COL_A, A), [COL_B]: itemsOf(COL_B, B) },
    itemsTotalCount: { [COL_A]: A.length, [COL_B]: B.length },
    // what the editor bootstrap leaves behind: page 1 / default limit loaded
    lastItemsQuery: { [COL_A]: { page: 1, limit: 25, ...(opts.lastA ?? {}) }, [COL_B]: { page: 1, limit: 25 } },
    selectedCollectionId: null, cmsSection: "collections", crossCollectionSlugs: {}, isLoading: false, error: null,
  });
}

const mountEditor = () => render(h(CmsContentEditor, { campaignId: CAMP }));
const lastReplace = () => [...nav.state.history].reverse().find((e) => e.kind === "replace")?.url;

beforeEach(() => {
  nav.state.url = url();
  nav.state.history = [];
  sheetProps.current = null;
  for (const fn of [...Object.values(read), ...Object.values(write), toast, toast.error, toast.success]) fn.mockReset();
  read.getItems.mockResolvedValue({ data: { items: [], total: 0 } });
  read.searchItems.mockResolvedValue({ data: { items: [], total: 0 } });
  read.getFields.mockResolvedValue({ data: [] });
  read.getItemSlugs.mockResolvedValue({ data: {} });
  read.getReferencedItemsBatch.mockResolvedValue({ data: {} });
  seedStore();
});
afterEach(() => cleanup());

// ═════════════════════════════════════════════════════════════════════════════
describe("Workflow 1 — specific collection navigation", () => {
  it("bare /cms opens the first collection (URL is replaced, not pushed)", async () => {
    mountEditor();
    await waitFor(() => expect(nav.state.url).toBe(url(`/${COL_A}`)));
    expect(nav.state.history[0]).toEqual({ kind: "replace", url: url(`/${COL_A}`) });
    expect(useCollectionsStore.getState().selectedCollectionId).toBe(COL_A);
  });

  it("renders the URL's collection and keeps the store selection in sync", async () => {
    nav.state.url = url(`/${COL_B}`);
    mountEditor();
    expect(await screen.findByText("Bravo")).toBeTruthy();
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(useCollectionsStore.getState().selectedCollectionId).toBe(COL_B);
    expect(nav.state.history).toEqual([]); // nothing to correct
  });

  it("does not refetch what the bootstrap already hydrated", async () => {
    nav.state.url = url(`/${COL_A}`);
    mountEditor();
    await screen.findByText("Alpha");
    expect(read.getItems).not.toHaveBeenCalled();
  });

  it("an unknown collection id explains itself and falls back to the first collection", async () => {
    nav.state.url = url("/dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    mountEditor();
    await waitFor(() => expect(lastReplace()).toBe(url(`/${COL_A}`)));
    expect(toast.error).toHaveBeenCalledWith("Collection not found", expect.anything());
    expect(await screen.findByText("Alpha")).toBeTruthy();
  });

  it("switching collections shows only the new collection's rows", async () => {
    nav.state.url = url(`/${COL_A}`);
    mountEditor();
    await screen.findByText("Alpha");
    act(() => nav.set("push", url(`/${COL_B}`)));
    expect(await screen.findByText("Bravo")).toBeTruthy();
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(useCollectionsStore.getState().selectedCollectionId).toBe(COL_B);
  });

  it("fetches the page / limit the URL asks for", async () => {
    nav.state.url = url(`/${COL_A}`, "?page=2&limit=10");
    read.getItems.mockResolvedValue({ data: { items: itemsOf(COL_A, ["P2-row"]), total: 11 } });
    mountEditor();
    expect(await screen.findByText("P2-row")).toBeTruthy();
    expect(read.getItems).toHaveBeenCalledWith(COL_A, expect.objectContaining({ page: 2, limit: 10 }));
  });

  it("a text search in the URL runs the search query, not a plain load", async () => {
    nav.state.url = url(`/${COL_A}`, "?search=gam");
    read.searchItems.mockResolvedValue({ data: { items: itemsOf(COL_A, ["Gamma"]), total: 1 } });
    mountEditor();
    await waitFor(() => expect(read.searchItems).toHaveBeenCalledWith(COL_A, "gam", expect.objectContaining({ page: 1 })));
    expect(read.getItems).not.toHaveBeenCalled();
  });

  it("a stale slow response never overwrites a newer collection query", async () => {
    // Page 2 is slow; the user moves to page 3 which answers first.
    let releasePage2: (v: unknown) => void = () => {};
    read.getItems.mockImplementation((_c: string, o: { page: number }) =>
      o.page === 2
        ? new Promise((r) => (releasePage2 = r))
        : Promise.resolve({ data: { items: itemsOf(COL_A, ["Page-3"]), total: 60 } }),
    );
    nav.state.url = url(`/${COL_A}`, "?page=2");
    mountEditor();
    await waitFor(() => expect(read.getItems).toHaveBeenCalledTimes(1));
    act(() => nav.set("push", url(`/${COL_A}`, "?page=3")));
    expect(await screen.findByText("Page-3")).toBeTruthy();
    await act(async () => releasePage2({ data: { items: itemsOf(COL_A, ["Page-2-STALE"]), total: 60 } }));
    expect(screen.queryByText("Page-2-STALE")).toBeNull();
    expect(screen.getByText("Page-3")).toBeTruthy();
  });

  it("a page past the end jumps back to the last valid page", async () => {
    nav.state.url = url(`/${COL_A}`, "?page=9");
    read.getItems.mockResolvedValue({ data: { items: [], total: 3 } });
    mountEditor();
    await waitFor(() => expect(lastReplace()).toBe(url(`/${COL_A}`))); // page 1 = default, omitted
  });

  it("typing in the search box updates the URL once, debounced, resetting to page 1", async () => {
    nav.state.url = url(`/${COL_A}`, "?page=2");
    read.getItems.mockResolvedValue({ data: { items: itemsOf(COL_A, ["Row-One"]), total: 40 } });
    mountEditor();
    await screen.findByText("Row-One");
    const input = screen.getByPlaceholderText(/search/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ga" } });
    fireEvent.change(input, { target: { value: "gam" } });
    expect(nav.state.history.filter((e) => e.url.includes("search"))).toHaveLength(0); // still debouncing
    await waitFor(() => expect(nav.state.url).toBe(url(`/${COL_A}`, "?search=gam")), { timeout: 2000 });
    expect(nav.state.history.filter((e) => e.url.includes("search"))).toHaveLength(1);
    expect(input.value).toBe("gam"); // typing is not clobbered by the URL round trip
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("Workflows 2 & 3 — opening existing items and creating new ones", () => {
  it("no item sheet until the URL asks for one", async () => {
    nav.state.url = url(`/${COL_A}`);
    mountEditor();
    await screen.findByText("Alpha");
    expect(screen.queryByTestId("item-sheet")).toBeNull();
  });

  it("clicking a row opens that item via the URL, keeping page and search", async () => {
    nav.state.url = url(`/${COL_A}`, "?page=1&limit=10");
    // limit=10 differs from the hydrated limit (25) so the editor refetches.
    read.getItems.mockResolvedValue({ data: { items: itemsOf(COL_A, ["Alpha", "Beta", "Gamma"]), total: 3 } });
    mountEditor();
    fireEvent.click(await screen.findByText("Beta"));
    await waitFor(() => expect(nav.state.url).toBe(url(`/${COL_A}`, `?limit=10&edit=${COL_A}-i-1`)));
    const sheet = await screen.findByTestId("item-sheet");
    expect(sheet.getAttribute("data-item-id")).toBe(`${COL_A}-i-1`);
    expect(sheet.getAttribute("data-collection-id")).toBe(COL_A);
  });

  it("deep-linking ?edit=<id> opens the sheet for that exact item and collection", async () => {
    nav.state.url = url(`/${COL_B}`, `?edit=${COL_B}-i-0`);
    mountEditor();
    const sheet = await screen.findByTestId("item-sheet");
    expect(sheet.getAttribute("data-item-id")).toBe(`${COL_B}-i-0`);
    expect(sheet.getAttribute("data-collection-id")).toBe(COL_B);
  });

  it("the New button opens create mode (?new) with no item id", async () => {
    nav.state.url = url(`/${COL_A}`);
    mountEditor();
    await screen.findByText("Alpha");
    fireEvent.click(screen.getAllByRole("button").find((b) => /^\s*(new|create|add)\b/i.test(b.textContent ?? "") && !b.closest("table"))!);
    await waitFor(() => expect(nav.state.url).toBe(url(`/${COL_A}`, "?new")));
    const sheet = await screen.findByTestId("item-sheet");
    expect(sheet.getAttribute("data-item-id")).toBe("");
  });

  it("switching from one item to another gives the sheet a fresh instance (no leaked form state)", async () => {
    nav.state.url = url(`/${COL_A}`, `?edit=${COL_A}-i-0`);
    const { container } = mountEditor();
    const first = await screen.findByTestId("item-sheet");
    act(() => nav.set("push", url(`/${COL_A}`, `?edit=${COL_A}-i-2`)));
    await waitFor(() => expect(screen.getByTestId("item-sheet").getAttribute("data-item-id")).toBe(`${COL_A}-i-2`));
    expect(screen.getByTestId("item-sheet")).not.toBe(first); // remounted (keyed), not reused
    void container;
  });

  it("item → new keeps the collection but drops the old item id", async () => {
    nav.state.url = url(`/${COL_A}`, `?edit=${COL_A}-i-0`);
    mountEditor();
    await screen.findByTestId("item-sheet");
    act(() => nav.set("push", url(`/${COL_A}`, "?new")));
    await waitFor(() => expect(screen.getByTestId("item-sheet").getAttribute("data-item-id")).toBe(""));
  });

  it("changing collection closes any open sheet of the previous collection", async () => {
    nav.state.url = url(`/${COL_A}`, `?edit=${COL_A}-i-0`);
    mountEditor();
    await screen.findByTestId("item-sheet");
    act(() => nav.set("push", url(`/${COL_B}`)));
    await waitFor(() => expect(screen.queryByTestId("item-sheet")).toBeNull());
  });

  it("closing / saving the sheet replaces the URL with the plain collection URL", async () => {
    nav.state.url = url(`/${COL_A}`, `?limit=10&edit=${COL_A}-i-0`);
    mountEditor();
    await screen.findByTestId("item-sheet");
    act(() => (sheetProps.current!.onSuccess as () => void)());
    await waitFor(() => expect(nav.state.url).toBe(url(`/${COL_A}`, "?limit=10")));
    expect(nav.state.history.at(-1)!.kind).toBe("replace");
    await waitFor(() => expect(screen.queryByTestId("item-sheet")).toBeNull());
  });

  it("a ?new / ?edit URL for a collection that doesn't exist never opens a sheet", async () => {
    nav.state.url = url("/dddddddd-dddd-4ddd-8ddd-dddddddddddd", "?new");
    mountEditor();
    await waitFor(() => expect(lastReplace()).toBe(url(`/${COL_A}`)));
    expect(screen.queryByTestId("item-sheet")).toBeNull();
  });
});
