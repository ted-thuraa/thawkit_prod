/**
 * End-to-end (server side) check of `deleteAssetAction` against a real
 * Postgres: the REAL authorization guard (`requireCampaignScope` →
 * `requireOrgPermission`), tenancy queries, reference scan and soft delete.
 * Only two things are faked: the session lookup and UploadThing's network call.
 * Skipped unless TEST_DATABASE_URL is set (see assets-db.integration.test.ts).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

const URL = process.env.TEST_DATABASE_URL;

let currentUser: { id: string; banned?: boolean } | null = null;
vi.mock("@/lib/sessionServer", () => ({
  getServerSession: async () =>
    currentUser ? { user: { banned: false, ...currentUser }, session: { impersonatedBy: null } } : null,
}));

const storageCalls: string[] = [];
let storageFails = false;
vi.mock("@/lib/assets/uploadthing-server", () => ({
  deleteStoredObject: async (key: string) => {
    if (storageFails) throw new Error("uploadthing unavailable");
    storageCalls.push(key);
  },
}));

describe.skipIf(!URL)("deleteAssetAction (real guard + real DB)", () => {
  let pool: Pool;
  let deleteAssetAction: typeof import("@/actions/editor/asset-actions").deleteAssetAction;
  let repo: typeof import("@/lib/assets/asset-repository");

  const run = randomUUID().slice(0, 8);
  const ids = {
    orgA: `oa_${run}`, orgB: `ob_${run}`,
    alice: `alice_${run}`, bob: `bob_${run}`, carol: `carol_${run}`, dave: `dave_${run}`,
    campA: `ca_${run}`, campB: `cb_${run}`,
  };

  const insertAsset = async (org: string, key: string) =>
    (await repo.insertAssetIdempotent({
      organizationId: org, assetFolderId: null, filename: `${key}.png`, storagePath: key,
      publicUrl: `https://x.ufs.sh/f/${key}`, fileSize: 1, mimeType: "image/png",
      width: 1, height: 1, content: null, contentHash: "0".repeat(64),
    })).asset;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    pool = new Pool({ connectionString: URL });
    repo = await import("@/lib/assets/asset-repository");
    ({ deleteAssetAction } = await import("@/actions/editor/asset-actions"));

    for (const org of [ids.orgA, ids.orgB]) {
      await pool.query(`INSERT INTO organization (id, name, created_at) VALUES ($1,$1,now())`, [org]);
    }
    for (const [u, banned] of [[ids.alice, false], [ids.bob, false], [ids.carol, false], [ids.dave, true]] as const) {
      await pool.query(`INSERT INTO "user" (id, name, email, email_verified, banned) VALUES ($1,$1,$1||'@t.dev',true,$2)`, [u, banned]);
    }
    const member = (org: string, user: string, role: string) =>
      pool.query(`INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ($1,$2,$3,$4,now())`, [randomUUID(), org, user, role]);
    await member(ids.orgA, ids.alice, "admin");
    await member(ids.orgA, ids.dave, "member"); // banned account
    await member(ids.orgB, ids.bob, "owner");
    // carol belongs to no organization
    await pool.query(`INSERT INTO campaigns (id, organization_id, name) VALUES ($1,$2,'A')`, [ids.campA, ids.orgA]);
    await pool.query(`INSERT INTO campaigns (id, organization_id, name) VALUES ($1,$2,'B')`, [ids.campB, ids.orgB]);
    await pool.query(`INSERT INTO funnels (id, organization_id, campaign_id, name) VALUES ($1,$2,$3,'FA')`, [`fa_${run}`, ids.orgA, ids.campA]);
  });

  afterAll(async () => {
    for (const org of [ids.orgA, ids.orgB]) await pool.query(`DELETE FROM organization WHERE id=$1`, [org]);
    for (const u of [ids.alice, ids.bob, ids.carol, ids.dave]) await pool.query(`DELETE FROM "user" WHERE id=$1`, [u]);
    await pool.end();
  });

  beforeEach(() => {
    currentUser = null;
    storageFails = false;
    storageCalls.length = 0;
  });

  it("unauthenticated → refused, nothing touched", async () => {
    const a = await insertAsset(ids.orgA, `k_${run}_anon`);
    const res = await deleteAssetAction(ids.campA, a.id);
    expect(res.success).toBe(false);
    expect(storageCalls).toEqual([]);
    expect(await repo.getDraftAsset(ids.orgA, a.id)).not.toBeNull();
  });

  it("non-member of the organization → refused", async () => {
    const a = await insertAsset(ids.orgA, `k_${run}_nm`);
    currentUser = { id: ids.carol };
    expect((await deleteAssetAction(ids.campA, a.id)).success).toBe(false);
    expect(storageCalls).toEqual([]);
    expect(await repo.getDraftAsset(ids.orgA, a.id)).not.toBeNull();
  });

  it("banned member → refused", async () => {
    const a = await insertAsset(ids.orgA, `k_${run}_ban`);
    currentUser = { id: ids.dave, banned: true };
    expect((await deleteAssetAction(ids.campA, a.id)).success).toBe(false);
    expect(await repo.getDraftAsset(ids.orgA, a.id)).not.toBeNull();
  });

  it("CROSS-TENANT: org B's owner cannot delete org A's asset via A's campaign", async () => {
    const a = await insertAsset(ids.orgA, `k_${run}_xt1`);
    currentUser = { id: ids.bob };
    expect((await deleteAssetAction(ids.campA, a.id)).success).toBe(false);
    expect(storageCalls).toEqual([]);
    expect(await repo.getDraftAsset(ids.orgA, a.id)).not.toBeNull();
  });

  it("CROSS-TENANT: org B's owner cannot delete org A's asset via B's OWN campaign (id smuggling)", async () => {
    const a = await insertAsset(ids.orgA, `k_${run}_xt2`);
    currentUser = { id: ids.bob };
    const res = await deleteAssetAction(ids.campB, a.id);
    expect(res.success).toBe(false);
    expect(storageCalls).toEqual([]); // no storage call for a foreign key
    expect(await repo.getDraftAsset(ids.orgA, a.id)).not.toBeNull();
  });

  it("authorized member deletes: storage object (key from the DB row) then record", async () => {
    const a = await insertAsset(ids.orgA, `k_${run}_ok`);
    currentUser = { id: ids.alice };
    const res = await deleteAssetAction(ids.campA, a.id);
    expect(res).toEqual({ success: true, data: { assetId: a.id } });
    expect(storageCalls).toEqual([`k_${run}_ok`]);
    expect(await repo.getDraftAsset(ids.orgA, a.id)).toBeNull();
    // retrying an already-deleted asset is a clean failure, not a crash
    expect((await deleteAssetAction(ids.campA, a.id)).success).toBe(false);
  });

  it("referenced asset → IN_USE with usage list; storage and DB untouched", async () => {
    const a = await insertAsset(ids.orgA, `k_${run}_used`);
    await pool.query(
      `INSERT INTO pages (id, funnel_id, slug, name, "order", page_type, layers) VALUES ($1,$2,'p','Landing',0,'landing_page',$3::jsonb)`,
      [`pg_${run}`, `fa_${run}`, JSON.stringify([{ variables: { image: { src: { type: "asset", data: { asset_id: a.id } } } } }])],
    );
    currentUser = { id: ids.alice };
    const res = await deleteAssetAction(ids.campA, a.id);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.code).toBe("IN_USE");
      expect(res.usages).toEqual([{ kind: "page", id: `pg_${run}`, name: "Landing" }]);
      expect(res.error).toContain("Landing");
    }
    expect(storageCalls).toEqual([]);
    expect(await repo.getDraftAsset(ids.orgA, a.id)).not.toBeNull();
  });

  it("storage failure → reported as failure, row stays, retry succeeds", async () => {
    const a = await insertAsset(ids.orgA, `k_${run}_sf`);
    currentUser = { id: ids.alice };
    storageFails = true;
    const first = await deleteAssetAction(ids.campA, a.id);
    expect(first.success).toBe(false);
    expect(await repo.getDraftAsset(ids.orgA, a.id)).not.toBeNull();
    storageFails = false;
    expect((await deleteAssetAction(ids.campA, a.id)).success).toBe(true);
    expect(await repo.getDraftAsset(ids.orgA, a.id)).toBeNull();
  });

  it("rejects malformed ids without touching anything", async () => {
    currentUser = { id: ids.alice };
    expect((await deleteAssetAction(ids.campA, "not-a-uuid")).success).toBe(false);
    expect((await deleteAssetAction("", "x")).success).toBe(false);
    expect(storageCalls).toEqual([]);
  });
});
