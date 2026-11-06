/**
 * Real-Postgres checks of the media-library management layer: folder
 * hierarchy, the virtual "All files" root, custom SVG icons, moves, counts,
 * cascade deletion safety, and authorization through the REAL guard.
 * Skipped unless TEST_DATABASE_URL points at a scratch database that has the
 * project's migrations applied (it inserts and removes its own rows).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

const URL = process.env.TEST_DATABASE_URL;

let currentUser: { id: string } | null = null;
vi.mock("@/lib/sessionServer", () => ({
  getServerSession: async () =>
    currentUser ? { user: { banned: false, ...currentUser }, session: { impersonatedBy: null } } : null,
}));
const storageCalls: string[] = [];
let failStorageOn: string | null = null;
vi.mock("@/lib/assets/uploadthing-server", () => ({
  deleteStoredObject: async (key: string) => {
    if (failStorageOn === key) throw new Error("uploadthing unavailable");
    storageCalls.push(key);
  },
}));

const CLEAN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';

describe.skipIf(!URL)("media library management (real Postgres)", () => {
  let pool: Pool;
  let repo: typeof import("@/lib/assets/asset-repository");
  let svc: typeof import("@/lib/assets/library-service");
  let usage: typeof import("@/lib/assets/asset-usage");
  let actions: typeof import("@/actions/editor/asset-actions");
  let queries: typeof import("@/lib/editor/read/asset-queries");
  let errors: typeof import("@/lib/errors");

  const run = randomUUID().slice(0, 8);
  const ids = {
    orgA: `la_${run}`, orgB: `lb_${run}`,
    alice: `lalice_${run}`, bob: `lbob_${run}`, carol: `lcarol_${run}`,
    campA: `lca_${run}`, campB: `lcb_${run}`,
  };
  let seq = 0;

  const deps = () => ({
    getAsset: repo.getDraftAsset,
    findUsages: usage.findAssetUsages,
    markDeleted: repo.markAssetDeleted,
    deleteObject: async (k: string) => {
      if (failStorageOn === k) throw new Error("uploadthing unavailable");
      storageCalls.push(k);
    },
    log: { warn: () => {} },
  });

  const uploaded = async (org: string, folder: string | null, key = `k_${run}_${++seq}`) =>
    (await repo.insertAssetIdempotent({
      organizationId: org, assetFolderId: folder, filename: `${key}.png`, storagePath: key,
      publicUrl: `https://x.ufs.sh/f/${key}`, fileSize: 1, mimeType: "image/png",
      width: 1, height: 1, content: null, contentHash: "0".repeat(64),
    })).asset;

  const reference = (assetId: string) =>
    pool.query(
      `INSERT INTO pages (id, funnel_id, slug, name, "order", page_type, layers) VALUES ($1,$2,$3,'Landing',0,'landing_page',$4::jsonb)`,
      [`pg_${run}_${++seq}`, `fun_${ids.orgA}`, `p${seq}`, JSON.stringify([{ variables: { image: { src: { type: "asset", data: { asset_id: assetId } } } } }])],
    );

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    pool = new Pool({ connectionString: URL });
    repo = await import("@/lib/assets/asset-repository");
    svc = await import("@/lib/assets/library-service");
    usage = await import("@/lib/assets/asset-usage");
    actions = await import("@/actions/editor/asset-actions");
    queries = await import("@/lib/editor/read/asset-queries");
    errors = await import("@/lib/errors");

    for (const org of [ids.orgA, ids.orgB]) {
      await pool.query(`INSERT INTO organization (id, name, created_at) VALUES ($1,$1,now())`, [org]);
    }
    for (const u of [ids.alice, ids.bob, ids.carol]) {
      await pool.query(`INSERT INTO "user" (id, name, email, email_verified) VALUES ($1,$1,$1||'@t.dev',true)`, [u]);
    }
    const member = (org: string, user: string, role: string) =>
      pool.query(`INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ($1,$2,$3,$4,now())`, [randomUUID(), org, user, role]);
    await member(ids.orgA, ids.alice, "admin");
    await member(ids.orgB, ids.bob, "owner");
    await pool.query(`INSERT INTO campaigns (id, organization_id, name) VALUES ($1,$2,'A'),($3,$4,'B')`, [ids.campA, ids.orgA, ids.campB, ids.orgB]);
    await pool.query(`INSERT INTO funnels (id, organization_id, campaign_id, name) VALUES ($1,$2,$3,'FA'),($4,$5,$6,'FB')`, [`fun_${ids.orgA}`, ids.orgA, ids.campA, `fun_${ids.orgB}`, ids.orgB, ids.campB]);
  });

  afterAll(async () => {
    for (const org of [ids.orgA, ids.orgB]) await pool.query(`DELETE FROM organization WHERE id=$1`, [org]);
    for (const u of [ids.alice, ids.bob, ids.carol]) await pool.query(`DELETE FROM "user" WHERE id=$1`, [u]);
    await pool.end();
  });

  beforeEach(() => {
    currentUser = null;
    failStorageOn = null;
    storageCalls.length = 0;
  });

  // ── folders ────────────────────────────────────────────────────────────────
  describe("folders", () => {
    it("creates top-level folders directly under the virtual 'All files' root (parent null, depth 0, appended order)", async () => {
      const a = await svc.createFolder(ids.orgA, { name: "  Brand  ", parentId: null });
      const b = await svc.createFolder(ids.orgA, { name: "Photos", parentId: null });
      expect(a).toMatchObject({ name: "Brand", asset_folder_id: null, depth: 0, order: 0, is_published: false });
      expect(b).toMatchObject({ asset_folder_id: null, depth: 0, order: a.order + 1 });
    });

    it("nests folders and tracks depth", async () => {
      const root = await svc.createFolder(ids.orgA, { name: "L0", parentId: null });
      const l1 = await svc.createFolder(ids.orgA, { name: "L1", parentId: root.id });
      const l2 = await svc.createFolder(ids.orgA, { name: "L2", parentId: l1.id });
      expect([l1.depth, l2.depth]).toEqual([1, 2]);
      expect(l2.asset_folder_id).toBe(l1.id);
    });

    it("validates names", async () => {
      await expect(svc.createFolder(ids.orgA, { name: "   ", parentId: null })).rejects.toBeInstanceOf(errors.ValidationError);
      await expect(svc.createFolder(ids.orgA, { name: "x".repeat(101), parentId: null })).rejects.toBeInstanceOf(errors.ValidationError);
      const f = await svc.createFolder(ids.orgA, { name: "a\u0000b", parentId: null });
      expect(f.name).toBe("ab");
    });

    it("rejects another organization's (or a missing) parent", async () => {
      const foreign = await svc.createFolder(ids.orgB, { name: "Bobs", parentId: null });
      await expect(svc.createFolder(ids.orgA, { name: "x", parentId: foreign.id })).rejects.toBeInstanceOf(errors.NotFoundError);
      await expect(svc.createFolder(ids.orgA, { name: "x", parentId: randomUUID() })).rejects.toBeInstanceOf(errors.NotFoundError);
    });

    it("renames, and re-parents with the depth of the WHOLE branch rewritten", async () => {
      const a = await svc.createFolder(ids.orgA, { name: "A", parentId: null });
      const b = await svc.createFolder(ids.orgA, { name: "B", parentId: a.id });
      const c = await svc.createFolder(ids.orgA, { name: "C", parentId: b.id });
      const d = await svc.createFolder(ids.orgA, { name: "D", parentId: null });

      const renamed = await svc.updateFolder(ids.orgA, a.id, { name: "A2" });
      expect(renamed.folder.name).toBe("A2");
      expect(renamed.depths).toEqual({});

      const moved = await svc.updateFolder(ids.orgA, a.id, { parentId: d.id });
      expect(moved.folder.asset_folder_id).toBe(d.id);
      expect(moved.depths).toEqual({ [a.id]: 1, [b.id]: 2, [c.id]: 3 });
      const stored = Object.fromEntries((await repo.listDraftFolders(ids.orgA)).map((f) => [f.id, f.depth]));
      expect([stored[a.id], stored[b.id], stored[c.id]]).toEqual([1, 2, 3]);

      const back = await svc.updateFolder(ids.orgA, a.id, { parentId: null });
      expect(back.depths).toEqual({ [a.id]: 0, [b.id]: 1, [c.id]: 2 });
    });

    it("refuses to move a folder into itself or its own subtree", async () => {
      const a = await svc.createFolder(ids.orgA, { name: "A", parentId: null });
      const b = await svc.createFolder(ids.orgA, { name: "B", parentId: a.id });
      await expect(svc.updateFolder(ids.orgA, a.id, { parentId: a.id })).rejects.toBeInstanceOf(errors.ValidationError);
      await expect(svc.updateFolder(ids.orgA, a.id, { parentId: b.id })).rejects.toBeInstanceOf(errors.ValidationError);
    });

    it("can't touch another organization's folder", async () => {
      const foreign = await svc.createFolder(ids.orgB, { name: "Bobs", parentId: null });
      await expect(svc.updateFolder(ids.orgA, foreign.id, { name: "hijack" })).rejects.toBeInstanceOf(errors.NotFoundError);
      expect((await repo.getDraftFolder(ids.orgB, foreign.id))?.name).toBe("Bobs");
    });
  });

  // ── "All files" root vs folders (the real SQL) ─────────────────────────────
  describe("'All files' root semantics", () => {
    it("root lists only assets with no regular folder; a folder lists only its own; counts agree", async () => {
      const f = await svc.createFolder(ids.orgA, { name: "Root-test", parentId: null });
      const inRoot = await uploaded(ids.orgA, null);
      const inFolder = await uploaded(ids.orgA, f.id);

      const root = await queries.queryAssetsPage(ids.orgA, { folderId: null, limit: 200 } as never);
      expect(root.assets.map((a) => a.id)).toContain(inRoot.id);
      expect(root.assets.map((a) => a.id)).not.toContain(inFolder.id);
      expect(root.assets.every((a) => a.asset_folder_id === null)).toBe(true);

      const folder = await queries.queryAssetsPage(ids.orgA, { folderId: f.id, limit: 200 } as never);
      expect(folder.assets.map((a) => a.id)).toEqual([inFolder.id]);

      const counts = await repo.countDraftAssetsByFolder(ids.orgA);
      expect(counts[f.id]).toBe(1);
      expect(counts.root).toBe(root.total);
    });

    it("counts only this organization's live assets", async () => {
      const mine = await repo.countDraftAssetsByFolder(ids.orgA);
      await uploaded(ids.orgB, null);
      expect(await repo.countDraftAssetsByFolder(ids.orgA)).toEqual(mine);
      const gone = await uploaded(ids.orgA, null);
      const before = (await repo.countDraftAssetsByFolder(ids.orgA)).root;
      await repo.markAssetDeleted(ids.orgA, gone.id);
      expect((await repo.countDraftAssetsByFolder(ids.orgA)).root).toBe(before - 1);
    });
  });

  // ── custom SVG icons & asset edits ─────────────────────────────────────────
  describe("custom SVG assets", () => {
    it("stores an inline-only SVG (no stored file), sanitized, sized, hashed", async () => {
      const a = await svc.createSvgAsset(ids.orgA, { name: "my-icon", folderId: null, content: `<?xml version="1.0"?><!-- c -->${CLEAN_SVG}` });
      expect(a).toMatchObject({
        filename: "my-icon", mime_type: "image/svg+xml", storage_path: null, public_url: null,
        asset_folder_id: null, width: 24, height: 24, source: "library",
      });
      expect(a.content!.startsWith("<svg")).toBe(true);
      expect(a.content).not.toContain("<!--");
      expect(a.content_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("rejects active/invalid SVG and nothing is stored", async () => {
      const before = (await repo.countDraftAssetsByFolder(ids.orgA)).root ?? 0;
      await expect(svc.createSvgAsset(ids.orgA, { name: "x", folderId: null, content: CLEAN_SVG.replace("<path", "<script>1</script><path") })).rejects.toBeInstanceOf(errors.ValidationError);
      await expect(svc.createSvgAsset(ids.orgA, { name: "x", folderId: null, content: "not svg" })).rejects.toBeInstanceOf(errors.ValidationError);
      await expect(svc.createSvgAsset(ids.orgA, { name: "  ", folderId: null, content: CLEAN_SVG })).rejects.toBeInstanceOf(errors.ValidationError);
      expect((await repo.countDraftAssetsByFolder(ids.orgA)).root ?? 0).toBe(before);
    });

    it("creates into a folder; a foreign folder is refused", async () => {
      const f = await svc.createFolder(ids.orgA, { name: "Icons", parentId: null });
      const a = await svc.createSvgAsset(ids.orgA, { name: "in-folder", folderId: f.id, content: CLEAN_SVG });
      expect(a.asset_folder_id).toBe(f.id);
      const foreign = await svc.createFolder(ids.orgB, { name: "Bobs", parentId: null });
      await expect(svc.createSvgAsset(ids.orgA, { name: "x", folderId: foreign.id, content: CLEAN_SVG })).rejects.toBeInstanceOf(errors.NotFoundError);
    });

    it("renames, moves (folder ↔ All files), and edits inline markup (re-sanitized)", async () => {
      const f = await svc.createFolder(ids.orgA, { name: "Move-target", parentId: null });
      const a = await svc.createSvgAsset(ids.orgA, { name: "edit-me", folderId: null, content: CLEAN_SVG });

      const renamed = await svc.updateAssetDetails(ids.orgA, a.id, { filename: "renamed" });
      expect(renamed.filename).toBe("renamed");

      const moved = await svc.updateAssetDetails(ids.orgA, a.id, { folderId: f.id });
      expect(moved.asset_folder_id).toBe(f.id);
      const home = await svc.updateAssetDetails(ids.orgA, a.id, { folderId: null });
      expect(home.asset_folder_id).toBeNull();

      const newMarkup = CLEAN_SVG.replace("M0 0h24v24H0z", "M1 1h5v5H1z");
      const edited = await svc.updateAssetDetails(ids.orgA, a.id, { content: newMarkup });
      expect(edited.content).toContain("M1 1h5v5H1z");
      expect(edited.content_hash).not.toBe(a.content_hash);
      await expect(svc.updateAssetDetails(ids.orgA, a.id, { content: "<svg onload='x()'/>" })).rejects.toBeInstanceOf(errors.ValidationError);
      expect((await repo.getDraftAsset(ids.orgA, a.id))!.content).toContain("M1 1h5v5H1z"); // unchanged by the rejected edit
    });

    it("the markup of an UPLOADED svg (or a non-svg) is not editable", async () => {
      const png = await uploaded(ids.orgA, null);
      await expect(svc.updateAssetDetails(ids.orgA, png.id, { content: CLEAN_SVG })).rejects.toBeInstanceOf(errors.ValidationError);
      const up = await repo.insertAssetIdempotent({
        organizationId: ids.orgA, assetFolderId: null, filename: "up.svg", storagePath: `k_${run}_svg`,
        publicUrl: "https://x.ufs.sh/f/svg", fileSize: 1, mimeType: "image/svg+xml", width: 24, height: 24,
        content: CLEAN_SVG, contentHash: "0".repeat(64),
      });
      await expect(svc.updateAssetDetails(ids.orgA, up.asset.id, { content: CLEAN_SVG.replace("0 0h24", "1 1h24") })).rejects.toBeInstanceOf(errors.ValidationError);
      // renaming it is fine
      expect((await svc.updateAssetDetails(ids.orgA, up.asset.id, { filename: "ok.svg" })).filename).toBe("ok.svg");
    });

    it("another organization's asset is untouchable", async () => {
      const foreign = await uploaded(ids.orgB, null);
      await expect(svc.updateAssetDetails(ids.orgA, foreign.id, { filename: "hijack" })).rejects.toBeInstanceOf(errors.NotFoundError);
      expect((await repo.getDraftAsset(ids.orgB, foreign.id))!.filename).toBe(foreign.filename);
    });
  });

  describe("bulk move", () => {
    it("moves only this organization's assets and ignores foreign ids", async () => {
      const f = await svc.createFolder(ids.orgA, { name: "Bulk", parentId: null });
      const mine1 = await uploaded(ids.orgA, null);
      const mine2 = await uploaded(ids.orgA, null);
      const foreign = await uploaded(ids.orgB, null);
      const moved = await svc.moveAssets(ids.orgA, [mine1.id, mine2.id, foreign.id], f.id);
      expect(moved.sort()).toEqual([mine1.id, mine2.id].sort());
      expect((await repo.getDraftAsset(ids.orgB, foreign.id))!.asset_folder_id).toBeNull();
      // back to All files
      expect((await svc.moveAssets(ids.orgA, [mine1.id], null))).toEqual([mine1.id]);
      expect((await repo.getDraftAsset(ids.orgA, mine1.id))!.asset_folder_id).toBeNull();
    });
    it("a foreign destination folder is refused", async () => {
      const a = await uploaded(ids.orgA, null);
      const foreign = await svc.createFolder(ids.orgB, { name: "Bobs", parentId: null });
      await expect(svc.moveAssets(ids.orgA, [a.id], foreign.id)).rejects.toBeInstanceOf(errors.NotFoundError);
    });
  });

  // ── folder deletion ────────────────────────────────────────────────────────
  describe("folder deletion", () => {
    async function tree() {
      const top = await svc.createFolder(ids.orgA, { name: "Del-top", parentId: null });
      const sub = await svc.createFolder(ids.orgA, { name: "Del-sub", parentId: top.id });
      const a1 = await uploaded(ids.orgA, top.id);
      const a2 = await uploaded(ids.orgA, sub.id);
      const keep = await uploaded(ids.orgA, null);
      return { top, sub, a1, a2, keep };
    }

    it("deletes the folder, subfolders and contained files (stored objects too); other files untouched", async () => {
      const { top, sub, a1, a2, keep } = await tree();
      const out = await svc.deleteFolder(ids.orgA, top.id, deps());
      expect(out.status).toBe("deleted");
      expect(storageCalls.sort()).toEqual([a1.storage_path, a2.storage_path].sort());
      expect(await repo.getDraftFolder(ids.orgA, top.id)).toBeNull();
      expect(await repo.getDraftFolder(ids.orgA, sub.id)).toBeNull();
      expect(await repo.getDraftAsset(ids.orgA, a1.id)).toBeNull();
      expect(await repo.getDraftAsset(ids.orgA, a2.id)).toBeNull();
      expect(await repo.getDraftAsset(ids.orgA, keep.id)).not.toBeNull();
    });

    it("an empty folder deletes cleanly", async () => {
      const f = await svc.createFolder(ids.orgA, { name: "Empty", parentId: null });
      expect((await svc.deleteFolder(ids.orgA, f.id, deps())).status).toBe("deleted");
      expect(storageCalls).toEqual([]);
    });

    it("refuses — deleting NOTHING — while a file in a SUBfolder is still referenced", async () => {
      const { top, sub, a1, a2 } = await tree();
      await reference(a2.id);
      const out = await svc.deleteFolder(ids.orgA, top.id, deps());
      expect(out.status).toBe("in_use");
      if (out.status === "in_use") expect(out.blocked.map((b) => b.assetId)).toEqual([a2.id]);
      expect(storageCalls).toEqual([]);
      expect(await repo.getDraftFolder(ids.orgA, top.id)).not.toBeNull();
      expect(await repo.getDraftFolder(ids.orgA, sub.id)).not.toBeNull();
      expect(await repo.getDraftAsset(ids.orgA, a1.id)).not.toBeNull();
    });

    it("a storage failure stops the cascade: folder stays, retry completes it", async () => {
      const { top, a1, a2 } = await tree();
      failStorageOn = a2.storage_path;
      await expect(svc.deleteFolder(ids.orgA, top.id, deps())).rejects.toThrow(/storage/i);
      expect(await repo.getDraftFolder(ids.orgA, top.id)).not.toBeNull(); // not reported deleted
      expect(await repo.getDraftAsset(ids.orgA, a2.id)).not.toBeNull();

      failStorageOn = null;
      const retry = await svc.deleteFolder(ids.orgA, top.id, deps());
      expect(retry.status).toBe("deleted");
      expect(await repo.getDraftFolder(ids.orgA, top.id)).toBeNull();
      expect(await repo.getDraftAsset(ids.orgA, a1.id)).toBeNull();
    });

    it("another organization's folder can't be deleted", async () => {
      const foreign = await svc.createFolder(ids.orgB, { name: "Bobs", parentId: null });
      await expect(svc.deleteFolder(ids.orgA, foreign.id, deps())).rejects.toBeInstanceOf(errors.NotFoundError);
      expect(await repo.getDraftFolder(ids.orgB, foreign.id)).not.toBeNull();
    });
  });

  describe("bulk delete", () => {
    it("reports deleted / in-use / failed individually and keeps the latter two", async () => {
      const ok = await uploaded(ids.orgA, null);
      const used = await uploaded(ids.orgA, null);
      const bad = await uploaded(ids.orgA, null);
      await reference(used.id);
      failStorageOn = bad.storage_path;
      const out = await svc.bulkDeleteAssets(ids.orgA, [ok.id, used.id, bad.id, randomUUID()], deps());
      expect(out.deleted).toEqual([ok.id]);
      expect(out.inUse.map((x) => x.assetId)).toEqual([used.id]);
      expect(out.failed.map((x) => x.assetId)).toContain(bad.id);
      expect(await repo.getDraftAsset(ids.orgA, ok.id)).toBeNull();
      expect(await repo.getDraftAsset(ids.orgA, used.id)).not.toBeNull();
      expect(await repo.getDraftAsset(ids.orgA, bad.id)).not.toBeNull();
    });
  });

  // ── actions through the REAL authorization guard ───────────────────────────
  describe("server actions (real guard)", () => {
    it("anonymous / non-member callers can't create or modify anything", async () => {
      expect((await actions.createFolderAction(ids.campA, { name: "x", parentId: null })).success).toBe(false);
      currentUser = { id: ids.carol };
      expect((await actions.createFolderAction(ids.campA, { name: "x", parentId: null })).success).toBe(false);
      expect((await actions.createSvgAssetAction(ids.campA, { name: "x", folderId: null, content: CLEAN_SVG })).success).toBe(false);
      expect((await actions.getAssetFolderCountsAction(ids.campA)).success).toBe(false);
    });

    it("members create folders, SVG icons and read counts for THEIR organization", async () => {
      currentUser = { id: ids.alice };
      const made = await actions.createFolderAction(ids.campA, { name: "via-action", parentId: null });
      expect(made.success && made.data.name).toBe("via-action");
      const svg = await actions.createSvgAssetAction(ids.campA, { name: "act-icon", folderId: made.success ? made.data.id : null, content: CLEAN_SVG });
      expect(svg.success).toBe(true);
      const counts = await actions.getAssetFolderCountsAction(ids.campA);
      expect(counts.success && made.success && counts.data[made.data.id]).toBe(1);
    });

    it("CROSS-TENANT: org B's owner can't use org A's folders/assets, even through his own campaign", async () => {
      const aFolder = await svc.createFolder(ids.orgA, { name: "A-private", parentId: null });
      const aAsset = await uploaded(ids.orgA, null);
      currentUser = { id: ids.bob };

      // positive control: Bob IS authorized in his own campaign (so the denials below are about tenancy)
      const own = await actions.createFolderAction(ids.campB, { name: "bobs-own", parentId: null });
      expect(own.success).toBe(true);

      expect((await actions.createFolderAction(ids.campA, { name: "x", parentId: null })).success).toBe(false); // A's campaign
      expect((await actions.createFolderAction(ids.campB, { name: "x", parentId: aFolder.id })).success).toBe(false); // smuggled parent
      expect((await actions.updateFolderAction(ids.campB, aFolder.id, { name: "hijack" })).success).toBe(false);
      expect((await actions.deleteFolderAction(ids.campB, aFolder.id)).success).toBe(false);
      expect((await actions.updateAssetAction(ids.campB, aAsset.id, { filename: "hijack" })).success).toBe(false);
      const moveRes = await actions.moveAssetsAction(ids.campB, [aAsset.id], null);
      expect(moveRes).toEqual({ success: true, data: { movedIds: [] } }); // authorized call, but nothing of A's is visible
      expect((await repo.getDraftAsset(ids.orgA, aAsset.id))!.asset_folder_id).toBeNull(); // …that moved nothing of A's
      const bulk = await actions.bulkDeleteAssetsAction(ids.campB, [aAsset.id]);
      expect(bulk.success && bulk.data.deleted).toEqual([]);
      expect(bulk.success && bulk.data.failed.map((f) => f.assetId)).toEqual([aAsset.id]); // reported as not found
      expect((await actions.getAssetUsageAction(ids.campB, aAsset.id)).success).toBe(false);

      expect((await repo.getDraftFolder(ids.orgA, aFolder.id))!.name).toBe("A-private");
      expect((await repo.getDraftAsset(ids.orgA, aAsset.id))!.filename).toBe(aAsset.filename);
      expect(storageCalls).toEqual([]);
    });

    it("deleteFolderAction reports IN_USE with the blocking file and deletes nothing", async () => {
      const f = await svc.createFolder(ids.orgA, { name: "act-del", parentId: null });
      const a = await uploaded(ids.orgA, f.id);
      await reference(a.id);
      currentUser = { id: ids.alice };
      const res = await actions.deleteFolderAction(ids.campA, f.id);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("IN_USE");
        expect(res.error).toContain(a.filename);
        expect(res.blocked?.[0].usages[0]).toMatchObject({ kind: "page", name: "Landing" });
      }
      expect(await repo.getDraftFolder(ids.orgA, f.id)).not.toBeNull();
    });

    it("validates payloads (bad ids / oversize) without touching data", async () => {
      currentUser = { id: ids.alice };
      expect((await actions.updateFolderAction(ids.campA, "not-a-uuid", { name: "x" })).success).toBe(false);
      expect((await actions.moveAssetsAction(ids.campA, [], null)).success).toBe(false);
      expect((await actions.createFolderAction(ids.campA, { name: "x", parentId: "not-a-uuid" })).success).toBe(false);
    });
  });
});
