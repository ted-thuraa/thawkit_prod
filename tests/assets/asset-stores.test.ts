import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteApi = vi.fn();
vi.mock("@/lib/editor/editor-asset-write-api", () => ({
  assetsWriteApi: { delete: (...a: unknown[]) => deleteApi(...a) },
}));
// The stores transitively import server-action modules that boot auth/env;
// none of that is exercised here.
vi.mock("@/lib/auth/auth", () => ({ auth: {}, getServerSession: vi.fn() }));
vi.mock("@/lib/editor/editor-read-api", () => ({
  assetsReadApi: { fetchPage: vi.fn(), getByIds: vi.fn(), getFolders: vi.fn() },
}));

import { useAssetsStore } from "@/stores/editor/useAssetsStore";
import { useEditorStore } from "@/stores/editor/useEditorStore";
import type { Asset } from "@/types/funnel";

const mk = (id: string, extra: Partial<Asset> = {}): Asset =>
  ({
    id,
    filename: `${id}.png`,
    storage_path: `key_${id}`,
    public_url: `https://x.ufs.sh/f/key_${id}`,
    file_size: 10,
    mime_type: "image/png",
    width: 1,
    height: 1,
    source: "library",
    asset_folder_id: null,
    content: null,
    content_hash: null,
    is_published: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    ...extra,
  }) as Asset;

describe("openFileManager contract (what every asset control calls)", () => {
  beforeEach(() => useEditorStore.getState().closeFileManager());

  it("stores the callback, current asset and category", () => {
    const cb = vi.fn();
    useEditorStore.getState().openFileManager(cb, "asset-1", "images");
    const req = useEditorStore.getState().fileManager!;
    expect(req.onSelect).toBe(cb);
    expect(req.assetId).toBe("asset-1");
    expect(req.category).toBe("images");
  });

  it("works with no arguments (header 'File manager' = browse mode)", () => {
    useEditorStore.getState().openFileManager();
    expect(useEditorStore.getState().fileManager).toEqual({
      onSelect: null,
      assetId: null,
      category: undefined,
    });
  });

  it("accepts null current asset id (callers pass null when nothing is assigned)", () => {
    useEditorStore.getState().openFileManager(() => {}, null, "icons");
    expect(useEditorStore.getState().fileManager?.assetId).toBeNull();
  });

  it("closeFileManager clears the request", () => {
    useEditorStore.getState().openFileManager(() => {});
    useEditorStore.getState().closeFileManager();
    expect(useEditorStore.getState().fileManager).toBeNull();
  });

  it("a campaign switch closes any open picker (no stale callbacks)", () => {
    useEditorStore.getState().openFileManager(() => {});
    useEditorStore.getState().resetForNewCampaign();
    expect(useEditorStore.getState().fileManager).toBeNull();
  });
});

describe("assets store: upload/delete cache consistency", () => {
  beforeEach(() => {
    useAssetsStore.getState().reset();
    deleteApi.mockReset();
  });

  it("addAsset makes a new upload immediately resolvable by id", () => {
    useAssetsStore.getState().addAsset(mk("a"));
    const s = useAssetsStore.getState();
    expect(s.assets.map((a) => a.id)).toEqual(["a"]);
    expect(s.getAsset("a")?.id).toBe("a");
  });

  it("deleteAsset removes the asset ONLY after the server confirms", async () => {
    useAssetsStore.getState().addAsset(mk("a"));
    useAssetsStore.getState().addAsset(mk("b"));
    deleteApi.mockResolvedValue({ ok: true });

    const result = await useAssetsStore.getState().deleteAsset("a");
    expect(result.ok).toBe(true);
    const s = useAssetsStore.getState();
    expect(s.assets.map((a) => a.id)).toEqual(["b"]);
    expect(s.assetsById["a"]).toBeUndefined();
    expect(s.assetsById["b"]).toBeDefined();
  });

  it("an 'in use' refusal leaves the cache untouched", async () => {
    useAssetsStore.getState().addAsset(mk("a"));
    deleteApi.mockResolvedValue({ ok: false, error: "still used", inUse: true, usages: [] });
    const result = await useAssetsStore.getState().deleteAsset("a");
    expect(result.ok).toBe(false);
    expect(useAssetsStore.getState().assetsById["a"]).toBeDefined();
    expect(useAssetsStore.getState().assets).toHaveLength(1);
  });

  it("a failed deletion (storage/DB/network) leaves the cache untouched", async () => {
    useAssetsStore.getState().addAsset(mk("a"));
    deleteApi.mockResolvedValue({ ok: false, error: "storage down", inUse: false });
    await useAssetsStore.getState().deleteAsset("a");
    expect(useAssetsStore.getState().assetsById["a"]).toBeDefined();
  });
});
