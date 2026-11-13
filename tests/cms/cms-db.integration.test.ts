/**
 * DB-backed checks of the CMS write layer + usage detection against real
 * Postgres: transactional creates, hard-delete cascades, server-side
 * in-use protection, reference integrity, option propagation and tenant
 * (funnel) isolation. Skipped unless TEST_DATABASE_URL points at a scratch
 * database that has the project's migrations applied (it inserts and deletes
 * rows):
 *
 *   createdb thawkit_test && DATABASE_URL=postgres://… npx drizzle-kit migrate
 *   TEST_DATABASE_URL=postgres://… npx vitest run --config tests/vitest.config.ts tests/cms
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

// guards.ts also exports the Better Auth–backed `requireCampaignScope`; these
// tests only use its DB-only `requireCollectionInFunnel`, so keep auth (and its
// env validation) out of the import graph. Auth/permission wiring is covered by
// collection-actions.test.ts.
vi.mock("@/lib/auth/require-campaign-permission", () => ({
  requireCampaignEditPermission: vi.fn(),
}));

const URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!URL)("CMS write layer (real Postgres)", () => {
  let pool: Pool;
  let mut: typeof import("@/lib/editor/write/collection-mutations");
  let usage: typeof import("@/lib/collection-usage-utils");

  const run = randomUUID().slice(0, 8);
  const org = `org_${run}`;
  const orgOther = `orgO_${run}`;
  const A = { organizationId: org, funnelId: `fun_${run}` };
  const B = { organizationId: orgOther, funnelId: `funO_${run}` };

  async function seed(o: string, funnel: string) {
    await pool.query(`INSERT INTO organization (id, name, created_at) VALUES ($1, $1, now())`, [o]);
    await pool.query(`INSERT INTO campaigns (id, organization_id, name) VALUES ($1, $2, 'c')`, [`camp_${funnel}`, o]);
    await pool.query(`INSERT INTO funnels (id, organization_id, campaign_id, name) VALUES ($1, $2, $3, 'F')`, [funnel, o, `camp_${funnel}`]);
  }
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await pool.query(sql, params)).rows as T[];
  const key = (fields: Array<{ key: string | null; id: string }>, k: string) =>
    fields.find((f) => f.key === k)!.id;
  const addPage = (funnel: string, layers: unknown, settings: unknown = {}) =>
    pool.query(
      `INSERT INTO pages (id, funnel_id, slug, name, "order", page_type, layers, settings)
       VALUES ($1, $2, $3, $4, 0, 'normal_page', $5::jsonb, $6::jsonb)`,
      [`pg_${randomUUID().slice(0, 8)}`, funnel, `s_${randomUUID().slice(0, 6)}`, "Landing", JSON.stringify(layers), JSON.stringify(settings)],
    );

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    pool = new Pool({ connectionString: URL });
    mut = await import("@/lib/editor/write/collection-mutations");
    usage = await import("@/lib/collection-usage-utils");
    await seed(org, A.funnelId);
    await seed(orgOther, B.funnelId);
  });

  afterAll(async () => {
    await pool?.query(`DELETE FROM organization WHERE id = ANY($1)`, [[org, orgOther]]);
    await pool?.end();
  });

  describe("collections", () => {
    it("creates a collection with the five built-in fields (no status) in one go", async () => {
      const { collection, fields } = await mut.createCollection(A, { name: "Posts" });
      expect(collection.name).toBe("Posts");
      expect(fields.map((f) => f.key)).toEqual(["id", "name", "slug", "created_at", "updated_at"]);
      expect(fields.map((f) => f.order)).toEqual([0, 1, 2, 3, 4]);
      const rows = await q(`SELECT is_published, funnel_id FROM collections WHERE id = $1`, [collection.id]);
      expect(rows).toEqual([{ is_published: false, funnel_id: A.funnelId }]);
    });

    it("assigns increasing order", async () => {
      const a = await mut.createCollection(A, { name: "O1" });
      const b = await mut.createCollection(A, { name: "O2" });
      expect(b.collection.order).toBe(a.collection.order + 1);
    });

    it("reorders collections and rejects foreign ids", async () => {
      const a = await mut.createCollection(A, { name: "R1" });
      const b = await mut.createCollection(A, { name: "R2" });
      await mut.reorderCollections(A, [b.collection.id, a.collection.id]);
      const rows = await q<{ id: string; order: number }>(`SELECT id, "order" FROM collections WHERE id = ANY($1)`, [[a.collection.id, b.collection.id]]);
      expect(rows.find((r) => r.id === b.collection.id)!.order).toBe(0);
      expect(rows.find((r) => r.id === a.collection.id)!.order).toBe(1);
      const foreign = await mut.createCollection(B, { name: "Foreign" });
      await expect(mut.reorderCollections(A, [a.collection.id, foreign.collection.id])).rejects.toThrow(/not found/i);
    });

    it("validates and persists sorting", async () => {
      const { collection, fields } = await mut.createCollection(A, { name: "Sorted" });
      const updated = await mut.updateCollection(A, collection.id, { sorting: { field: key(fields, "name"), direction: "asc" } });
      expect(updated.sorting).toEqual({ field: key(fields, "name"), direction: "asc" });
      await expect(
        mut.updateCollection(A, collection.id, { sorting: { field: randomUUID(), direction: "asc" } }),
      ).rejects.toThrow(/sort field/i);
      await expect(mut.updateCollection(A, collection.id, { sorting: { field: "manual_order", direction: "manual" } })).resolves.toBeTruthy();
    });
  });

  describe("fields", () => {
    it("inserts custom fields before the trailing date built-ins and keeps order contiguous", async () => {
      const { collection, fields } = await mut.createCollection(A, { name: "FieldOrder" });
      const f = await mut.createField(A, collection.id, { name: "Body", type: "rich_text" });
      expect(f.key).toBeNull();
      expect(f.order).toBe(3);
      const rows = await q<{ key: string | null; order: number }>(
        `SELECT key, "order" FROM collection_fields WHERE collection_id = $1 ORDER BY "order"`, [collection.id]);
      expect(rows.map((r) => r.order)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(rows.map((r) => r.key)).toEqual(["id", "name", "slug", null, "created_at", "updated_at"]);
      void fields;
    });

    it("never lets a client create or rename into a built-in key", async () => {
      const { collection, fields } = await mut.createCollection(A, { name: "NoKey" });
      await expect(mut.updateField(A, key(fields, "name"), { name: "Title" })).rejects.toThrow(/built-in/i);
      await expect(mut.deleteField(A, key(fields, "slug"))).rejects.toThrow(/built-in/i);
      // hiding a built-in is allowed
      await expect(mut.updateField(A, key(fields, "slug"), { hidden: true })).resolves.toMatchObject({ hidden: true });
      void collection;
    });

    it("requires a valid reference target in the same funnel", async () => {
      const { collection } = await mut.createCollection(A, { name: "Ref" });
      const foreign = await mut.createCollection(B, { name: "ForeignTarget" });
      await expect(mut.createField(A, collection.id, { name: "R", type: "reference" })).rejects.toThrow(/reference/i);
      await expect(
        mut.createField(A, collection.id, { name: "R", type: "reference", reference_collection_id: foreign.collection.id }),
      ).rejects.toThrow(/not found/i);
      await expect(
        mut.createField(A, collection.id, { name: "R", type: "reference", reference_collection_id: randomUUID() }),
      ).rejects.toThrow(/not found/i);
    });

    it("rejects duplicate option names and validates count config", async () => {
      const posts = await mut.createCollection(A, { name: "CountPosts" });
      const authors = await mut.createCollection(A, { name: "CountAuthors" });
      await expect(
        mut.createField(A, posts.collection.id, { name: "Status", type: "option", data: { options: [{ id: "1", name: "A" }, { id: "2", name: "a" }] } }),
      ).rejects.toThrow(/duplicate/i);
      const author = await mut.createField(A, posts.collection.id, { name: "Author", type: "reference", reference_collection_id: authors.collection.id });
      // count must target a reference field that points back at THIS collection
      await expect(
        mut.createField(A, authors.collection.id, { name: "Posts", type: "count", data: { count: { collectionId: posts.collection.id, fieldId: author.id } } }),
      ).resolves.toMatchObject({ type: "count" });
      await expect(
        mut.createField(A, posts.collection.id, { name: "Bad", type: "count", data: { count: { collectionId: posts.collection.id, fieldId: author.id } } }),
      ).rejects.toThrow(/reference field/i);
    });

    it("renames option values in items and clears removed ones", async () => {
      const { collection, fields } = await mut.createCollection(A, { name: "Opts" });
      const opt = await mut.createField(A, collection.id, {
        name: "Stage", type: "option",
        data: { options: [{ id: "a", name: "Draft" }, { id: "b", name: "Live" }, { id: "c", name: "Old" }] },
      });
      const mk = (name: string, stage: string) =>
        mut.createItem(A, collection.id, { [key(fields, "name")]: name, [key(fields, "slug")]: name.toLowerCase(), [opt.id]: stage });
      const i1 = await mk("One", "Draft");
      const i2 = await mk("Two", "Old");
      await expect(mk("Three", "Nope")).rejects.toThrow(/valid option/i);

      await mut.updateField(A, opt.id, {
        data: { options: [{ id: "a", name: "Drafts" }, { id: "b", name: "Live" }] }, // rename a, remove c
      });
      const vals = await q<{ item_id: string; value: string }>(
        `SELECT item_id, value FROM collection_item_values WHERE field_id = $1`, [opt.id]);
      expect(vals.find((v) => v.item_id === i1.id)?.value).toBe("Drafts");
      expect(vals.find((v) => v.item_id === i2.id)).toBeUndefined();
    });
  });

  describe("items", () => {
    let c: Awaited<ReturnType<typeof mut.createCollection>>;
    let nameId: string, slugId: string;
    beforeAll(async () => {
      c = await mut.createCollection(A, { name: "Items" });
      nameId = key(c.fields, "name");
      slugId = key(c.fields, "slug");
    });

    it("creates an item with server-maintained id and dates, and returns its values", async () => {
      const i1 = await mut.createItem(A, c.collection.id, { [nameId]: "Hello", [slugId]: "hello" });
      expect(i1.values[nameId]).toBe("Hello");
      expect(i1.values[key(c.fields, "id")]).toBe("1");
      expect(i1.values[key(c.fields, "created_at")]).toBeTruthy();
      const i2 = await mut.createItem(A, c.collection.id, { [nameId]: "World", [slugId]: "world" });
      expect(i2.values[key(c.fields, "id")]).toBe("2");
      // manual_order is a bigint — must advance numerically, not concatenate
      expect(i2.manual_order).toBe(i1.manual_order + 1);
    });

    it("requires name and slug and enforces slug uniqueness (server-side)", async () => {
      await expect(mut.createItem(A, c.collection.id, { [slugId]: "x" })).rejects.toThrow(/name is required/i);
      await expect(mut.createItem(A, c.collection.id, { [nameId]: "X" })).rejects.toThrow(/slug is required/i);
      await expect(mut.createItem(A, c.collection.id, { [nameId]: "Dup", [slugId]: "hello" })).rejects.toThrow(/slug already exists/i);
    });

    it("rejects unknown fields and ignores writes to server-owned built-ins", async () => {
      await expect(mut.createItem(A, c.collection.id, { [randomUUID()]: "x", [nameId]: "N", [slugId]: "n" })).rejects.toThrow(/unknown field/i);
      const idField = key(c.fields, "id");
      const item = await mut.createItem(A, c.collection.id, { [nameId]: "Sys", [slugId]: "sys", [idField]: "9999" });
      expect(item.values[idField]).not.toBe("9999");
    });

    it("updates values, bumps updated_at, and allows keeping its own slug", async () => {
      const item = await mut.createItem(A, c.collection.id, { [nameId]: "Upd", [slugId]: "upd" });
      const before = item.values[key(c.fields, "updated_at")];
      await new Promise((r) => setTimeout(r, 15));
      const saved = await mut.updateItem(A, c.collection.id, item.id, { [nameId]: "Upd 2", [slugId]: "upd" });
      expect(saved.values[nameId]).toBe("Upd 2");
      expect(saved.values[key(c.fields, "updated_at")]).not.toBe(before);
      // clearing a value removes the row
      const field = await mut.createField(A, c.collection.id, { name: "Note", type: "text" });
      await mut.updateItem(A, c.collection.id, item.id, { [field.id]: "hi" });
      const cleared = await mut.updateItem(A, c.collection.id, item.id, { [field.id]: "" });
      expect(cleared.values[field.id]).toBeUndefined();
    });

    it("validates typed values (number / email)", async () => {
      const num = await mut.createField(A, c.collection.id, { name: "Qty", type: "number" });
      const mail = await mut.createField(A, c.collection.id, { name: "Mail", type: "email" });
      await expect(mut.createItem(A, c.collection.id, { [nameId]: "T", [slugId]: "t1", [num.id]: "abc" })).rejects.toThrow(/number/i);
      await expect(mut.createItem(A, c.collection.id, { [nameId]: "T", [slugId]: "t2", [mail.id]: "nope" })).rejects.toThrow();
      await expect(mut.createItem(A, c.collection.id, { [nameId]: "T", [slugId]: "t3", [num.id]: 4, [mail.id]: "a@b.co" })).resolves.toBeTruthy();
    });

    it("404s for an item from a different collection", async () => {
      const other = await mut.createCollection(A, { name: "OtherCol" });
      const item = await mut.createItem(A, c.collection.id, { [nameId]: "Mine", [slugId]: "mine" });
      await expect(mut.updateItem(A, other.collection.id, item.id, {})).rejects.toThrow(/item not found/i);
      await expect(mut.duplicateItem(A, other.collection.id, item.id)).rejects.toThrow(/item not found/i);
    });

    it("duplicates with a unique slug, '(Copy)' name and a fresh built-in id", async () => {
      const src = await mut.createItem(A, c.collection.id, { [nameId]: "Orig", [slugId]: "orig" });
      const copy = await mut.duplicateItem(A, c.collection.id, src.id);
      const copy2 = await mut.duplicateItem(A, c.collection.id, src.id);
      expect(copy.values[nameId]).toBe("Orig (Copy)");
      expect(copy.values[slugId]).not.toBe("orig");
      expect(copy2.values[slugId]).not.toBe(copy.values[slugId]);
      expect(Number(copy.values[key(c.fields, "id")])).toBeGreaterThan(Number(src.values[key(c.fields, "id")]));
    });

    it("hard-deletes items and their values (cascade) — only within the collection", async () => {
      const x = await mut.createItem(A, c.collection.id, { [nameId]: "Del", [slugId]: "del" });
      const other = await mut.createCollection(A, { name: "DelOther" });
      expect(await mut.deleteItems(A, other.collection.id, [x.id])).toBe(0); // wrong collection → untouched
      expect((await q(`SELECT 1 FROM collection_items WHERE id = $1`, [x.id])).length).toBe(1);
      expect(await mut.deleteItems(A, c.collection.id, [x.id])).toBe(1);
      expect((await q(`SELECT 1 FROM collection_items WHERE id = $1`, [x.id])).length).toBe(0);
      expect((await q(`SELECT 1 FROM collection_item_values WHERE item_id = $1`, [x.id])).length).toBe(0);
    });

    it("reorders items", async () => {
      const a = await mut.createItem(A, c.collection.id, { [nameId]: "Ra", [slugId]: "ra" });
      const b = await mut.createItem(A, c.collection.id, { [nameId]: "Rb", [slugId]: "rb" });
      await mut.reorderItems(A, c.collection.id, [{ id: a.id, manual_order: 500 }, { id: b.id, manual_order: 400 }]);
      const rows = await q<{ id: string; manual_order: string }>(`SELECT id, manual_order FROM collection_items WHERE id = ANY($1)`, [[a.id, b.id]]);
      expect(Number(rows.find((r) => r.id === a.id)!.manual_order)).toBe(500);
      await expect(mut.reorderItems(A, c.collection.id, [{ id: randomUUID(), manual_order: 1 }])).rejects.toThrow(/not found/i);
    });
  });

  describe("reference integrity", () => {
    it("only accepts items that exist in the referenced collection", async () => {
      const people = await mut.createCollection(A, { name: "People" });
      const posts = await mut.createCollection(A, { name: "PostsRef" });
      const ref = await mut.createField(A, posts.collection.id, { name: "Author", type: "reference", reference_collection_id: people.collection.id });
      const multi = await mut.createField(A, posts.collection.id, { name: "Editors", type: "multi_reference", reference_collection_id: people.collection.id });
      const pName = key(people.fields, "name"), pSlug = key(people.fields, "slug");
      const person = await mut.createItem(A, people.collection.id, { [pName]: "Ann", [pSlug]: "ann" });
      const bad = await mut.createItem(A, posts.collection.id, { [key(posts.fields, "name")]: "X", [key(posts.fields, "slug")]: "x" });

      const base = { [key(posts.fields, "name")]: "P", [key(posts.fields, "slug")]: "p" };
      await expect(mut.createItem(A, posts.collection.id, { ...base, [ref.id]: randomUUID() })).rejects.toThrow(/referenced item not found/i);
      await expect(mut.createItem(A, posts.collection.id, { ...base, [ref.id]: bad.id })).rejects.toThrow(/referenced item not found/i); // item of the WRONG collection
      await expect(mut.createItem(A, posts.collection.id, { ...base, [multi.id]: [person.id, randomUUID()] })).rejects.toThrow(/not found/i);
      const ok = await mut.createItem(A, posts.collection.id, { ...base, [ref.id]: person.id, [multi.id]: [person.id] });
      expect(ok.values[ref.id]).toBe(person.id);
      expect(JSON.parse(ok.values[multi.id])).toEqual([person.id]);
    });
  });

  describe("usage detection + server-side delete protection", () => {
    it("blocks deleting a collection used by a page binding, then allows it once removed", async () => {
      const { collection } = await mut.createCollection(A, { name: "Used" });
      const layers = [{ id: "root", children: [{ id: "list", variables: { collection: { id: collection.id } } }] }];
      await addPage(A.funnelId, layers);

      const u = await usage.getCollectionUsage(A, collection.id);
      expect(u.pages.map((p) => p.name)).toEqual(["Landing"]);
      expect(u.total).toBe(1);
      await expect(mut.deleteCollection(A, collection.id)).rejects.toThrow(/still in use/i);
      expect((await q(`SELECT 1 FROM collections WHERE id = $1`, [collection.id])).length).toBe(1);

      await pool.query(`DELETE FROM pages WHERE funnel_id = $1 AND layers::text LIKE $2`, [A.funnelId, `%${collection.id}%`]);
      await mut.deleteCollection(A, collection.id);
      // hard delete: collection and (cascade) its fields are gone
      expect((await q(`SELECT 1 FROM collections WHERE id = $1`, [collection.id])).length).toBe(0);
      expect((await q(`SELECT 1 FROM collection_fields WHERE collection_id = $1`, [collection.id])).length).toBe(0);
    });

    it("detects page settings stored as a JSON string (the column's default shape)", async () => {
      const { collection } = await mut.createCollection(A, { name: "DynPage" });
      await pool.query(
        `INSERT INTO pages (id, funnel_id, slug, name, "order", page_type, layers, settings)
         VALUES ($1, $2, $3, 'Dyn', 1, 'normal_page', '[]'::jsonb, to_jsonb($4::text))`,
        [`pg_${randomUUID().slice(0, 8)}`, A.funnelId, `d_${randomUUID().slice(0, 6)}`, JSON.stringify({ cms: { collection_id: collection.id } })],
      );
      const u = await usage.getCollectionUsage(A, collection.id);
      expect(u.pages.map((p) => p.name)).toEqual(["Dyn"]);
    });

    it("detects component usage (organization-scoped) and option-source bindings", async () => {
      const { collection } = await mut.createCollection(A, { name: "CompUsed" });
      await pool.query(
        `INSERT INTO component (id, organization_id, name, layers) VALUES ($1, $2, 'Card', $3::jsonb)`,
        [`cmp_${randomUUID().slice(0, 8)}`, org, JSON.stringify([{ id: "s", settings: { optionsSource: { collectionId: collection.id } } }])],
      );
      const u = await usage.getCollectionUsage(A, collection.id);
      expect(u.components.map((c) => c.name)).toEqual(["Card"]);
      await expect(mut.deleteCollection(A, collection.id)).rejects.toThrow(/in use/i);
    });

    it("does not report another tenant's pages or components", async () => {
      const { collection } = await mut.createCollection(A, { name: "Tenant" });
      await addPage(B.funnelId, [{ id: "x", variables: { collection: { id: collection.id } } }]);
      await pool.query(
        `INSERT INTO component (id, organization_id, name, layers) VALUES ($1, $2, 'Theirs', $3::jsonb)`,
        [`cmp_${randomUUID().slice(0, 8)}`, orgOther, JSON.stringify([{ variables: { collection: { id: collection.id } } }])],
      );
      const u = await usage.getCollectionUsage(A, collection.id);
      expect(u.total).toBe(0);
      await expect(mut.deleteCollection(A, collection.id)).resolves.toBeUndefined();
    });

    it("blocks deleting a collection that another collection references or counts", async () => {
      const authors = await mut.createCollection(A, { name: "UAuthors" });
      const posts = await mut.createCollection(A, { name: "UPosts" });
      const ref = await mut.createField(A, posts.collection.id, { name: "Author", type: "reference", reference_collection_id: authors.collection.id });
      const u = await usage.getCollectionUsage(A, authors.collection.id);
      expect(u.referenceFields.map((f) => f.name)).toEqual(["Author"]);
      await expect(mut.deleteCollection(A, authors.collection.id)).rejects.toThrow(/in use/i);

      // a count field on authors pointing at posts.Author depends on that reference field
      const count = await mut.createField(A, authors.collection.id, { name: "Posts", type: "count", data: { count: { collectionId: posts.collection.id, fieldId: ref.id } } });
      const fu = await usage.getCollectionFieldUsage(A, ref.id);
      expect(fu.dependentFields.map((f) => f.id)).toEqual([count.id]);
      await expect(mut.deleteField(A, ref.id)).rejects.toThrow(/still in use/i);
      await mut.deleteField(A, count.id); // remove the dependent first…
      await mut.deleteField(A, ref.id); // …then the reference field goes
      expect((await q(`SELECT 1 FROM collection_fields WHERE id = $1`, [ref.id])).length).toBe(0);
    });

    it("blocks deleting a field bound on a page, and resets sorting when its field is deleted", async () => {
      const { collection } = await mut.createCollection(A, { name: "FieldUse" });
      const f = await mut.createField(A, collection.id, { name: "Price", type: "number" });
      const g = await mut.createField(A, collection.id, { name: "Rank", type: "number" });
      await mut.updateCollection(A, collection.id, { sorting: { field: g.id, direction: "desc" } });
      await addPage(A.funnelId, [{ id: "t", variables: { text: { type: "dynamic_rich_text", data: { content: { type: "doc", content: [{ type: "text", marks: [{ type: "dynamicVariable", attrs: { variable: { type: "field", data: { field_id: f.id } } } }] }] } } } } }]);
      await expect(mut.deleteField(A, f.id)).rejects.toThrow(/still in use/i);
      await mut.deleteField(A, g.id);
      const [row] = await q<{ sorting: unknown }>(`SELECT sorting FROM collections WHERE id = $1`, [collection.id]);
      expect(row.sorting).toBeNull();
    });
  });

  describe("tenant isolation", () => {
    it("a scope for funnel B cannot read, change or delete funnel A's data by id", async () => {
      const a = await mut.createCollection(A, { name: "Private" });
      const nameId = key(a.fields, "name"), slugId = key(a.fields, "slug");
      const item = await mut.createItem(A, a.collection.id, { [nameId]: "Secret", [slugId]: "secret" });

      await expect(mut.updateCollection(B, a.collection.id, { name: "Hacked" })).rejects.toThrow(/not found/i);
      await expect(mut.deleteCollection(B, a.collection.id)).rejects.toThrow(/not found/i);
      await expect(mut.createField(B, a.collection.id, { name: "X", type: "text" })).rejects.toThrow(/not found/i);
      await expect(mut.updateField(B, nameId, { hidden: true })).rejects.toThrow(/not found/i);
      await expect(mut.deleteField(B, a.fields[a.fields.length - 1].id)).rejects.toThrow(/not found/i);
      await expect(mut.reorderFields(B, a.collection.id, [nameId])).rejects.toThrow(/not found/i);
      await expect(mut.createItem(B, a.collection.id, { [nameId]: "x", [slugId]: "x" })).rejects.toThrow(/not found/i);
      await expect(mut.updateItem(B, a.collection.id, item.id, { [nameId]: "x" })).rejects.toThrow(/not found/i);
      await expect(mut.duplicateItem(B, a.collection.id, item.id)).rejects.toThrow(/not found/i);
      await expect(mut.deleteItems(B, a.collection.id, [item.id])).rejects.toThrow(/not found/i);
      await expect(usage.getCollectionUsage(B, a.collection.id)).resolves.toMatchObject({ total: 0 }); // guarded one layer up (action)

      const [still] = await q<{ name: string }>(`SELECT name FROM collections WHERE id = $1`, [a.collection.id]);
      expect(still.name).toBe("Private");
      expect((await q(`SELECT 1 FROM collection_items WHERE id = $1`, [item.id])).length).toBe(1);
    });

    it("rejects a reference to a collection in another funnel", async () => {
      const mine = await mut.createCollection(A, { name: "Mine2" });
      const theirs = await mut.createCollection(B, { name: "Theirs2" });
      await expect(
        mut.createField(A, mine.collection.id, { name: "R", type: "reference", reference_collection_id: theirs.collection.id }),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe("sample collections", () => {
    it("creates fields and items, with a unique name and no status field", async () => {
      const first = await mut.createSampleCollection(A, "blog-posts");
      const second = await mut.createSampleCollection(A, "blog-posts");
      expect(second.collection.name).not.toBe(first.collection.name);
      expect(first.items.length).toBeGreaterThan(0);
      expect(first.fields.some((f) => (f.type as string) === "status")).toBe(false);
      const nameId = first.fields.find((f) => f.key === "name")!.id;
      const slugId = first.fields.find((f) => f.key === "slug")!.id;
      for (const item of first.items) {
        expect(item.values[nameId]).toBeTruthy();
        expect(item.values[slugId]).toBeTruthy();
      }
      // custom sample fields stay editable (no built-in key)
      expect(first.fields.filter((f) => f.key === null).length).toBeGreaterThan(0);
      const [n] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM collection_items WHERE collection_id = $1`, [first.collection.id]);
      expect(n.n).toBe(first.items.length);
    });

    it("404s for an unknown sample id", async () => {
      await expect(mut.createSampleCollection(A, "nope")).rejects.toThrow(/not found/i);
    });
  });
});
