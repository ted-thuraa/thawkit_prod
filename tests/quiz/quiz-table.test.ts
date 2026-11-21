// @vitest-environment jsdom
/** Quiz specifics of the REAL CmsContentEditor table: the options cell and the invalid-question marker. */
import "../file-manager/jsdom-polyfills";
import { createElement as h } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { read, write, toast } = vi.hoisted(() => ({
  read: {
    getItems: vi.fn(), searchItems: vi.fn(), getFields: vi.fn(), getItemById: vi.fn(),
    getItemSlugs: vi.fn(), getAllFields: vi.fn(), getReferencedItemsBatch: vi.fn(), refresh: vi.fn(),
  },
  write: { getFieldUsage: vi.fn(), getUsage: vi.fn() },
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/campaign/camp_1/edit/cms/11111111-1111-4111-8111-111111111111",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/lib/auth/auth", () => ({ auth: {}, getServerSession: vi.fn() }));
vi.mock("@/lib/editor/editor-read-api", () => ({
  collectionsReadApi: read,
  assetsReadApi: { fetchPage: vi.fn(), getByIds: vi.fn(), getFolders: vi.fn() },
  pagesReadApi: { getLayers: vi.fn() },
  callEditorAction: vi.fn(),
}));
vi.mock("@/lib/editor/editor-collection-write-api", () => ({ collectionsWriteApi: write }));
vi.mock("@/lib/editor/editor-asset-write-api", () => ({ assetsWriteApi: {}, assetFoldersApi: {}, assetsApi: {} }));
vi.mock("@/lib/assets/uploadthing-client", () => ({ useUploadThing: () => ({ startUpload: vi.fn(), isUploading: false }) }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/app/(main)/campaign/[campaignId]/edit/_components/CMS/CollectionItemSheet", () => ({ default: () => null }));
vi.mock("@/app/(main)/campaign/[campaignId]/edit/_components/CMS/FieldFormDialog", () => ({ default: () => null }));
vi.mock("@/app/(main)/campaign/[campaignId]/edit/_components/FieldsDropdown", () => ({ default: () => null }));

import CmsContentEditor from "@/app/(main)/campaign/[campaignId]/edit/_components/CMS/cmsContentEditor";
import { useCollectionsStore } from "@/stores/editor/useCollectionsStore";
import { QUIZ_FIELD_KEYS, type QuizFieldRole } from "@/lib/quiz";
import { sampleFields } from "./helpers";
import type { Collection, CollectionField, CollectionItemWithValues } from "@/types/funnel";

const C1 = "11111111-1111-4111-8111-111111111111";
const collection: Collection = {
  id: C1, name: "Quiz", uuid: C1, order: 0, sorting: null, created_at: "", updated_at: "", deleted_at: null,
  is_published: false, draft_items_count: 0, has_published_version: false,
};
// Show the options + type columns (hidden by default in the sample) so their cells render.
const SHOWN = new Set(["name", "question_type", "options"]);
const fields = sampleFields().map((f, order) => ({
  id: f.id, collection_id: C1, name: f.name, key: f.key, type: f.type, default: f.default, fillable: true, order,
  hidden: !SHOWN.has(f.key ?? ""), reference_collection_id: null, data: f.data,
})) as unknown as CollectionField[];
const F = Object.fromEntries(
  (Object.entries(QUIZ_FIELD_KEYS) as [QuizFieldRole, string][]).map(([role, key]) => [role, fields.find((f) => f.key === key)!.id]),
) as Record<QuizFieldRole, string>;

const item = (id: string, values: Partial<Record<QuizFieldRole, string>>): CollectionItemWithValues => {
  const v: Record<string, string> = {};
  for (const [role, value] of Object.entries(values)) v[F[role as QuizFieldRole]] = value as string;
  return { id, collection_id: C1, manual_order: 0, values: v, is_published: false, is_publishable: true, content_hash: null } as unknown as CollectionItemWithValues;
};
const opts = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: `opt_item${i}`, title: `o${i}`, score: i })));

function seed(items: CollectionItemWithValues[], cols: CollectionField[] = fields) {
  useCollectionsStore.setState({
    collections: [collection], fields: { [C1]: cols }, items: { [C1]: items },
    itemsTotalCount: { [C1]: items.length }, lastItemsQuery: { [C1]: { page: 1, limit: 25 } },
    selectedCollectionId: null, cmsSection: "collections", crossCollectionSlugs: {}, isLoading: false, error: null,
  });
}
// The app root wraps everything in <TooltipProvider> (src/app/layout.tsx).
const mount = () => render(h(TooltipProvider, null, h(CmsContentEditor, { campaignId: "camp_1" })));
const rowOf = (title: string) => screen.getByText(title).closest("tr")!;

beforeEach(() => {
  for (const fn of [...Object.values(read), ...Object.values(write), toast, toast.error]) fn.mockReset();
  read.getItems.mockResolvedValue({ data: { items: [], total: 0 } });
  read.getFields.mockResolvedValue({ data: [] });
  read.getItemSlugs.mockResolvedValue({ data: {} });
  read.getReferencedItemsBatch.mockResolvedValue({ data: {} });
  useCollectionsStore.getState().reset();
});
afterEach(() => cleanup());

describe("quiz table", () => {
  it("shows the number of options instead of the raw JSON", async () => {
    seed([
      item("a", { title: "Two options", questionType: "Single choice", options: opts(2) }),
      item("b", { title: "Five options", questionType: "Multiple choice", options: opts(5) }),
      item("c", { title: "One option", questionType: "Single choice", options: opts(1) }),
      item("d", { title: "No options", questionType: "Text" }),
    ]);
    mount();
    expect(within(await screen.findByText("Two options").then((e) => e.closest("tr")!)).getByText("2 options")).toBeTruthy();
    expect(within(rowOf("Five options")).getByText("5 options")).toBeTruthy();
    expect(within(rowOf("One option")).getByText("1 option")).toBeTruthy();
    expect(within(rowOf("No options")).getAllByText("-").length).toBeGreaterThan(0);
    expect(screen.queryByText(/opt_item0/)).toBeNull(); // never the raw JSON
  });

  it("marks questions that fail the shared rules, and only those", async () => {
    seed([
      item("ok", { title: "Valid question", questionType: "Single choice", options: opts(2) }),
      item("bad1", { title: "Choice with one option", questionType: "Single choice", options: opts(1) }),
      item("bad2", { title: "Scale without a range", questionType: "Sliding scale" }),
      item("ok2", { title: "Plain text question", questionType: "Text" }),
    ]);
    mount();
    await screen.findByText("Valid question");
    expect(within(rowOf("Valid question")).queryByTestId("quiz-issue-marker")).toBeNull();
    expect(within(rowOf("Plain text question")).queryByTestId("quiz-issue-marker")).toBeNull();
    expect(within(rowOf("Choice with one option")).getByTestId("quiz-issue-marker")).toBeTruthy();
    expect(within(rowOf("Scale without a range")).getByTestId("quiz-issue-marker")).toBeTruthy();
    expect(screen.getAllByTestId("quiz-issue-marker")).toHaveLength(2);
    expect(within(rowOf("Choice with one option")).getByLabelText("This question has problems")).toBeTruthy();
  });

  it("ordinary collections get no markers and no quiz work", async () => {
    const plain = fields.filter((f) => ["name", "slug", "description"].includes(f.key ?? "")).map((f) => ({ ...f, hidden: false })) as unknown as CollectionField[];
    seed([item("x", { title: "Just an item" })], plain);
    mount();
    await screen.findByText("Just an item");
    expect(screen.queryAllByTestId("quiz-issue-marker")).toHaveLength(0);
  });
});
