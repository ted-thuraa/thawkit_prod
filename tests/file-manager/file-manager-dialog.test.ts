// @vitest-environment jsdom
/**
 * The REAL FileManagerDialog (new UI) with the REAL zustand stores. Only the
 * network edges are mocked: server-action adapters, UploadThing's browser hook
 * and toasts. The icon library is the real local Remix catalog.
 */
import "./jsdom-polyfills";
import { createElement as h } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above module-level consts, so the shared
// mocks must be created with vi.hoisted.
const { fetchPage, api, toast } = vi.hoisted(() => ({
  fetchPage: vi.fn(),
  api: {
    createFolder: vi.fn(),
    updateFolder: vi.fn(),
    createSvg: vi.fn(),
    getFolderCounts: vi.fn(),
    getUsage: vi.fn(),
    deleteAsset: vi.fn(),
  },
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}));

vi.mock("@/lib/auth/auth", () => ({ auth: {}, getServerSession: vi.fn() }));
vi.mock("@/lib/editor/editor-read-api", () => ({
  assetsReadApi: { fetchPage: (...a: unknown[]) => fetchPage(...a), getByIds: vi.fn(), getFolders: vi.fn() },
}));
vi.mock("@/lib/editor/editor-asset-write-api", () => ({
  assetsWriteApi: { delete: (...a: unknown[]) => api.deleteAsset(...a) },
  assetFoldersApi: {
    create: (...a: unknown[]) => api.createFolder(...a),
    update: (...a: unknown[]) => api.updateFolder(...a),
  },
  assetsApi: {
    createSvg: (...a: unknown[]) => api.createSvg(...a),
    getFolderCounts: (...a: unknown[]) => api.getFolderCounts(...a),
    getUsage: (...a: unknown[]) => api.getUsage(...a),
  },
}));
vi.mock("@/lib/assets/uploadthing-client", () => ({
  useUploadThing: () => ({ startUpload: vi.fn(), isUploading: false }),
}));
vi.mock("sonner", () => ({ toast }));

import FileManagerDialog from "@/app/(main)/campaign/[campaignId]/edit/_components/FileManagerDialog";
import { useAssetsStore } from "@/stores/editor/useAssetsStore";
import { useEditorBootstrapStore } from "@/stores/editor/useEditorBootstrapStore";
import type { Asset, AssetFolder } from "@/types/funnel";

const asset = (id: string, folder: string | null, extra: Partial<Asset> = {}): Asset =>
  ({
    id, filename: `${id}.png`, storage_path: `key_${id}`, public_url: `https://x.ufs.sh/f/key_${id}`,
    file_size: 2048, mime_type: "image/png", width: 10, height: 20, source: "library",
    asset_folder_id: folder, content: null, content_hash: null, is_published: false,
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", deleted_at: null,
    ...extra,
  }) as Asset;

const folder = (id: string, name: string, parent: string | null = null, order = 0): AssetFolder => ({
  id, name, asset_folder_id: parent, depth: parent ? 1 : 0, order, is_published: false,
  created_at: "", updated_at: "", deleted_at: null,
});

// What the server would return for each view (root = no regular folder).
const LIBRARY: Asset[] = [
  asset("rootA", null), asset("rootB", null),
  asset("prod1", "products"), asset("prod2", "products"),
];

/** Server-like paging over LIBRARY for fetchAssets({folderId|folderIds, search, page, limit}). */
function serve(params: { folderId?: string | null; folderIds?: string[]; search?: string }) {
  let rows = LIBRARY;
  if (params.folderIds) {
    rows = rows.filter((a) => params.folderIds!.includes(a.asset_folder_id ?? "root"));
  } else if (params.folderId !== undefined) {
    rows = rows.filter((a) => (a.asset_folder_id ?? null) === params.folderId);
  }
  if (params.search) rows = rows.filter((a) => a.filename.includes(params.search!));
  return { data: { assets: rows, total: rows.length, page: 1, limit: 40, hasMore: false } };
}

const lastFetchFor = () => fetchPage.mock.calls.at(-1)?.[0] as { folderId?: string | null };

async function renderDialog(props: Partial<Parameters<typeof FileManagerDialog>[0]> = {}) {
  const view = render(h(FileManagerDialog, { open: true, onOpenChange: () => {}, ...props }));
  // let the initial fetch + counts settle
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return view;
}

beforeEach(() => {
  fetchPage.mockReset().mockImplementation(async (params) => serve(params));
  Object.values(api).forEach((m) => m.mockReset());
  api.getFolderCounts.mockResolvedValue({ data: { root: 2, products: 2 } });
  [toast, toast.success, toast.error, toast.message].forEach((m) => m.mockReset());
  useAssetsStore.getState().reset();
  useAssetsStore.setState({
    folders: [folder("products", "Products", null, 0), folder("logos", "Logos", "products", 0)],
  } as never);
  useEditorBootstrapStore.setState({ campaignId: "camp_1" } as never);
});
afterEach(cleanup);

describe("folder architecture: 'All files' root", () => {
  it("shows a default 'All files' root with the regular folders beneath it", async () => {
    await renderDialog();
    const text = document.body.textContent ?? "";
    expect(text).toContain("All files");
    expect(text).toContain("Products");
    // 'Logos' is nested under 'Products' (expanded by default)
    expect(text).toContain("Logos");
    expect(text.indexOf("All files")).toBeLessThan(text.indexOf("Products"));
    expect(text.indexOf("Products")).toBeLessThan(text.indexOf("Logos"));
  });

  it("'All files' lists ONLY assets that belong to no regular folder (folderId: null)", async () => {
    await renderDialog();
    expect(lastFetchFor().folderId).toBeNull();
    expect(screen.getByText("rootA.png")).toBeTruthy();
    expect(screen.getByText("rootB.png")).toBeTruthy();
    expect(screen.queryByText("prod1.png")).toBeNull();
  });

  it("selecting a folder filters by that folder; going back restores the root's assets", async () => {
    const user = userEvent.setup();
    await renderDialog();

    await user.click(screen.getAllByText("Products")[0]);
    await waitFor(() => expect(lastFetchFor().folderId).toBe("products"));
    expect(await screen.findByText("prod1.png")).toBeTruthy();
    expect(screen.queryByText("rootA.png")).toBeNull();

    await user.click(screen.getAllByText("All files")[0]);
    await waitFor(() => expect(lastFetchFor().folderId).toBeNull());
    expect(await screen.findByText("rootA.png")).toBeTruthy();
    expect(screen.queryByText("prod1.png")).toBeNull();
  });

  it("falls back to 'All files' when the open folder no longer exists (stale reference)", async () => {
    const user = userEvent.setup();
    await renderDialog();
    await user.click(screen.getAllByText("Products")[0]);
    await waitFor(() => expect(lastFetchFor().folderId).toBe("products"));

    act(() => useAssetsStore.setState({ folders: [] } as never));

    await waitFor(() => expect(lastFetchFor().folderId).toBeNull());
    expect(await screen.findByText("rootA.png")).toBeTruthy();
  });

  it("sidebar badges come from the server's counts, not from the loaded page", async () => {
    api.getFolderCounts.mockResolvedValue({ data: { root: 137, products: 41 } });
    await renderDialog();
    expect(api.getFolderCounts).toHaveBeenCalled();
    const text = document.body.textContent ?? "";
    expect(text).toContain("137");
    expect(text).toContain("41");
  });
});

describe("folder creation", () => {
  const openCreate = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: "New folder" }));
    return screen.findByRole("dialog", { name: "New folder" });
  };

  it("creates a root-level folder, persists it, and shows it without a reload", async () => {
    const user = userEvent.setup();
    api.createFolder.mockResolvedValue({ data: folder("brand", "Brand", null, 1) });
    await renderDialog();

    const dlg = await openCreate(user);
    await user.type(within(dlg).getByLabelText("Name"), "Brand");
    await user.click(within(dlg).getByRole("button", { name: "Create" }));

    expect(api.createFolder).toHaveBeenCalledWith({ name: "Brand", parentId: null });
    await waitFor(() => expect(document.body.textContent).toContain("Brand"));
    expect(useAssetsStore.getState().folders.map((f) => f.id)).toContain("brand");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New folder" })).toBeNull());
  });

  it("creates a nested folder under the selected folder", async () => {
    const user = userEvent.setup();
    api.createFolder.mockResolvedValue({ data: folder("icons2", "Icons2", "products", 1) });
    await renderDialog();
    await user.click(screen.getAllByText("Products")[0]);

    const dlg = await openCreate(user);
    await user.type(within(dlg).getByLabelText("Name"), "Icons2");
    await user.click(within(dlg).getByRole("button", { name: "Create" }));

    expect(api.createFolder).toHaveBeenCalledWith({ name: "Icons2", parentId: "products" });
    await waitFor(() => expect(document.body.textContent).toContain("Icons2"));
  });

  it("a FAILED creation keeps the dialog open with the input, reports why, and adds nothing", async () => {
    const user = userEvent.setup();
    api.createFolder.mockResolvedValue({ error: "Folder name is required." });
    await renderDialog();

    const dlg = await openCreate(user);
    await user.type(within(dlg).getByLabelText("Name"), "Oops");
    await user.click(within(dlg).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Unable to create folder", { description: "Folder name is required." }));
    expect(screen.getByRole("dialog", { name: "New folder" })).toBeTruthy(); // still open
    expect((within(screen.getByRole("dialog", { name: "New folder" })).getByLabelText("Name") as HTMLInputElement).value).toBe("Oops");
    expect(useAssetsStore.getState().folders).toHaveLength(2);
  });

  it("does not offer reordering (no drag handles / move controls)", async () => {
    await renderDialog();
    expect(document.querySelector("[data-drag-active]")).toBeNull();
    expect(screen.queryByRole("button", { name: /move (up|down)/i })).toBeNull();
  });
});

describe("picker", () => {
  it("selecting a file calls onAssetSelect with that asset", async () => {
    const user = userEvent.setup();
    const onAssetSelect = vi.fn();
    await renderDialog({ onAssetSelect });
    // the clickable thumbnail is the caption's sibling inside the grid cell
    const tile = screen.getByText("rootA.png").parentElement!.querySelector<HTMLElement>("div.cursor-pointer")!;
    await user.click(tile);
    expect(onAssetSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "rootA" }));
  });
});

describe("icon library (Remix, local)", () => {
  const openRemix = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByText("Remix"));
    await waitFor(() => expect(document.querySelectorAll("svg[viewBox='0 0 24 24']").length).toBeGreaterThan(20));
  };

  it("lists real Remix icons without touching the asset API", async () => {
    const user = userEvent.setup();
    await renderDialog();
    const before = fetchPage.mock.calls.length;
    await openRemix(user);
    expect(fetchPage.mock.calls.length).toBe(before); // virtual node → no asset query
  });

  it("clicking a library icon opens 'New SVG icon' pre-filled, and saving persists a sanitized inline SVG", async () => {
    const user = userEvent.setup();
    api.createSvg.mockImplementation(async (input) => ({
      data: asset("svg1", null, {
        filename: input.name, storage_path: null, public_url: null,
        mime_type: "image/svg+xml", content: input.content,
      }),
    }));
    await renderDialog();
    await openRemix(user);

    // first icon tile in the grid
    const firstIcon = document.querySelector("svg[viewBox='0 0 24 24']")!.closest("button, [role='button'], div[class*='cursor-pointer']") as HTMLElement;
    await user.click(firstIcon);

    const dlg = await screen.findByRole("dialog", { name: /svg/i });
    const nameInput = within(dlg).getByDisplayValue(/-(fill|line)$|^[a-z0-9-]+$/) as HTMLInputElement;
    expect(nameInput.value.length).toBeGreaterThan(0);

    const typedName = nameInput.value; // read before the dialog resets itself
    await user.click(within(dlg).getByRole("button", { name: /^(create|save)/i }));

    await waitFor(() => expect(api.createSvg).toHaveBeenCalledTimes(1));
    const sent = api.createSvg.mock.calls[0][0];
    expect(sent.name).toBe(typedName);
    expect(sent.folderId).toBeNull();
    expect(sent.content.startsWith("<svg")).toBe(true);
    expect(sent.content).toContain('fill="currentColor"');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("SVG icon created"));
  });

  it("a rejected SVG keeps the dialog open and explains why (not a silent close)", async () => {
    const user = userEvent.setup();
    api.createSvg.mockResolvedValue({ error: "This SVG can't be used: <script> elements are not allowed in uploaded SVGs." });
    await renderDialog();
    await openRemix(user);
    const firstIcon = document.querySelector("svg[viewBox='0 0 24 24']")!.closest("button, [role='button'], div[class*='cursor-pointer']") as HTMLElement;
    await user.click(firstIcon);
    const dlg = await screen.findByRole("dialog", { name: /svg/i });
    await user.click(within(dlg).getByRole("button", { name: /^(create|save)/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Unable to create SVG icon", expect.objectContaining({ description: expect.stringContaining("script") })));
    expect(screen.queryByRole("dialog", { name: /svg/i })).toBeTruthy(); // still open
  });
});

describe("asset deletion UI", () => {
  /** Opens the tile's overflow menu and picks "Delete". */
  async function startDelete(user: ReturnType<typeof userEvent.setup>, filename: string) {
    const cell = screen.getByText(filename).closest("div.group") as HTMLElement;
    const menuTrigger = Array.from(cell.querySelectorAll<HTMLElement>("button")).find(
      (b) => b.getAttribute("role") !== "checkbox",
    )!;
    await user.click(menuTrigger);
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));
  }

  /**
   * The confirmation is a dialog titled "Delete asset" / "Asset is in use".
   * Looked up by text because Radix marks the rest of the page aria-hidden
   * while it is open (which role queries would filter out).
   */
  const confirmDialog = async () => {
    const title = await screen.findByText(/^(Delete asset|Asset is in use)$/);
    return title.closest('[role="dialog"], [role="alertdialog"]') as HTMLElement;
  };

  it("a USED file can't be deleted: lists where it is used and disables confirm", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    api.getUsage.mockResolvedValue({
      data: {
        total: 2,
        pages: [{ id: "p1", name: "Landing" }],
        components: [], layerStyles: [], cmsItems: [],
        publishedFunnels: [{ id: "f1", name: "Spring sale" }],
      },
    });
    await renderDialog();
    await startDelete(user, "rootA.png");

    const dlg = await confirmDialog();
    await waitFor(() => expect(within(dlg).getByText(/can.t be deleted yet/)).toBeTruthy());
    expect(within(dlg).getByText("Landing")).toBeTruthy();
    expect(within(dlg).getByText("Spring sale")).toBeTruthy();
    expect((within(dlg).getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.deleteAsset).not.toHaveBeenCalled();
  });

  it("an UNUSED file is deleted via the server and only then disappears", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    api.getUsage.mockResolvedValue({
      data: { total: 0, pages: [], components: [], layerStyles: [], cmsItems: [], publishedFunnels: [] },
    });
    api.deleteAsset.mockResolvedValue({ ok: true });
    await renderDialog();
    await startDelete(user, "rootB.png");

    const dlg = await confirmDialog();
    await user.click(await within(dlg).findByRole("button", { name: "Delete" }));

    await waitFor(() => expect(api.deleteAsset).toHaveBeenCalledWith("rootB"));
    await waitFor(() => expect(screen.queryByText("rootB.png")).toBeNull());
    expect(screen.getByText("rootA.png")).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith("Asset deleted");
  });

  it("a server refusal/failure keeps the file and says so (no optimistic removal)", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    api.getUsage.mockResolvedValue({
      data: { total: 0, pages: [], components: [], layerStyles: [], cmsItems: [], publishedFunnels: [] },
    });
    api.deleteAsset.mockResolvedValue({ ok: false, inUse: false, error: "The file could not be removed from storage. Nothing was changed — please try again." });
    await renderDialog();
    await startDelete(user, "rootB.png");
    const dlg = await confirmDialog();
    await user.click(await within(dlg).findByRole("button", { name: "Delete" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Unable to delete asset", expect.objectContaining({ description: expect.stringContaining("Nothing was changed") })));
    expect(screen.getByText("rootB.png")).toBeTruthy(); // still listed
  });
});
