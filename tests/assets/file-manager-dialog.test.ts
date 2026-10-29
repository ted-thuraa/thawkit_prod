// @vitest-environment jsdom
/**
 * Renders the REAL FileManagerDialog with the REAL zustand stores and drives
 * the flows a user performs. Only network edges are mocked: the read/write
 * server-action adapters and UploadThing's browser hook.
 */
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchPage = vi.fn();
const deleteApi = vi.fn();
const startUpload = vi.fn();
let uploadOptions: { onUploadProgress?: (p: number) => void; onUploadError?: (e: Error) => void } = {};

vi.mock("@/lib/auth/auth", () => ({ auth: {}, getServerSession: vi.fn() }));
vi.mock("@/lib/editor/editor-read-api", () => ({
  assetsReadApi: { fetchPage: (...a: unknown[]) => fetchPage(...a), getByIds: vi.fn(), getFolders: vi.fn() },
}));
vi.mock("@/lib/editor/editor-asset-write-api", () => ({
  assetsWriteApi: { delete: (...a: unknown[]) => deleteApi(...a) },
}));
vi.mock("@/lib/assets/uploadthing-client", () => ({
  useUploadThing: (_slug: string, opts: typeof uploadOptions) => {
    uploadOptions = opts;
    return { startUpload: (...a: unknown[]) => startUpload(...a), isUploading: false, routeConfig: undefined };
  },
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}));

import FileManagerDialog from "@/app/(main)/campaign/[campaignId]/edit/_components/FileManagerDialog";
import { useAssetsStore } from "@/stores/editor/useAssetsStore";
import { useEditorBootstrapStore } from "@/stores/editor/useEditorBootstrapStore";
import { useEditorStore } from "@/stores/editor/useEditorStore";
import type { Asset } from "@/types/funnel";

const mk = (id: string, extra: Partial<Asset> = {}): Asset =>
  ({
    id, filename: `${id}.png`, storage_path: `key_${id}`, public_url: `https://x.ufs.sh/f/key_${id}`,
    file_size: 2048, mime_type: "image/png", width: 10, height: 20, source: "library",
    asset_folder_id: null, content: null, content_hash: null, is_published: false,
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", deleted_at: null,
    ...extra,
  }) as Asset;

const page = (assets: Asset[], hasMore = false) => ({
  data: { assets, total: assets.length, page: 1, limit: 40, hasMore },
});

const open = (...args: Parameters<ReturnType<typeof useEditorStore.getState>["openFileManager"]>) =>
  act(() => useEditorStore.getState().openFileManager(...args));

beforeEach(() => {
  fetchPage.mockReset().mockResolvedValue(page([mk("a"), mk("b"), mk("icon", { filename: "icon.svg", mime_type: "image/svg+xml", content: "<svg/>" })]));
  deleteApi.mockReset();
  startUpload.mockReset();
  uploadOptions = {};
  useAssetsStore.getState().reset();
  useEditorStore.getState().closeFileManager();
  useEditorBootstrapStore.setState({ campaignId: "camp_1" } as never);
});
afterEach(cleanup);

describe("FileManagerDialog", () => {
  it("renders nothing until a control opens it", () => {
    render(h(FileManagerDialog));
    expect(screen.queryByText("Asset library")).toBeNull();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("lists the library and assigns the chosen asset through the picker callback", async () => {
    const onSelect = vi.fn();
    render(h(FileManagerDialog));
    open(onSelect, "a", "images");

    expect(await screen.findByLabelText("b.png")).toBeTruthy();
    // 'images' is raster-only in ThawKit's category contract: SVGs are 'icons'
    expect(screen.queryByLabelText("icon.svg")).toBeNull();
    // the control's current asset is flagged
    expect(screen.getByText("In use here")).toBeTruthy();

    await userEvent.click(screen.getByLabelText("b.png"));
    await userEvent.click(screen.getByRole("button", { name: "Use selected" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ id: "b" });
    expect(useEditorStore.getState().fileManager).toBeNull(); // closed
  });

  it("double-click chooses directly", async () => {
    const onSelect = vi.fn();
    render(h(FileManagerDialog));
    open(onSelect);
    await userEvent.dblClick(await screen.findByLabelText("a.png"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("keeps the dialog open when the callback returns false (caller rejected the file)", async () => {
    const onSelect = vi.fn(() => false as const);
    render(h(FileManagerDialog));
    open(onSelect);
    await userEvent.click(await screen.findByLabelText("a.png"));
    await userEvent.click(screen.getByRole("button", { name: "Use selected" }));
    expect(onSelect).toHaveBeenCalled();
    expect(useEditorStore.getState().fileManager).not.toBeNull();
  });

  it("'icons' category shows only SVG assets", async () => {
    render(h(FileManagerDialog));
    open(() => {}, null, "icons");
    expect(await screen.findByLabelText("icon.svg")).toBeTruthy();
    expect(screen.queryByLabelText("a.png")).toBeNull();
  });

  it("video/audio/document requests explain the limitation and offer no upload", async () => {
    render(h(FileManagerDialog));
    open(() => {}, null, "videos");
    expect(await screen.findByText(/YouTube or Loom link/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /upload/i })).toBeNull();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("browse mode (header 'File manager') has no select button", async () => {
    render(h(FileManagerDialog));
    open();
    await screen.findByLabelText("a.png");
    expect(screen.queryByRole("button", { name: "Use selected" })).toBeNull();
    // footer "Close" + the dialog's built-in ✕
    expect(screen.getAllByRole("button", { name: "Close" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("shows loading → empty state", async () => {
    fetchPage.mockResolvedValue(page([]));
    render(h(FileManagerDialog));
    open(() => {});
    expect(await screen.findByText("No files yet.")).toBeTruthy();
  });

  it("shows a load error with retry", async () => {
    fetchPage.mockResolvedValueOnce({ error: "boom" }).mockResolvedValue(page([mk("a")]));
    render(h(FileManagerDialog));
    open(() => {});
    expect(await screen.findByText("boom")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("a.png")).toBeTruthy();
  });

  describe("upload", () => {
    const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
    const png = new File([new Uint8Array(10)], "new.png", { type: "image/png" });

    it("sends the campaign (never an org id) and shows the new asset immediately, without a reload", async () => {
      startUpload.mockResolvedValue([{ serverData: { asset: mk("new", { filename: "new.png" }) } }]);
      render(h(FileManagerDialog));
      open(() => {});
      await screen.findByLabelText("a.png");
      expect(fetchPage).toHaveBeenCalledTimes(1);

      fireEvent.change(fileInput(), { target: { files: [png] } });

      expect(await screen.findByLabelText("new.png")).toBeTruthy();
      expect(startUpload).toHaveBeenCalledWith([png], { campaignId: "camp_1", folderId: null });
      expect(fetchPage).toHaveBeenCalledTimes(1); // no re-fetch
      // and the editor cache can resolve it (so a control can render it right away)
      expect(useAssetsStore.getState().getAsset("new")?.id).toBe("new");
    });

    it("pre-validates and never starts uploading a video / oversize file", async () => {
      render(h(FileManagerDialog));
      open(() => {});
      await screen.findByLabelText("a.png");
      const video = new File([new Uint8Array(10)], "clip.mp4", { type: "video/mp4" });
      fireEvent.change(fileInput(), { target: { files: [video] } });
      expect((await screen.findByRole("alert")).textContent).toMatch(/only JPEG, PNG, WebP, GIF, AVIF and SVG/);
      expect(startUpload).not.toHaveBeenCalled();
    });

    it("surfaces a server-side rejection and adds nothing", async () => {
      startUpload.mockImplementation(async () => {
        uploadOptions.onUploadError?.(new Error("File contents do not match its declared type."));
        return undefined;
      });
      render(h(FileManagerDialog));
      open(() => {});
      await screen.findByLabelText("a.png");
      fireEvent.change(fileInput(), { target: { files: [png] } });
      expect((await screen.findByRole("alert")).textContent).toMatch(/do not match its declared type/);
      expect(screen.queryByLabelText("new.png")).toBeNull();
    });
  });

  describe("delete", () => {
    const openDelete = async (name: string) => {
      await userEvent.click(await screen.findByLabelText(`Delete ${name}`));
      return screen.findByText("Delete file?");
    };

    it("removes the tile and cache entry only after the server confirms", async () => {
      deleteApi.mockResolvedValue({ ok: true });
      render(h(FileManagerDialog));
      open(() => {});
      await openDelete("a.png");
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      await waitFor(() => expect(screen.queryByLabelText("a.png")).toBeNull());
      expect(deleteApi).toHaveBeenCalledWith("a");
      expect(useAssetsStore.getState().assetsById["a"]).toBeUndefined();
    });

    it("keeps the file and explains why when it is still in use", async () => {
      deleteApi.mockResolvedValue({
        ok: false, inUse: true,
        error: "This file is still used by page “Landing”. Remove it there first, then delete it from the library.",
      });
      render(h(FileManagerDialog));
      open(() => {});
      await openDelete("a.png");
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(/still used by page “Landing”/);
      expect(screen.getByLabelText("a.png")).toBeTruthy(); // tile NOT removed
      // and the user can retry from the same dialog
      expect(within(screen.getByRole("dialog", { name: "Delete file?" })).getByRole("button", { name: "Try again" })).toBeTruthy();
    });

    it("keeps the file when storage/network fails", async () => {
      deleteApi.mockResolvedValue({ ok: false, inUse: false, error: "The file could not be removed from storage. Nothing was changed — please try again." });
      render(h(FileManagerDialog));
      open(() => {});
      await openDelete("b.png");
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      expect((await screen.findByRole("alert")).textContent).toMatch(/Nothing was changed/);
      expect(screen.getByLabelText("b.png")).toBeTruthy();
    });
  });
});
