/**
 * DB-backed checks of the SQL the asset library depends on: the idempotency
 * index, tenant scoping and the reference scan. Skipped unless
 * TEST_DATABASE_URL points at a database that has the project's migrations
 * applied (a scratch database — it inserts and deletes rows):
 *
 *   createdb thawkit_test && DATABASE_URL=postgres://… npx drizzle-kit migrate
 *   TEST_DATABASE_URL=postgres://… npx vitest run --config tests/vitest.config.ts tests/assets
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!URL)("asset library SQL (real Postgres)", () => {
  let pool: Pool;
  let repo: typeof import("@/lib/assets/asset-repository");
  let usage: typeof import("@/lib/assets/asset-usage");
  let lifecycle: typeof import("@/lib/assets/delete-asset");

  const run = randomUUID().slice(0, 8);
  const orgA = `orgA_${run}`;
  const orgB = `orgB_${run}`;

  async function seedOrg(org: string) {
    await pool.query(
      `INSERT INTO organization (id, name, created_at) VALUES ($1, $1, now())`,
      [org],
    );
    await pool.query(`INSERT INTO campaigns (id, organization_id, name) VALUES ($1, $2, 'c')`, [`camp_${org}`, org]);
    await pool.query(`INSERT INTO funnels (id, organization_id, campaign_id, name) VALUES ($1, $2, $3, 'Funnel ' || $2)`, [`fun_${org}`, org, `camp_${org}`]);
  }

  async function newAsset(org: string, key: string, over: Record<string, unknown> = {}) {
    return repo.insertAssetIdempotent({
      organizationId: org,
      assetFolderId: null,
      filename: "a.png",
      storagePath: key,
      publicUrl: `https://x.ufs.sh/f/${key}`,
      fileSize: 10,
      mimeType: "image/png",
      width: 1,
      height: 1,
      content: null,
      contentHash: "0".repeat(64),
      ...over,
    });
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    pool = new Pool({ connectionString: URL });
    repo = await import("@/lib/assets/asset-repository");
    usage = await import("@/lib/assets/asset-usage");
    lifecycle = await import("@/lib/assets/delete-asset");
    await seedOrg(orgA);
    await seedOrg(orgB);
  });

  afterAll(async () => {
    for (const org of [orgA, orgB]) {
      await pool.query(`DELETE FROM organization WHERE id = $1`, [org]); // cascades
    }
    await pool.end();
  });

  it("insert is idempotent on storage key (callback redelivery)", async () => {
    const key = `k_${run}_1`;
    const first = await newAsset(orgA, key);
    const second = await newAsset(orgA, key);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.asset.id).toBe(first.asset.id);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM assets WHERE storage_path = $1`, [key]);
    expect(rows[0].n).toBe(1);
  });

  it("persists the metadata that deletion and rendering rely on", async () => {
    const { asset } = await newAsset(orgA, `k_${run}_meta`, {
      mimeType: "image/svg+xml",
      content: "<svg/>",
      width: 24,
      height: 24,
    });
    expect(asset).toMatchObject({
      storage_path: `k_${run}_meta`,
      public_url: `https://x.ufs.sh/f/k_${run}_meta`,
      mime_type: "image/svg+xml",
      content: "<svg/>",
      source: "library",
      is_published: false,
      deleted_at: null,
    });
  });

  it("is tenant-scoped: another org cannot read or delete the asset", async () => {
    const { asset } = await newAsset(orgA, `k_${run}_tenant`);
    expect(await repo.getDraftAsset(orgB, asset.id)).toBeNull();
    expect(await repo.markAssetDeleted(orgB, asset.id)).toBe(false);
    expect(await repo.getDraftAsset(orgA, asset.id)).not.toBeNull();
  });

  it("soft delete hides the row, is idempotent, and the key stays reserved", async () => {
    const key = `k_${run}_del`;
    const { asset } = await newAsset(orgA, key);
    expect(await repo.markAssetDeleted(orgA, asset.id)).toBe(true);
    expect(await repo.markAssetDeleted(orgA, asset.id)).toBe(false);
    expect(await repo.getDraftAsset(orgA, asset.id)).toBeNull();
    expect(await repo.findAssetByStorageKey(key)).toBeNull();
    // a soft-deleted row still owns its key → surfaced, not silently duplicated
    await expect(newAsset(orgA, key)).rejects.toThrow(/conflict/i);
  });

  it("rejects non-UUID ids without querying", async () => {
    expect(await repo.getDraftAsset(orgA, "not-a-uuid")).toBeNull();
    expect(await repo.markAssetDeleted(orgA, "' OR 1=1 --")).toBe(false);
  });

  it("validates target folders per organization", async () => {
    const folderId = randomUUID();
    await pool.query(`INSERT INTO asset_folders (id, organization_id, name) VALUES ($1, $2, 'F')`, [folderId, orgA]);
    expect(await repo.folderBelongsToOrganization(orgA, folderId)).toBe(true);
    expect(await repo.folderBelongsToOrganization(orgB, folderId)).toBe(false);
    expect(await repo.folderBelongsToOrganization(orgA, randomUUID())).toBe(false);
  });

  describe("reference scan", () => {
    async function seedReferences(org: string, assetId: string) {
      const layers = JSON.stringify([
        { id: "l1", name: "image", variables: { image: { src: { type: "asset", data: { asset_id: assetId } } } } },
      ]);
      await pool.query(
        `INSERT INTO pages (id, funnel_id, slug, name, "order", page_type, layers) VALUES ($1,$2,$4,'Home ' || $2,0,'landing_page',$3::jsonb)`,
        [`pg_${org}_${assetId.slice(0, 4)}`, `fun_${org}`, layers, `home-${assetId.slice(0, 8)}`],
      );
    }

    it("finds nothing for an unreferenced asset", async () => {
      const { asset } = await newAsset(orgA, `k_${run}_unref`);
      expect(await usage.findAssetUsages(orgA, asset.id)).toEqual([]);
    });

    it("finds page, component, layer style, CMS value and CURRENT published snapshot; ignores old versions", async () => {
      const { asset } = await newAsset(orgA, `k_${run}_refs`);
      const id = asset.id;
      await seedReferences(orgA, id);
      await pool.query(`INSERT INTO component (id, organization_id, name, layers) VALUES ($1,$2,'Hero',$3::jsonb)`, [`cmp_${run}`, orgA, JSON.stringify([{ bg: `url(https://x/${id})` }])]);
      await pool.query(`INSERT INTO layer_style (id, organization_id, name, design) VALUES ($1,$2,'Style',$3::jsonb)`, [`ls_${run}`, orgA, JSON.stringify({ backgrounds: { image: id } })]);

      const collectionId = randomUUID();
      const itemId = randomUUID();
      const fieldId = randomUUID();
      await pool.query(`INSERT INTO collections (id, funnel_id, name) VALUES ($1,$2,'Products')`, [collectionId, `fun_${orgA}`]);
      await pool.query(`INSERT INTO collection_fields (id, collection_id, name, type, "order") VALUES ($1,$2,'img','image',0)`, [fieldId, collectionId]);
      await pool.query(`INSERT INTO collection_items (id, collection_id) VALUES ($1,$2)`, [itemId, collectionId]);
      await pool.query(`INSERT INTO collection_item_values (item_id, field_id, value) VALUES ($1,$2,$3)`, [itemId, fieldId, id]);

      await pool.query(`INSERT INTO funnel_version (id, funnel_id, version_number, compiled_schema, is_current) VALUES ($1,$2,1,$3::jsonb,false)`, [`v1_${run}`, `fun_${orgA}`, JSON.stringify({ pages: [{ layers: [{ asset: { id } }] }] })]);
      await pool.query(`INSERT INTO funnel_version (id, funnel_id, version_number, compiled_schema, is_current) VALUES ($1,$2,2,$3::jsonb,true)`, [`v2_${run}`, `fun_${orgA}`, JSON.stringify({ pages: [{ layers: [{ asset: { id } }] }] })]);

      const found = await usage.findAssetUsages(orgA, id);
      const kinds = found.map((u) => u.kind).sort();
      expect(kinds).toEqual(["cms_item", "component", "layer_style", "page", "published_version"]);
      // only the CURRENT version, not the historical one
      expect(found.filter((u) => u.kind === "published_version").map((u) => u.id)).toEqual([`v2_${run}`]);
    });

    it("never reports another organization's references (even for the same id text)", async () => {
      const { asset } = await newAsset(orgA, `k_${run}_iso`);
      await seedReferences(orgB, asset.id); // org B references the id text
      expect(await usage.findAssetUsages(orgA, asset.id)).toEqual([]);
      expect((await usage.findAssetUsages(orgB, asset.id)).map((u) => u.kind)).toEqual(["page"]);
    });

    it("full lifecycle on the real DB: blocked while referenced, deleted once the reference is gone", async () => {
      const { asset } = await newAsset(orgA, `k_${run}_life`);
      await seedReferences(orgA, asset.id);
      const storage: string[] = [];
      const deps = {
        getAsset: repo.getDraftAsset,
        findUsages: usage.findAssetUsages,
        markDeleted: repo.markAssetDeleted,
        deleteObject: async (k: string) => void storage.push(k),
        log: { warn: () => {} },
      };

      const blocked = await lifecycle.deleteAsset(orgA, asset.id, deps);
      expect(blocked.status).toBe("in_use");
      expect(storage).toEqual([]);
      expect(await repo.getDraftAsset(orgA, asset.id)).not.toBeNull();

      await pool.query(`DELETE FROM pages WHERE id = $1`, [`pg_${orgA}_${asset.id.slice(0, 4)}`]);
      const done = await lifecycle.deleteAsset(orgA, asset.id, deps);
      expect(done.status).toBe("deleted");
      expect(storage).toEqual([`k_${run}_life`]);
      expect(await repo.getDraftAsset(orgA, asset.id)).toBeNull();
    });
  });
});
