/**
 * Quiz sample collection against REAL Postgres: sample instantiation (locked
 * keys, defaults, options data, showWhen → ids), and the server write boundary
 * (cross-field quiz rules, option canonicalisation, org-scoped asset checks,
 * non-destructive type switching, tenancy). Skipped unless TEST_DATABASE_URL
 * points at a scratch database that has the project's migrations applied:
 *
 *   TEST_DATABASE_URL=postgres://… npx vitest run --config tests/vitest.config.ts tests/quiz
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

// guards.ts also exports the Better Auth–backed requireCampaignScope; these tests
// use only the DB-only guards, so keep auth (and its env validation) out of the
// import graph. Auth wiring is covered by tests/cms/collection-actions.test.ts.
vi.mock("@/lib/auth/require-campaign-permission", () => ({
  requireCampaignEditPermission: vi.fn(),
}));

import { QUIZ_FIELD_KEYS, type QuizFieldRole } from "@/lib/quiz";
import { collectReferencedAssetIds } from "@/lib/editor/bootstrap/collect-asset-ids";

const URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!URL)("Quiz sample collection (real Postgres)", () => {
  let pool: Pool;
  let mut: typeof import("@/lib/editor/write/collection-mutations");
  let findAssetUsages: typeof import("@/lib/assets/asset-usage").findAssetUsages;

  const run = randomUUID().slice(0, 8);
  const org = `org_${run}`;
  const orgOther = `orgO_${run}`;
  const A = { organizationId: org, funnelId: `fun_${run}` };
  const B = { organizationId: orgOther, funnelId: `funO_${run}` };

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await pool.query(sql, params)).rows as T[];

  async function seedOrg(o: string, funnel: string) {
    await pool.query(`INSERT INTO organization (id, name, created_at) VALUES ($1, $1, now())`, [o]);
    await pool.query(`INSERT INTO campaigns (id, organization_id, name) VALUES ($1, $2, 'c')`, [`camp_${funnel}`, o]);
    await pool.query(`INSERT INTO funnels (id, organization_id, campaign_id, name) VALUES ($1, $2, $3, 'F')`, [funnel, o, `camp_${funnel}`]);
  }
  const seedAsset = async (organizationId: string, mime: string, name = "a") =>
    (await q<{ id: string }>(
      `INSERT INTO assets (organization_id, filename, public_url, mime_type) VALUES ($1, $2, $3, $4) RETURNING id`,
      [organizationId, `${name}-${randomUUID().slice(0, 4)}`, `https://cdn.test/${name}`, mime],
    ))[0].id;

  type Created = Awaited<ReturnType<typeof import("@/lib/editor/write/collection-mutations").createSampleCollection>>;
  let quiz: Created;
  /** role → field id for the created collection */
  let F: Record<QuizFieldRole, string>;

  /** Build item values by ROLE. */
  const v = (values: Partial<Record<QuizFieldRole, unknown>>) => {
    const out: Record<string, unknown> = {};
    for (const [role, value] of Object.entries(values)) out[F[role as QuizFieldRole]] = value;
    return out;
  };
  const OPTS = [
    { title: "Yes", score: 2 },
    { title: "No", score: 0 },
  ];
  let slugN = 0;
  /** A valid single-choice question (unique title/slug) with optional role-keyed overrides. */
  const choice = (over: Partial<Record<QuizFieldRole, unknown>> = {}) =>
    withSlug({ title: `Question ${slugN + 1}`, questionType: "Single choice", options: OPTS, ...over });
  /** Same, but with a slug and arbitrary overrides (role-keyed). */
  const withSlug = (values: Partial<Record<QuizFieldRole, unknown>>) => ({
    ...v(values),
    [quiz.fields.find((f) => f.key === "slug")!.id]: `s-${run}-${++slugN}`,
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    pool = new Pool({ connectionString: URL });
    mut = await import("@/lib/editor/write/collection-mutations");
    ({ findAssetUsages } = await import("@/lib/assets/asset-usage"));
    await seedOrg(org, A.funnelId);
    await seedOrg(orgOther, B.funnelId);
    quiz = await mut.createSampleCollection(A, "quiz");
    F = Object.fromEntries(
      (Object.entries(QUIZ_FIELD_KEYS) as [QuizFieldRole, string][]).map(([role, key]) => [role, quiz.fields.find((f) => f.key === key)!.id]),
    ) as Record<QuizFieldRole, string>;
  });

  afterAll(async () => {
    await pool?.query(`DELETE FROM organization WHERE id = ANY($1)`, [[org, orgOther]]);
    await pool?.end();
  });

  // ═══ instantiation ═══════════════════════════════════════════════════════
  describe("sample instantiation", () => {
    it("creates the 'Quiz' collection with 28 fields (5 built-in + 23 quiz) and 6 questions", async () => {
      expect(quiz.collection.name).toBe("Quiz");
      expect(quiz.fields).toHaveLength(28);
      expect(quiz.items).toHaveLength(6);
      const [{ n }] = await q<{ n: number }>(`SELECT count(*)::int n FROM collection_items WHERE collection_id = $1`, [quiz.collection.id]);
      expect(n).toBe(6);
    });

    it("persists a LOCKED key for every quiz field and relabels the built-in name 'Question'", async () => {
      const rows = await q<{ key: string | null; name: string; order: number }>(`SELECT key, name, "order" FROM collection_fields WHERE collection_id = $1 ORDER BY "order"`, [quiz.collection.id]);
      expect(rows.map((r) => r.order)).toEqual(rows.map((_, i) => i));
      const keys = rows.map((r) => r.key);
      expect(keys.every((k) => k !== null)).toBe(true);
      for (const key of Object.values(QUIZ_FIELD_KEYS)) expect(keys).toContain(key);
      expect(rows.find((r) => r.key === "name")!.name).toBe("Question");
      expect(keys.slice(0, 3)).toEqual(["id", "name", "slug"]);
      expect(keys.slice(-2)).toEqual(["created_at", "updated_at"]);
    });

    it("stores the template-only answer_options type, option data, defaults and hidden flags", async () => {
      const rows = await q<{ key: string; type: string; default: string | null; hidden: boolean; data: { options?: { id: string; name: string }[] } }>(
        `SELECT key, type, "default", hidden, data FROM collection_fields WHERE collection_id = $1`, [quiz.collection.id]);
      const by = new Map(rows.map((r) => [r.key, r]));
      expect(by.get("options")!.type).toBe("answer_options");
      expect(by.get("question_type")!.default).toBe("Single choice");
      expect(by.get("question_type")!.data.options!.map((o) => o.id)).toEqual(["single_choice", "multiple_choice", "text", "numeric", "sliding_scale"]);
      expect(by.get("required")!.default).toBe("true");
      expect(by.get("character_limit")!.hidden).toBe(true);
      expect(by.get("question_type")!.hidden).toBe(false);
    });

    it("resolves every showWhen to the id of a field IN THIS collection", async () => {
      const rows = await q<{ id: string; key: string; data: { showWhen?: { fieldId: string; equals: string[] }[] } }>(
        `SELECT id, key, data FROM collection_fields WHERE collection_id = $1`, [quiz.collection.id]);
      const ids = new Set(rows.map((r) => r.id));
      const opts = rows.find((r) => r.key === "options")!;
      expect(opts.data.showWhen).toEqual([{ fieldId: F.questionType, equals: ["single_choice", "multiple_choice"] }]);
      for (const r of rows) for (const c of r.data.showWhen ?? []) expect(ids.has(c.fieldId)).toBe(true);
      const fmt = rows.find((r) => r.key === "score_tooltip_format")!;
      expect(fmt.data.showWhen).toEqual([
        { fieldId: F.questionType, equals: ["sliding_scale"] },
        { fieldId: F.showScoreTooltip, equals: ["true"] },
      ]);
    });

    it("stores sample questions with canonical options JSON and the label as the type value", async () => {
      const first = quiz.items[0];
      expect(first.values[F.questionType]).toBe("Single choice");
      const options = JSON.parse(first.values[F.options]);
      expect(options).toHaveLength(4);
      expect(options[0]).toMatchObject({ id: "opt_beginner", title: "Beginner", score: 1 });
    });

    it("creating it twice yields 'Quiz' then 'Quiz 2' with independent field ids", async () => {
      const second = await mut.createSampleCollection(A, "quiz");
      expect(second.collection.name).toBe("Quiz 2");
      const ids = new Set([...quiz.fields, ...second.fields].map((f) => f.id));
      expect(ids.size).toBe(quiz.fields.length + second.fields.length);
    });

    it("leaves the existing samples exactly as before (unlocked, no data / defaults)", async () => {
      const people = await mut.createSampleCollection(A, "people");
      const custom = people.fields.filter((f) => !["id", "name", "slug", "created_at", "updated_at"].includes(f.key ?? ""));
      expect(custom.length).toBeGreaterThan(0);
      for (const f of custom) expect(f.key).toBeNull();
      expect(people.fields.find((f) => f.key === "name")!.name).toBe("Name");
      const rows = await q<{ default: string | null; data: unknown }>(`SELECT "default", data FROM collection_fields WHERE collection_id = $1 AND key IS NULL`, [people.collection.id]);
      for (const r of rows) {
        expect(r.default).toBeNull();
        expect(r.data).toEqual({});
      }
    });

    it("creates the Quiz Categories sample too (unchanged by this feature)", async () => {
      const cats = await mut.createSampleCollection(A, "quiz categories");
      expect(cats.collection.name).toBe("Quiz Categories");
      expect(cats.items.length).toBeGreaterThan(0);
    });
  });

  // ═══ locked structure ═══════════════════════════════════════════════════
  describe("locked quiz fields", () => {
    it("cannot be renamed, retyped, re-defaulted or deleted — only hidden", async () => {
      await expect(mut.updateField(A, F.questionType, { name: "Type" })).rejects.toThrow(/built-in/i);
      await expect(mut.updateField(A, F.questionType, { data: { options: [{ id: "x", name: "X" }] } })).rejects.toThrow(/built-in/i);
      await expect(mut.updateField(A, F.options, { default: "[]" })).rejects.toThrow(/built-in/i);
      await expect(mut.deleteField(A, F.options)).rejects.toThrow(/built-in/i);
      await expect(mut.updateField(A, F.characterLimit, { hidden: false })).resolves.toMatchObject({ hidden: false });
      await mut.updateField(A, F.characterLimit, { hidden: true });
    });
  });

  // ═══ create: choice questions ═══════════════════════════════════════════
  describe("choice questions at the write boundary", () => {
    it("saves options, assigns ids to those without, and stores canonical JSON", async () => {
      const item = await mut.createItem(A, quiz.collection.id, choice({
        options: [
          { title: "  Spaced  ", score: 1.5, description: "  d  ", icon: " 🙂 ", junk: "dropped" },
          { id: "opt_keepme", title: "Keep", score: -1 },
        ],
      }));
      const stored = JSON.parse(item.values[F.options]);
      expect(stored[0].id).toMatch(/^opt_[a-z0-9]{8}$/);
      expect(stored[0]).toEqual({ id: stored[0].id, title: "Spaced", description: "d", score: 1.5, icon: "🙂" });
      expect(stored[1]).toEqual({ id: "opt_keepme", title: "Keep", score: -1 });
      expect(Object.keys(stored[0])).toEqual(["id", "title", "description", "score", "icon"]);
    });

    it("accepts the options as a JSON string too (what the editor widget emits)", async () => {
      const item = await mut.createItem(A, quiz.collection.id, choice({ options: JSON.stringify([{ id: "opt_aaa", title: "A", score: 1 }, { id: "opt_bbb", title: "B", score: 2 }]) }));
      expect(JSON.parse(item.values[F.options])).toHaveLength(2);
    });

    it.each([
      ["fewer than 2 options", [{ title: "Only", score: 1 }], /at least 2/i],
      ["no options at all", [], /at least 2/i],
      ["an empty title", [{ title: "", score: 1 }, { title: "B", score: 1 }], /title is required/i],
      ["a non-numeric score", [{ title: "A", score: "high" }, { title: "B", score: 1 }], /score must be a number/i],
      ["duplicate ids", [{ id: "opt_same", title: "A", score: 1 }, { id: "opt_same", title: "B", score: 1 }], /duplicate/i],
      ["a malformed id", [{ id: "bad id!", title: "A", score: 1 }, { title: "B", score: 1 }], /invalid id/i],
      ["more than 50 options", Array.from({ length: 51 }, (_, i) => ({ title: `o${i}`, score: i })), /at most 50/i],
    ])("rejects %s", async (_label, options, message) => {
      await expect(mut.createItem(A, quiz.collection.id, choice({ options }))).rejects.toThrow(message);
    });

    it("rejects options that are not a JSON list", async () => {
      await expect(mut.createItem(A, quiz.collection.id, choice({ options: "{not json" }))).rejects.toThrow(/not a valid list/i);
      await expect(mut.createItem(A, quiz.collection.id, choice({ options: JSON.stringify({ a: 1 }) }))).rejects.toThrow(/not a valid list/i);
    });

    it("multiple choice is validated the same way", async () => {
      await expect(mut.createItem(A, quiz.collection.id, choice({ questionType: "Multiple choice", options: [{ title: "Solo", score: 1 }] }))).rejects.toThrow(/at least 2/i);
      await expect(mut.createItem(A, quiz.collection.id, choice({ questionType: "Multiple choice" }))).resolves.toBeTruthy();
    });

    it("requires a title and a known question type", async () => {
      const slug = quiz.fields.find((f) => f.key === "slug")!.id;
      await expect(mut.createItem(A, quiz.collection.id, { [slug]: "x", ...v({ questionType: "Text" }) })).rejects.toThrow(/name is required/i);
      await expect(mut.createItem(A, quiz.collection.id, withSlug({ title: "T", questionType: "Nope" }))).rejects.toThrow(/not a valid option/i); // the generic option rule fires first
      await expect(mut.createItem(A, quiz.collection.id, withSlug({ title: "T" }))).rejects.toThrow(/Question type is required/i);
    });
  });

  // ═══ create: other types ════════════════════════════════════════════════
  describe("text, numeric and sliding-scale questions", () => {
    it("text: valid with or without configuration; bounds the character limit", async () => {
      await expect(mut.createItem(A, quiz.collection.id, withSlug({ title: "T", questionType: "Text" }))).resolves.toBeTruthy();
      await expect(mut.createItem(A, quiz.collection.id, withSlug({ title: "T", questionType: "Text", inputType: "Multi line", characterLimit: 500 }))).resolves.toBeTruthy();
      for (const bad of ["0", "10001", "1.5", "abc"]) {
        await expect(mut.createItem(A, quiz.collection.id, withSlug({ title: "T", questionType: "Text", characterLimit: bad }))).rejects.toThrow(/character limit|number/i);
      }
    });

    it("numeric: validates range order and whole numbers", async () => {
      await expect(mut.createItem(A, quiz.collection.id, withSlug({ title: "N", questionType: "Numeric", rangeFrom: 0, rangeTo: 10 }))).resolves.toBeTruthy();
      await expect(mut.createItem(A, quiz.collection.id, withSlug({ title: "N", questionType: "Numeric", rangeFrom: 10, rangeTo: 0 }))).rejects.toThrow(/greater than or equal/i);
      await expect(mut.createItem(A, quiz.collection.id, withSlug({ title: "N", questionType: "Numeric", rangeFrom: 0.5, rangeTo: 3 }))).rejects.toThrow(/whole number/i);
      await expect(mut.createItem(A, quiz.collection.id, withSlug({ title: "N", questionType: "Numeric", rangeFrom: 0.5, rangeTo: 3.5, allowDecimals: true }))).resolves.toBeTruthy();
    });

    it("sliding scale: requires a valid range and a starting score inside it", async () => {
      await expect(mut.createItem(A, quiz.collection.id, withSlug({ title: "S", questionType: "Sliding scale" }))).rejects.toThrow(/Score range from is required/i);
      await expect(mut.createItem(A, quiz.collection.id, withSlug({ title: "S", questionType: "Sliding scale", scoreRangeFrom: 5, scoreRangeTo: 5 }))).rejects.toThrow(/greater than score range from/i);
      await expect(mut.createItem(A, quiz.collection.id, withSlug({ title: "S", questionType: "Sliding scale", scoreRangeFrom: 1, scoreRangeTo: 10, startingScore: 11 }))).rejects.toThrow(/within the score range/i);
      await expect(mut.createItem(A, quiz.collection.id, withSlug({ title: "S", questionType: "Sliding scale", scoreRangeFrom: 1, scoreRangeTo: 10, startingScore: 5, showScoreTooltip: true, scoreTooltipFormat: "Percent" }))).resolves.toBeTruthy();
    });

    it("ignores COMPLETENESS / cross-field rules of other types (only applicable fields are validated)", async () => {
      // A text question may carry a one-option list and a reversed numeric range left over
      // from another type: the min-2-options and from<=to rules apply only to their own type.
      await expect(mut.createItem(A, quiz.collection.id, withSlug({ title: "T", questionType: "Text", rangeFrom: 9, rangeTo: 1, options: [{ title: "Solo", score: 1 }] }))).resolves.toBeTruthy();
    });

    it("but stored values are ALWAYS structurally valid, whatever the type", async () => {
      await expect(mut.createItem(A, quiz.collection.id, withSlug({ title: "T", questionType: "Text", options: "{broken" }))).rejects.toThrow(/not a valid list/i);
      await expect(mut.createItem(A, quiz.collection.id, withSlug({ title: "T", questionType: "Text", options: [{ title: "", score: "x" }] }))).rejects.toThrow(/title is required/i);
    });
  });

  // ═══ media + assets ═════════════════════════════════════════════════════
  describe("media and org-scoped asset checks", () => {
    it("image media: needs an existing IMAGE asset of the caller's organization", async () => {
      const img = await seedAsset(org, "image/png");
      const ok = await mut.createItem(A, quiz.collection.id, choice({ media: "Image", mediaImage: img, mediaImageAlt: "alt" }));
      expect(ok.values[F.mediaImage]).toBe(img);
      await expect(mut.createItem(A, quiz.collection.id, choice({ media: "Image" }))).rejects.toThrow(/Choose an image/i);
      await expect(mut.createItem(A, quiz.collection.id, choice({ media: "Image", mediaImage: randomUUID() }))).rejects.toThrow(/image was not found/i);
      await expect(mut.createItem(A, quiz.collection.id, choice({ media: "Image", mediaImage: await seedAsset(orgOther, "image/png") }))).rejects.toThrow(/image was not found/i); // another org's asset
      await expect(mut.createItem(A, quiz.collection.id, choice({ media: "Image", mediaImage: await seedAsset(org, "video/mp4") }))).rejects.toThrow(/image was not found/i); // wrong media type
    });

    it("video: an uploaded video OR a YouTube/Loom link — exactly one", async () => {
      const vid = await seedAsset(org, "video/mp4");
      await expect(mut.createItem(A, quiz.collection.id, choice({ media: "Video", mediaVideoFile: vid }))).resolves.toBeTruthy();
      await expect(mut.createItem(A, quiz.collection.id, choice({ media: "Video", mediaVideoUrl: "https://youtu.be/aqz-KE-bpKQ" }))).resolves.toBeTruthy();
      await expect(mut.createItem(A, quiz.collection.id, choice({ media: "Video", mediaVideoFile: vid, mediaVideoUrl: "https://youtu.be/aqz-KE-bpKQ" }))).rejects.toThrow(/either an uploaded video or a video link/i);
      await expect(mut.createItem(A, quiz.collection.id, choice({ media: "Video" }))).rejects.toThrow(/video file or paste/i);
      await expect(mut.createItem(A, quiz.collection.id, choice({ media: "Video", mediaVideoUrl: "https://evil.example/x.mp4" }))).rejects.toThrow(/YouTube or Loom/i);
      await expect(mut.createItem(A, quiz.collection.id, choice({ media: "Video", mediaVideoFile: await seedAsset(org, "image/png") }))).rejects.toThrow(/video was not found/i);
    });

    it("option images: must exist in the org and be images", async () => {
      const img = await seedAsset(org, "image/jpeg");
      const item = await mut.createItem(A, quiz.collection.id, choice({ options: [{ title: "A", score: 1, image: { asset_id: img } }, { title: "B", score: 2 }] }));
      expect(JSON.parse(item.values[F.options])[0].image).toEqual({ asset_id: img });
      const foreign = await seedAsset(orgOther, "image/jpeg");
      await expect(mut.createItem(A, quiz.collection.id, choice({ options: [{ title: "A", score: 1, image: { asset_id: foreign } }, { title: "B", score: 2 }] }))).rejects.toThrow(/image was not found/i);
      await expect(mut.createItem(A, quiz.collection.id, choice({ options: [{ title: "A", score: 1, image: { asset_id: randomUUID() } }, { title: "B", score: 2 }] }))).rejects.toThrow(/image was not found/i);
    });

    it("asset ids inside option JSON are discovered for preloading and PROTECT the asset from deletion", async () => {
      const img = await seedAsset(org, "image/jpeg", "protected");
      const item = await mut.createItem(A, quiz.collection.id, choice({ options: [{ title: "A", score: 1, image: { asset_id: img } }, { title: "B", score: 2 }] }));
      // The real preload path (`includeAssets`): field types + item values → asset ids.
      const ids = collectReferencedAssetIds({
        json: [],
        fields: { [quiz.collection.id]: quiz.fields },
        items: { [quiz.collection.id]: [{ values: item.values }] },
      });
      expect(ids).toEqual([img]);
      const usages = await findAssetUsages(org, img);
      expect(usages.length).toBeGreaterThan(0);
    });

    it("ignores media fields that don't apply to the chosen media type", async () => {
      await expect(mut.createItem(A, quiz.collection.id, choice({ media: "None", mediaImage: "junk", mediaVideoUrl: "junk" }))).resolves.toBeTruthy();
    });
  });

  // ═══ update: merged record, non-destructive type switching ═══════════════
  describe("updates validate the MERGED record", () => {
    it("a change to an unrelated field keeps the question valid", async () => {
      const item = await mut.createItem(A, quiz.collection.id, choice());
      const saved = await mut.updateItem(A, quiz.collection.id, item.id, v({ required: false }));
      expect(saved.values[F.required]).toBe("false");
      expect(JSON.parse(saved.values[F.options])).toHaveLength(2);
    });

    it("switching to a type whose required config is missing is rejected", async () => {
      const item = await mut.createItem(A, quiz.collection.id, choice());
      await expect(mut.updateItem(A, quiz.collection.id, item.id, v({ questionType: "Sliding scale" }))).rejects.toThrow(/Score range from is required/i);
      // …and nothing was written
      const [{ value }] = await q<{ value: string }>(`SELECT value FROM collection_item_values WHERE item_id = $1 AND field_id = $2`, [item.id, F.questionType]);
      expect(value).toBe("Single choice");
    });

    it("switching type is NON-DESTRUCTIVE: the old options survive and apply again on switching back", async () => {
      const item = await mut.createItem(A, quiz.collection.id, choice({ options: [{ title: "Keep A", score: 3 }, { title: "Keep B", score: 4 }] }));
      const before = item.values[F.options];
      const asText = await mut.updateItem(A, quiz.collection.id, item.id, v({ questionType: "Text" }));
      expect(asText.values[F.options]).toBe(before); // preserved though inapplicable
      const back = await mut.updateItem(A, quiz.collection.id, item.id, v({ questionType: "Multiple choice" }));
      expect(back.values[F.options]).toBe(before);
    });

    it("removing the options of a choice question is rejected", async () => {
      const item = await mut.createItem(A, quiz.collection.id, choice());
      await expect(mut.updateItem(A, quiz.collection.id, item.id, v({ options: "" }))).rejects.toThrow(/at least 2/i);
      await expect(mut.updateItem(A, quiz.collection.id, item.id, v({ options: [{ title: "One", score: 1 }] }))).rejects.toThrow(/at least 2/i);
    });

    it("keeps option ids stable across edits (ids are immutable identity)", async () => {
      const item = await mut.createItem(A, quiz.collection.id, choice());
      const ids = JSON.parse(item.values[F.options]).map((o: { id: string }) => o.id);
      const edited = JSON.parse(item.values[F.options]).map((o: { title: string }) => ({ ...o, title: `${o.title}!` }));
      const saved = await mut.updateItem(A, quiz.collection.id, item.id, v({ options: edited }));
      expect(JSON.parse(saved.values[F.options]).map((o: { id: string }) => o.id)).toEqual(ids);
    });

    it("duplicating a question copies its options verbatim and the copy is valid", async () => {
      const item = await mut.createItem(A, quiz.collection.id, choice());
      const copy = await mut.duplicateItem(A, quiz.collection.id, item.id);
      expect(copy.values[F.options]).toBe(item.values[F.options]);
      await expect(mut.updateItem(A, quiz.collection.id, copy.id, v({ required: true }))).resolves.toBeTruthy();
    });
  });

  // ═══ scope: only quiz-shaped collections ═════════════════════════════════
  describe("scope of the quiz rules", () => {
    it("does not apply to an ordinary collection (even one with a 'question_type'-like user field)", async () => {
      const plain = await mut.createCollection(A, { name: "Plain" });
      const nameId = plain.fields.find((f) => f.key === "name")!.id;
      const slugId = plain.fields.find((f) => f.key === "slug")!.id;
      const custom = await mut.createField(A, plain.collection.id, { name: "question_type", type: "text" });
      await expect(mut.createItem(A, plain.collection.id, { [nameId]: "x", [slugId]: "x", [custom.id]: "anything goes" })).resolves.toBeTruthy();
    });

    it("a collection with only ONE of the structural fields is not treated as a quiz", async () => {
      const partial = await mut.createCollection(A, { name: "Partial" });
      const nameId = partial.fields.find((f) => f.key === "name")!.id;
      const slugId = partial.fields.find((f) => f.key === "slug")!.id;
      await expect(mut.createItem(A, partial.collection.id, { [nameId]: "x", [slugId]: "x2" })).resolves.toBeTruthy();
    });
  });

  // ═══ tenancy ═════════════════════════════════════════════════════════════
  describe("tenant isolation", () => {
    it("another funnel's scope cannot create or edit questions in this Quiz", async () => {
      const item = await mut.createItem(A, quiz.collection.id, choice());
      await expect(mut.createItem(B, quiz.collection.id, choice())).rejects.toThrow(/not found/i);
      await expect(mut.updateItem(B, quiz.collection.id, item.id, v({ required: false }))).rejects.toThrow(/not found/i);
      await expect(mut.duplicateItem(B, quiz.collection.id, item.id)).rejects.toThrow(/not found/i);
    });

    it("each funnel gets its own independent Quiz", async () => {
      const other = await mut.createSampleCollection(B, "quiz");
      expect(other.collection.name).toBe("Quiz"); // no clash across funnels
      expect(other.fields.every((f) => !quiz.fields.some((g) => g.id === f.id))).toBe(true);
    });
  });
});
