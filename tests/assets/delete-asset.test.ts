import { describe, expect, it, vi } from "vitest";
import {
  AssetDeleteError,
  deleteAsset,
  describeUsages,
  type AssetUsage,
  type DeleteDeps,
} from "@/lib/assets/delete-asset";
import { NotFoundError } from "@/lib/errors";
import type { Asset } from "@/types/funnel";

const ORG = "org_1";
const ID = "11111111-1111-4111-8111-111111111111";

const ASSET = {
  id: ID,
  filename: "a.png",
  storage_path: "key_1",
  public_url: "https://x.ufs.sh/f/key_1",
  mime_type: "image/png",
} as Asset;

function makeDeps(over: Partial<DeleteDeps> = {}) {
  const calls: string[] = [];
  const deps: DeleteDeps = {
    getAsset: vi.fn(async () => ASSET),
    findUsages: vi.fn(async () => []),
    deleteObject: vi.fn(async (k: string) => {
      calls.push(`storage:${k}`);
    }),
    markDeleted: vi.fn(async () => {
      calls.push("db");
      return true;
    }),
    log: { warn: vi.fn() },
    ...over,
  };
  return { deps, calls };
}

describe("deleteAsset lifecycle", () => {
  it("deletes storage object (key from the DB row) THEN the record", async () => {
    const { deps, calls } = makeDeps();
    const out = await deleteAsset(ORG, ID, deps);
    expect(out).toEqual({ status: "deleted", assetId: ID });
    expect(calls).toEqual(["storage:key_1", "db"]);
  });

  it("looks the asset up inside the caller's organization", async () => {
    const { deps } = makeDeps();
    await deleteAsset(ORG, ID, deps);
    expect(deps.getAsset).toHaveBeenCalledWith(ORG, ID);
    expect(deps.findUsages).toHaveBeenCalledWith(ORG, ID);
    expect(deps.markDeleted).toHaveBeenCalledWith(ORG, ID);
  });

  it("foreign / missing asset → NotFound, nothing deleted", async () => {
    const { deps, calls } = makeDeps({ getAsset: vi.fn(async () => null) });
    await expect(deleteAsset("org_other", ID, deps)).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toEqual([]);
    expect(deps.findUsages).not.toHaveBeenCalled();
  });

  it("referenced asset is refused: no storage call, no DB write", async () => {
    const usages: AssetUsage[] = [{ kind: "page", id: "p1", name: "Landing" }];
    const { deps, calls } = makeDeps({ findUsages: vi.fn(async () => usages) });
    const out = await deleteAsset(ORG, ID, deps);
    expect(out).toEqual({ status: "in_use", assetId: ID, usages });
    expect(calls).toEqual([]);
  });

  it("storage failure → throws, DB untouched (asset stays visible & retryable)", async () => {
    const { deps, calls } = makeDeps({
      deleteObject: vi.fn(async () => {
        throw new Error("uploadthing 500");
      }),
    });
    const err = await deleteAsset(ORG, ID, deps).catch((e) => e);
    expect(err).toBeInstanceOf(AssetDeleteError);
    expect(err.stage).toBe("storage");
    expect(calls).toEqual([]);
    expect(deps.markDeleted).not.toHaveBeenCalled();
  });

  it("DB failure after storage deletion → throws (never reports success)", async () => {
    const { deps } = makeDeps({
      markDeleted: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    const err = await deleteAsset(ORG, ID, deps).catch((e) => e);
    expect(err).toBeInstanceOf(AssetDeleteError);
    expect(err.stage).toBe("database");
  });

  it("retry after a DB failure succeeds (storage delete is idempotent)", async () => {
    let first = true;
    const { deps, calls } = makeDeps({
      markDeleted: vi.fn(async () => {
        if (first) {
          first = false;
          throw new Error("transient");
        }
        calls.push("db");
        return true;
      }),
    });
    await expect(deleteAsset(ORG, ID, deps)).rejects.toBeInstanceOf(AssetDeleteError);
    await expect(deleteAsset(ORG, ID, deps)).resolves.toMatchObject({ status: "deleted" });
    expect(calls.filter((c) => c === "storage:key_1")).toHaveLength(2);
  });

  it("inline-only SVG (no storage key) skips the storage call", async () => {
    const { deps, calls } = makeDeps({
      getAsset: vi.fn(async () => ({ ...ASSET, storage_path: null }) as Asset),
    });
    await expect(deleteAsset(ORG, ID, deps)).resolves.toMatchObject({ status: "deleted" });
    expect(deps.deleteObject).not.toHaveBeenCalled();
    expect(calls).toEqual(["db"]);
  });

  it("concurrent deletion (row already gone) is still success, with a warning", async () => {
    const { deps } = makeDeps({ markDeleted: vi.fn(async () => false) });
    await expect(deleteAsset(ORG, ID, deps)).resolves.toMatchObject({ status: "deleted" });
    expect(deps.log.warn).toHaveBeenCalled();
  });
});

describe("describeUsages", () => {
  it("summarizes and truncates", () => {
    const usages: AssetUsage[] = Array.from({ length: 7 }, (_, i) => ({
      kind: i === 0 ? "published_version" : "page",
      id: String(i),
      name: `P${i}`,
    }));
    const text = describeUsages(usages);
    expect(text).toContain("published funnel “P0”");
    expect(text).toContain("and 2 more");
  });
});
