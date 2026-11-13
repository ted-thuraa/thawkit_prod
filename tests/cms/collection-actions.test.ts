// Authorization + validation contract of the CMS write server actions.
// Guards and mutations are mocked: this proves ORDER and WIRING (auth first,
// validate second, mutate third, scope from the server) — the SQL itself is
// covered by tests/cms/cms-db.integration.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

const scope = { organizationId: "org_1", funnelId: "fun_1", campaignId: "camp_1", userId: "user_1" };
const requireCampaignScope = vi.fn();
const requireCollectionInFunnel = vi.fn();
const m = {
  createCollection: vi.fn(), createSampleCollection: vi.fn(), updateCollection: vi.fn(),
  deleteCollection: vi.fn(), reorderCollections: vi.fn(), createField: vi.fn(),
  updateField: vi.fn(), deleteField: vi.fn(), reorderFields: vi.fn(),
  requireFieldInFunnel: vi.fn(), createItem: vi.fn(), updateItem: vi.fn(),
  duplicateItem: vi.fn(), deleteItems: vi.fn(), reorderItems: vi.fn(),
};
const usage = { getCollectionUsage: vi.fn(), getCollectionFieldUsage: vi.fn() };

vi.mock("@/lib/editor/read/guards", () => ({
  requireCampaignScope: (...a: unknown[]) => requireCampaignScope(...a),
  requireCollectionInFunnel: (...a: unknown[]) => requireCollectionInFunnel(...a),
}));
vi.mock("@/lib/editor/write/collection-mutations", () => ({
  createCollection: (...a: unknown[]) => m.createCollection(...a),
  createSampleCollection: (...a: unknown[]) => m.createSampleCollection(...a),
  updateCollection: (...a: unknown[]) => m.updateCollection(...a),
  deleteCollection: (...a: unknown[]) => m.deleteCollection(...a),
  reorderCollections: (...a: unknown[]) => m.reorderCollections(...a),
  createField: (...a: unknown[]) => m.createField(...a),
  updateField: (...a: unknown[]) => m.updateField(...a),
  deleteField: (...a: unknown[]) => m.deleteField(...a),
  reorderFields: (...a: unknown[]) => m.reorderFields(...a),
  requireFieldInFunnel: (...a: unknown[]) => m.requireFieldInFunnel(...a),
  createItem: (...a: unknown[]) => m.createItem(...a),
  updateItem: (...a: unknown[]) => m.updateItem(...a),
  duplicateItem: (...a: unknown[]) => m.duplicateItem(...a),
  deleteItems: (...a: unknown[]) => m.deleteItems(...a),
  reorderItems: (...a: unknown[]) => m.reorderItems(...a),
}));
vi.mock("@/lib/collection-usage-utils", () => ({
  getCollectionUsage: (...a: unknown[]) => usage.getCollectionUsage(...a),
  getCollectionFieldUsage: (...a: unknown[]) => usage.getCollectionFieldUsage(...a),
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { ForbiddenError, UnauthenticatedError, ValidationError } from "@/lib/errors";
import * as actions from "@/actions/editor/collection-actions";

const CAMP = "camp_1";
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const VALUES = { [U2]: "hello" };

/** Every action with a valid payload, and the mutation it must reach. */
const cases: Array<[string, () => Promise<unknown>, () => ReturnType<typeof vi.fn>]> = [
  ["createCollectionAction", () => actions.createCollectionAction(CAMP, { name: "Posts" }), () => m.createCollection],
  ["createSampleCollectionAction", () => actions.createSampleCollectionAction(CAMP, "blog"), () => m.createSampleCollection],
  ["updateCollectionAction", () => actions.updateCollectionAction(CAMP, U1, { name: "X" }), () => m.updateCollection],
  ["deleteCollectionAction", () => actions.deleteCollectionAction(CAMP, U1), () => m.deleteCollection],
  ["reorderCollectionsAction", () => actions.reorderCollectionsAction(CAMP, [U1, U2]), () => m.reorderCollections],
  ["createFieldAction", () => actions.createFieldAction(CAMP, U1, { name: "F", type: "text" }), () => m.createField],
  ["updateFieldAction", () => actions.updateFieldAction(CAMP, U1, { hidden: true }), () => m.updateField],
  ["deleteFieldAction", () => actions.deleteFieldAction(CAMP, U1), () => m.deleteField],
  ["reorderFieldsAction", () => actions.reorderFieldsAction(CAMP, U1, [U2]), () => m.reorderFields],
  ["createItemAction", () => actions.createItemAction(CAMP, U1, VALUES), () => m.createItem],
  ["updateItemAction", () => actions.updateItemAction(CAMP, U1, U2, VALUES), () => m.updateItem],
  ["duplicateItemAction", () => actions.duplicateItemAction(CAMP, U1, U2), () => m.duplicateItem],
  ["deleteItemsAction", () => actions.deleteItemsAction(CAMP, U1, [U2]), () => m.deleteItems],
  ["reorderItemsAction", () => actions.reorderItemsAction(CAMP, U1, [{ id: U2, manual_order: 0 }]), () => m.reorderItems],
  ["getCollectionUsageAction", () => actions.getCollectionUsageAction(CAMP, U1), () => usage.getCollectionUsage],
  ["getFieldUsageAction", () => actions.getFieldUsageAction(CAMP, U1), () => usage.getCollectionFieldUsage],
];

const everyMutation = () => [...Object.values(m), ...Object.values(usage)];

beforeEach(() => {
  requireCampaignScope.mockReset().mockResolvedValue(scope);
  requireCollectionInFunnel.mockReset().mockResolvedValue({});
  for (const fn of everyMutation()) fn.mockReset().mockResolvedValue({ ok: true });
});

describe.each(cases)("%s", (_name, call, target) => {
  it("authenticates first: an unauthenticated caller reaches nothing", async () => {
    requireCampaignScope.mockRejectedValue(new UnauthenticatedError());
    const res = (await call()) as { success: boolean };
    expect(res.success).toBe(false);
    for (const fn of everyMutation()) expect(fn).not.toHaveBeenCalled();
    expect(requireCollectionInFunnel).not.toHaveBeenCalled();
  });

  it("enforces the edit permission: a forbidden caller reaches nothing", async () => {
    requireCampaignScope.mockRejectedValue(new ForbiddenError("no edit access"));
    const res = (await call()) as { success: boolean; error: string };
    expect(res).toEqual({ success: false, error: "no edit access" });
    for (const fn of everyMutation()) expect(fn).not.toHaveBeenCalled();
  });

  it("passes the server-derived scope (never client data) to the mutation", async () => {
    const res = (await call()) as { success: boolean };
    expect(res.success).toBe(true);
    expect(target()).toHaveBeenCalledTimes(1);
    expect(target().mock.calls[0][0]).toBe(scope);
  });

  it("never leaks unexpected errors", async () => {
    target().mockRejectedValue(new Error("connection to db-prod-3.internal:5432 refused"));
    const res = (await call()) as { success: boolean; error: string };
    expect(res.success).toBe(false);
    expect(res.error).not.toMatch(/db-prod|5432|refused/);
  });
});

describe("validation happens before any data access", () => {
  it("rejects a malformed collection id", async () => {
    const res = await actions.deleteCollectionAction(CAMP, "not-a-uuid");
    expect(res).toEqual({ success: false, error: "Invalid request." });
    expect(m.deleteCollection).not.toHaveBeenCalled();
  });

  it("rejects mass-assignment on collection update", async () => {
    const res = await actions.updateCollectionAction(CAMP, U1, { name: "x", funnelId: "other" });
    expect(res.success).toBe(false);
    expect(m.updateCollection).not.toHaveBeenCalled();
  });

  it("rejects a client-supplied built-in key on field create", async () => {
    const res = await actions.createFieldAction(CAMP, U1, { name: "F", type: "text", key: "name" });
    expect(res.success).toBe(false);
    expect(m.createField).not.toHaveBeenCalled();
  });

  it("rejects non-uuid item value keys", async () => {
    const res = await actions.createItemAction(CAMP, U1, { "../etc": "x" });
    expect(res.success).toBe(false);
    expect(m.createItem).not.toHaveBeenCalled();
  });

  it("rejects an empty campaign id before authorizing", async () => {
    const res = await actions.deleteCollectionAction("", U1);
    expect(res.success).toBe(false);
    expect(requireCampaignScope).not.toHaveBeenCalled();
  });
});

describe("usage actions prove ownership before reporting", () => {
  it("checks the collection belongs to the funnel", async () => {
    await actions.getCollectionUsageAction(CAMP, U1);
    expect(requireCollectionInFunnel).toHaveBeenCalledWith("fun_1", U1);
  });

  it("does not report usage for another funnel's collection", async () => {
    const { NotFoundError } = await import("@/lib/errors");
    requireCollectionInFunnel.mockRejectedValue(new NotFoundError("Collection not found."));
    const res = await actions.getCollectionUsageAction(CAMP, U1);
    expect(res).toEqual({ success: false, error: "Collection not found." });
    expect(usage.getCollectionUsage).not.toHaveBeenCalled();
  });

  it("checks the field belongs to the funnel", async () => {
    await actions.getFieldUsageAction(CAMP, U1);
    expect(m.requireFieldInFunnel).toHaveBeenCalledWith(scope, U1);
  });
});

describe("in-use deletes surface the server's reason", () => {
  it("returns the ValidationError message to the client", async () => {
    m.deleteCollection.mockRejectedValue(new ValidationError("This collection is still in use. Remove its usages before deleting it."));
    const res = await actions.deleteCollectionAction(CAMP, U1);
    expect(res).toEqual({
      success: false,
      error: "This collection is still in use. Remove its usages before deleting it.",
    });
  });
});
