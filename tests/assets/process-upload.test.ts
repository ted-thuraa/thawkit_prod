import { describe, expect, it, vi } from "vitest";
import {
  UploadRejectedError,
  processUploadedFile,
  type NewAssetInput,
  type ProcessDeps,
  type UploadedObject,
} from "@/lib/assets/process-upload";
import type { Asset } from "@/types/funnel";

const enc = (s: string) => new TextEncoder().encode(s);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';

function png(w = 100, h = 50): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const dv = new DataView(b.buffer);
  dv.setUint32(8, 13);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  b.set([8, 6, 0, 0, 0], 24);
  return b;
}

const CTX = { organizationId: "org_1", userId: "user_1", folderId: null };

function file(over: Partial<UploadedObject> = {}): UploadedObject {
  return {
    key: "key_orig",
    name: "photo.png",
    size: 33,
    type: "image/png",
    ufsUrl: "https://app123.ufs.sh/f/key_orig",
    ...over,
  };
}

function toAsset(input: NewAssetInput): Asset {
  return {
    id: "asset_1",
    filename: input.filename,
    storage_path: input.storagePath,
    public_url: input.publicUrl,
    file_size: input.fileSize,
    mime_type: input.mimeType,
    width: input.width,
    height: input.height,
    source: "library",
    asset_folder_id: input.assetFolderId,
    content: input.content,
    content_hash: input.contentHash,
    is_published: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
  } as Asset;
}

function makeDeps(over: Partial<ProcessDeps> & { bytes?: Uint8Array } = {}) {
  const inserted: NewAssetInput[] = [];
  const deleted: string[] = [];
  const log = { warn: vi.fn(), error: vi.fn() };
  const deps: ProcessDeps = {
    findByStorageKey: vi.fn(async () => null),
    insertAsset: vi.fn(async (input) => {
      inserted.push(input);
      return { asset: toAsset(input), created: true };
    }),
    fetchBytes: vi.fn(async () => over.bytes ?? png()),
    deleteObject: vi.fn(async (key: string) => {
      deleted.push(key);
    }),
    replaceObject: vi.fn(async () => ({
      key: "key_clean",
      ufsUrl: "https://app123.ufs.sh/f/key_clean",
    })),
    log,
    ...over,
  };
  return { deps, inserted, deleted, log };
}

describe("processUploadedFile", () => {
  it("persists metadata for a valid raster image (org from context, real dims)", async () => {
    const { deps, inserted, deleted } = makeDeps();
    const asset = await processUploadedFile(file(), CTX, deps);
    expect(asset.public_url).toBe("https://app123.ufs.sh/f/key_orig");
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      organizationId: "org_1",
      storagePath: "key_orig",
      mimeType: "image/png",
      width: 100,
      height: 50,
      content: null,
    });
    expect(inserted[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(deleted).toEqual([]);
  });

  it("stores a clean SVG as-is, with sanitized inline content", async () => {
    const { deps, inserted } = makeDeps({ bytes: enc(SVG) });
    await processUploadedFile(file({ name: "i.svg", type: "image/svg+xml", key: "k1", ufsUrl: "https://a.ufs.sh/f/k1" }), CTX, deps);
    expect(deps.replaceObject).not.toHaveBeenCalled();
    expect(inserted[0]).toMatchObject({ storagePath: "k1", mimeType: "image/svg+xml", width: 24, height: 24 });
    expect(inserted[0].content).toContain("<svg");
  });

  it("replaces a dirty SVG with the sanitized file and deletes the original", async () => {
    const dirty = SVG.replace("<path", '<metadata/><path data-x="1"');
    const { deps, inserted, deleted } = makeDeps({ bytes: enc(dirty) });
    await processUploadedFile(file({ name: "i.svg", type: "image/svg+xml" }), CTX, deps);
    expect(deps.replaceObject).toHaveBeenCalledTimes(1);
    expect(deleted).toEqual(["key_orig"]);
    expect(inserted[0].storagePath).toBe("key_clean");
    expect(inserted[0].publicUrl).toBe("https://app123.ufs.sh/f/key_clean");
    expect(inserted[0].content).not.toContain("metadata");
  });

  it("rejects an active SVG and deletes the stored object", async () => {
    const { deps, inserted, deleted } = makeDeps({ bytes: enc(SVG.replace("<path", "<script>1</script><path")) });
    await expect(
      processUploadedFile(file({ name: "i.svg", type: "image/svg+xml" }), CTX, deps),
    ).rejects.toBeInstanceOf(UploadRejectedError);
    expect(inserted).toHaveLength(0);
    expect(deleted).toEqual(["key_orig"]);
  });

  it("rejects content that doesn't match the declared type and cleans up", async () => {
    const { deps, deleted } = makeDeps({ bytes: enc("<html>not an image</html>") });
    await expect(processUploadedFile(file(), CTX, deps)).rejects.toThrow(/valid image/i);
    expect(deleted).toEqual(["key_orig"]);
  });

  it("rejects unsupported declared types (video) without fetching bytes", async () => {
    const { deps, deleted } = makeDeps();
    await expect(
      processUploadedFile(file({ name: "v.mp4", type: "video/mp4" }), CTX, deps),
    ).rejects.toBeInstanceOf(UploadRejectedError);
    expect(deps.fetchBytes).not.toHaveBeenCalled();
    expect(deleted).toEqual(["key_orig"]);
  });

  it("rejects oversize claims", async () => {
    const { deps } = makeDeps();
    await expect(
      processUploadedFile(file({ size: 9 * 1024 * 1024 }), CTX, deps),
    ).rejects.toThrow(/too large/);
  });

  it("refuses to fetch from a non-UploadThing host (SSRF guard)", async () => {
    const { deps } = makeDeps();
    await expect(
      processUploadedFile(file({ ufsUrl: "http://169.254.169.254/x" }), CTX, deps),
    ).rejects.toBeInstanceOf(UploadRejectedError);
    expect(deps.fetchBytes).not.toHaveBeenCalled();
  });

  it("DB failure after storage succeeded → deletes the object, generic error", async () => {
    const { deps, deleted } = makeDeps({
      insertAsset: vi.fn(async () => {
        throw new Error("connection reset");
      }),
    });
    await expect(processUploadedFile(file(), CTX, deps)).rejects.toThrow(
      /could not be saved/i,
    );
    expect(deleted).toEqual(["key_orig"]);
  });

  it("cleanup failure is logged as an orphan with the key, original error still surfaces", async () => {
    const { deps, log } = makeDeps({
      insertAsset: vi.fn(async () => {
        throw new Error("db down");
      }),
      deleteObject: vi.fn(async () => {
        throw new Error("uploadthing down");
      }),
    });
    await expect(processUploadedFile(file(), CTX, deps)).rejects.toBeInstanceOf(UploadRejectedError);
    expect(log.error).toHaveBeenCalledWith(
      "asset.orphan",
      expect.objectContaining({ key: "key_orig" }),
    );
  });

  it("DB failure after an SVG replacement cleans up BOTH objects when the original delete failed", async () => {
    const dirty = SVG.replace("<path", '<metadata/><path');
    const deleteObject = vi
      .fn<(k: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("first delete fails")) // original, during replace
      .mockResolvedValue(undefined); // compensating deletes
    const { deps } = makeDeps({
      bytes: enc(dirty),
      deleteObject,
      insertAsset: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    await expect(
      processUploadedFile(file({ name: "i.svg", type: "image/svg+xml" }), CTX, deps),
    ).rejects.toBeInstanceOf(UploadRejectedError);
    expect(deleteObject.mock.calls.map((c) => c[0]).sort()).toEqual(
      ["key_clean", "key_orig", "key_orig"].sort(),
    );
  });

  it("is idempotent: a redelivered callback returns the existing row and does no work", async () => {
    const existing = toAsset({
      organizationId: "org_1", assetFolderId: null, filename: "photo.png",
      storagePath: "key_orig", publicUrl: "https://app123.ufs.sh/f/key_orig",
      fileSize: 33, mimeType: "image/png", width: 1, height: 1, content: null, contentHash: "x",
    });
    const { deps } = makeDeps({ findByStorageKey: vi.fn(async () => existing) });
    const asset = await processUploadedFile(file(), CTX, deps);
    expect(asset).toBe(existing);
    expect(deps.fetchBytes).not.toHaveBeenCalled();
    expect(deps.insertAsset).not.toHaveBeenCalled();
  });

  it("concurrent duplicate (insert reports created:false) keeps the winner's object", async () => {
    const { deps, deleted } = makeDeps({
      insertAsset: vi.fn(async (input) => ({ asset: toAsset(input), created: false })),
    });
    await processUploadedFile(file(), CTX, deps);
    expect(deleted).toEqual([]); // key_orig is owned by the winning row
  });

  it("sanitizes the stored filename", async () => {
    const { deps, inserted } = makeDeps();
    await processUploadedFile(file({ name: "../../evil.png" }), CTX, deps);
    expect(inserted[0].filename).not.toMatch(/[\\/]/);
  });
});
