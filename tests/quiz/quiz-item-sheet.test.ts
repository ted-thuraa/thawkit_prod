// @vitest-environment jsdom
/**
 * The REAL CollectionItemSheet driven by the REAL Quiz schema (as the sample
 * creates it): conditional field display, which values are sent, client-side
 * quiz validation, and editing existing questions of different types.
 */
import "../file-manager/jsdom-polyfills";
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { read, write, toast } = vi.hoisted(() => ({
  read: {
    getItems: vi.fn(), searchItems: vi.fn(), getFields: vi.fn(), getItemById: vi.fn(),
    getItemSlugs: vi.fn(), getAllFields: vi.fn(), getReferencedItemsBatch: vi.fn(), refresh: vi.fn(),
  },
  write: { createItem: vi.fn(), updateItem: vi.fn(), duplicateItem: vi.fn(), deleteItems: vi.fn(), reorderItems: vi.fn() },
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}));

vi.mock("@/lib/auth/auth", () => ({ auth: {}, getServerSession: vi.fn() }));
vi.mock("@/lib/editor/editor-read-api", () => ({
  collectionsReadApi: read,
  assetsReadApi: { fetchPage: vi.fn(), getByIds: vi.fn(), getFolders: vi.fn() },
  pagesReadApi: { getLayers: vi.fn() },
}));
vi.mock("@/lib/editor/editor-collection-write-api", () => ({ collectionsWriteApi: write }));
vi.mock("@/lib/editor/editor-asset-write-api", () => ({ assetsWriteApi: {}, assetFoldersApi: {}, assetsApi: {} }));
vi.mock("@/lib/assets/uploadthing-client", () => ({ useUploadThing: () => ({ startUpload: vi.fn(), isUploading: false }) }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/app/(main)/campaign/[campaignId]/edit/_components/RichTextEditor", () => ({ default: () => null }));
vi.mock("@/app/(main)/campaign/[campaignId]/edit/_components/RichTextEditorSheet", () => ({ default: () => null }));
vi.mock("@/app/(main)/campaign/[campaignId]/edit/_components/ReferenceFieldCombobox", () => ({ default: () => null }));
vi.mock("@/app/(main)/campaign/[campaignId]/edit/_components/ColorFieldInput", () => ({ default: () => null }));
vi.mock("@/app/(main)/campaign/[campaignId]/edit/_components/AssetFieldCard", () => ({ default: () => null, SortableAssetFieldCard: () => null }));
vi.mock("@/app/(main)/campaign/[campaignId]/edit/_components/CMS/CollectionLinkFieldInput", () => ({ default: () => null }));

import CollectionItemSheet from "@/app/(main)/campaign/[campaignId]/edit/_components/CMS/CollectionItemSheet";
import { useCollectionsStore } from "@/stores/editor/useCollectionsStore";
import { QUIZ_FIELD_KEYS, type QuizFieldRole } from "@/lib/quiz";
import { sampleFields } from "./helpers";
import type { Collection, CollectionField, CollectionItemWithValues } from "@/types/funnel";

const C1 = "11111111-1111-4111-8111-111111111111";

const collection: Collection = {
  id: C1, name: "Quiz", uuid: C1, order: 0, sorting: null, created_at: "", updated_at: "", deleted_at: null,
  is_published: false, draft_items_count: 0, has_published_version: false,
};
const fields: CollectionField[] = sampleFields().map((f, order) => ({
  id: f.id, collection_id: C1, name: f.name, key: f.key, type: f.type, default: f.default,
  fillable: !["id", "created_at", "updated_at"].includes(f.key ?? ""), order, hidden: false,
  reference_collection_id: null, data: f.data,
})) as unknown as CollectionField[];

const F = Object.fromEntries(
  (Object.entries(QUIZ_FIELD_KEYS) as [QuizFieldRole, string][]).map(([role, key]) => [role, fields.find((f) => f.key === key)!.id]),
) as Record<QuizFieldRole, string>;
const SLUG = fields.find((f) => f.key === "slug")!.id;

const OPTIONS = JSON.stringify([{ id: "opt_aaa", title: "A", score: 1 }, { id: "opt_bbb", title: "B", score: 2 }]);

function quizItem(id: string, values: Partial<Record<QuizFieldRole, string>>, slug = id): CollectionItemWithValues {
  const v: Record<string, string> = { [SLUG]: slug };
  for (const [role, value] of Object.entries(values)) v[F[role as QuizFieldRole]] = value as string;
  return { id, collection_id: C1, manual_order: 0, values: v, is_published: false, is_publishable: true, content_hash: null } as unknown as CollectionItemWithValues;
}

const ok = <T>(data: T) => Promise.resolve({ data });

function seed(items: CollectionItemWithValues[] = []) {
  useCollectionsStore.setState({
    collections: [collection], fields: { [C1]: fields }, items: { [C1]: items },
    itemsTotalCount: { [C1]: items.length }, lastItemsQuery: { [C1]: { page: 1, limit: 25 } }, selectedCollectionId: C1,
  });
}

function mount(itemId: string | null = null) {
  const onSuccess = vi.fn();
  render(h(CollectionItemSheet, { open: true, onOpenChange: vi.fn(), collectionId: C1, itemId, onSuccess }));
  return { onSuccess };
}
const submitButton = () => screen.getAllByRole("button").find((b) => b.getAttribute("form") === "collection-item-form")! as HTMLButtonElement;
/** Is a FIELD with this label rendered? (labels only — option text also appears inside selects) */
const has = (label: string) => screen.queryByText(label, { selector: "label" }) !== null;
const optionsEditor = () => screen.queryByTestId(`answer-options-${F.options}-editor`);
const payloadOf = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[0][fn.mock.calls[0].length - 1] as Record<string, unknown>;

beforeEach(() => {
  for (const fn of [...Object.values(read), ...Object.values(write), toast, toast.error, toast.success]) fn.mockReset();
  read.getItems.mockResolvedValue({ data: { items: [], total: 0 } });
  useCollectionsStore.getState().reset();
  seed();
});
afterEach(() => cleanup());

describe("create mode", () => {
  it("labels the built-in name field 'Question' and starts as a single-choice question", async () => {
    mount();
    expect(await screen.findByText("Question", { selector: "label" })).toBeTruthy();
    expect(has("Name")).toBe(false);
    // default type = Single choice ⇒ its options editor is shown
    await waitFor(() => expect(optionsEditor()).toBeTruthy());
  });

  it("shows the common fields and the OPTIONS editor, and hides every other type's fields", async () => {
    mount();
    await screen.findByText("Answer options", { selector: "label" });
    for (const label of ["Description", "Show description", "Question type", "Required", "Media", "Answer options"]) expect(has(label), label).toBe(true);
    expect(optionsEditor()).toBeTruthy();
    for (const label of ["Input type", "Character limit", "Range from", "Range to", "Allow decimals", "Score range from", "Score range to", "Starting score", "Left label", "Show score tooltip", "Tooltip format", "Image", "Image alt text", "Video file"]) {
      expect(has(label), `${label} should be hidden`).toBe(false);
    }
  });

  it("creates a question: sends the typed options and NOTHING for fields that don't apply", async () => {
    write.createItem.mockReturnValue(ok(quizItem("new", {})));
    const { onSuccess } = mount();
    const user = userEvent.setup();
    await screen.findByText("Answer options", { selector: "label" });
    const textboxes = () => screen.getAllByRole("textbox") as HTMLInputElement[];
    await user.type(textboxes()[0], "Do you like quizzes?");
    await waitFor(() => expect(textboxes()[1].value).not.toBe("")); // slug auto-fill

    await user.click(screen.getByRole("button", { name: /add option/i }));
    await user.click(screen.getByRole("button", { name: /add option/i }));
    await user.type(screen.getByLabelText("Option 1 title"), "Yes");
    await user.clear(screen.getByLabelText("Option 1 score")); await user.type(screen.getByLabelText("Option 1 score"), "5");
    await user.type(screen.getByLabelText("Option 2 title"), "No");

    fireEvent.click(submitButton());
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(write.createItem).toHaveBeenCalledTimes(1);
    const payload = payloadOf(write.createItem);
    expect(payload[F.title]).toBe("Do you like quizzes?");
    expect(payload[F.questionType]).toBe("Single choice");
    expect(payload[F.required]).toBe("true"); // field default
    const options = JSON.parse(payload[F.options] as string);
    expect(options.map((o: { title: string; score: number }) => [o.title, o.score])).toEqual([["Yes", 5], ["No", 0]]);
    expect(options.every((o: { id: string }) => /^opt_[a-z0-9]{8}$/.test(o.id))).toBe(true);
    // Hidden + untouched ⇒ never sent (no meaningless "false" / empty values)
    for (const role of ["characterLimit", "inputType", "rangeFrom", "rangeTo", "allowDecimals", "scoreRangeFrom", "scoreRangeTo", "startingScore", "showScoreTooltip", "scoreTooltipFormat", "mediaImage", "mediaVideoFile", "mediaVideoUrl", "mediaImageAlt"] as QuizFieldRole[]) {
      expect(F[role] in payload, `${role} must not be sent`).toBe(false);
    }
  });

  it("blocks saving a choice question with fewer than 2 options — inline, with no request", async () => {
    const { onSuccess } = mount();
    const user = userEvent.setup();
    await screen.findByText("Answer options", { selector: "label" });
    const textboxes = () => screen.getAllByRole("textbox") as HTMLInputElement[];
    await user.type(textboxes()[0], "Too few options");
    await waitFor(() => expect(textboxes()[1].value).not.toBe(""));
    await user.click(screen.getByRole("button", { name: /add option/i }));
    await user.type(screen.getByLabelText("Option 1 title"), "Only");
    fireEvent.click(submitButton());
    expect(await screen.findByText(/at least 2 answer options/i)).toBeTruthy();
    expect(write.createItem).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("flags an option without a title and a missing score before sending", async () => {
    mount();
    const user = userEvent.setup();
    await screen.findByText("Answer options", { selector: "label" });
    const textboxes = () => screen.getAllByRole("textbox") as HTMLInputElement[];
    await user.type(textboxes()[0], "Bad options");
    await waitFor(() => expect(textboxes()[1].value).not.toBe(""));
    await user.click(screen.getByRole("button", { name: /add option/i }));
    await user.click(screen.getByRole("button", { name: /add option/i }));
    await user.type(screen.getByLabelText("Option 2 title"), "Second");
    fireEvent.click(submitButton());
    expect(await screen.findByText(/Option 1: title is required/i)).toBeTruthy();
    expect(write.createItem).not.toHaveBeenCalled();
  });
});

describe("editing existing questions", () => {
  it("a TEXT question shows its own config, hides the options, and doesn't resend hidden leftovers", async () => {
    seed([quizItem("t1", {
      title: "Tell us more", questionType: "Text", inputType: "Multi line", characterLimit: "500",
      options: OPTIONS, // leftover from when it was a choice question — hidden, preserved, not resent
    }, "tell-us-more")]);
    write.updateItem.mockReturnValue(ok(quizItem("t1", {})));
    const { onSuccess } = mount("t1");
    expect(await screen.findByText("Input type", { selector: "label" })).toBeTruthy();
    expect(has("Character limit")).toBe(true);
    expect(has("Answer options")).toBe(false);
    expect(optionsEditor()).toBeNull();

    fireEvent.click(submitButton());
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    const payload = payloadOf(write.updateItem);
    expect(write.updateItem.mock.calls[0].slice(0, 2)).toEqual([C1, "t1"]);
    expect(payload[F.characterLimit]).toBe("500");
    expect(F.options in payload).toBe(false); // hidden & untouched ⇒ left alone on the server
    expect(F.rangeFrom in payload).toBe(false);
  });

  it("a CHOICE question loads its options into the editor in order", async () => {
    seed([quizItem("c1", { title: "Pick", questionType: "Multiple choice", options: OPTIONS }, "pick")]);
    mount("c1");
    await waitFor(() => expect((screen.getByLabelText("Option 1 title") as HTMLInputElement).value).toBe("A"));
    expect((screen.getByLabelText("Option 2 score") as HTMLInputElement).value).toBe("2");
  });

  it("a SLIDING SCALE question shows its fields; the tooltip format appears only while the tooltip is on", async () => {
    seed([quizItem("s1", { title: "Scale", questionType: "Sliding scale", scoreRangeFrom: "1", scoreRangeTo: "10", showScoreTooltip: "false" }, "scale")]);
    mount("s1");
    expect(await screen.findByText("Score range from", { selector: "label" })).toBeTruthy();
    expect(has("Starting score")).toBe(true);
    expect(has("Tooltip format")).toBe(false);
    cleanup();
    seed([quizItem("s2", { title: "Scale", questionType: "Sliding scale", scoreRangeFrom: "1", scoreRangeTo: "10", showScoreTooltip: "true" }, "scale2")]);
    mount("s2");
    expect(await screen.findByText("Tooltip format", { selector: "label" })).toBeTruthy();
  });

  it("an invalid scale range is reported on the right field and nothing is sent", async () => {
    seed([quizItem("s3", { title: "Scale", questionType: "Sliding scale", scoreRangeFrom: "9", scoreRangeTo: "2" }, "scale3")]);
    const { onSuccess } = mount("s3");
    await screen.findByText("Score range to", { selector: "label" });
    fireEvent.click(submitButton());
    expect(await screen.findByText(/greater than score range from/i)).toBeTruthy();
    expect(write.updateItem).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("a NUMERIC question shows range controls", async () => {
    seed([quizItem("n1", { title: "How many?", questionType: "Numeric", rangeFrom: "0", rangeTo: "80" }, "how-many")]);
    mount("n1");
    expect(await screen.findByText("Range from", { selector: "label" })).toBeTruthy();
    expect(has("Allow decimals")).toBe(true);
    expect(has("Character limit")).toBe(false);
  });

  it("media selection reveals the matching media fields", async () => {
    seed([quizItem("m1", { title: "With video", questionType: "Text", media: "Video", mediaVideoUrl: "https://youtu.be/aqz-KE-bpKQ" }, "with-video")]);
    mount("m1");
    expect(await screen.findByText("Video link (YouTube or Loom)", { selector: "label" })).toBeTruthy();
    expect(has("Video file")).toBe(true);
    expect(has("Image alt text")).toBe(false);
  });

  it("surfaces a server rejection and keeps the form open (client rules passed)", async () => {
    seed([quizItem("c2", { title: "Pick", questionType: "Single choice", options: OPTIONS }, "pick2")]);
    write.updateItem.mockReturnValue(Promise.resolve({ error: "A selected image was not found." }));
    const { onSuccess } = mount("c2");
    await waitFor(() => expect((screen.getByLabelText("Option 1 title") as HTMLInputElement).value).toBe("A"));
    fireEvent.click(submitButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to save item", { description: "A selected image was not found." }));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(within(document.body).getByLabelText("Option 1 title")).toBeTruthy();
  });
});

describe("non-quiz collections are unaffected", () => {
  it("a collection without the quiz structure gets no quiz validation and no conditional hiding", async () => {
    const plain: CollectionField[] = fields.filter((f) => ["name", "slug", "description"].includes(f.key ?? "")).map((f) => ({ ...f, data: {} })) as never;
    useCollectionsStore.setState({ fields: { [C1]: plain } });
    write.createItem.mockReturnValue(ok(quizItem("p", {})));
    const { onSuccess } = mount();
    const user = userEvent.setup();
    await screen.findByText("Description", { selector: "label" });
    const textboxes = () => screen.getAllByRole("textbox") as HTMLInputElement[];
    await user.type(textboxes()[0], "Plain item");
    await waitFor(() => expect(textboxes()[1].value).not.toBe(""));
    fireEvent.click(submitButton());
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });
});
