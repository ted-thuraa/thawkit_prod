// @vitest-environment jsdom
import "../file-manager/jsdom-polyfills";
import { createElement as h, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/auth/auth", () => ({ auth: {}, getServerSession: vi.fn() }));
vi.mock("@/lib/editor/editor-read-api", () => ({
  collectionsReadApi: {}, assetsReadApi: { fetchPage: vi.fn(), getByIds: vi.fn(), getFolders: vi.fn() }, pagesReadApi: {},
}));
vi.mock("@/lib/editor/editor-asset-write-api", () => ({ assetsWriteApi: {}, assetFoldersApi: {}, assetsApi: {} }));
vi.mock("@/lib/assets/uploadthing-client", () => ({ useUploadThing: () => ({ startUpload: vi.fn(), isUploading: false }) }));

import AnswerOptionsEditor, { moveRow, parseRows, serializeRows } from "@/app/(main)/campaign/[campaignId]/edit/_components/CMS/AnswerOptionsEditor";
import { useEditorStore } from "@/stores/editor/useEditorStore";
import { toast } from "sonner";

const ASSET = "66666666-6666-4666-8666-666666666666";
const stored = (...o: object[]) => JSON.stringify(o);

describe("parseRows / serializeRows / moveRow (pure)", () => {
  it("round-trips options, preserving ids and omitting empty optionals", () => {
    const value = stored(
      { id: "opt_aaa", title: "A", description: "d", score: 1.5, icon: "🙂", image: { asset_id: ASSET } },
      { id: "opt_bbb", title: "B", score: -2 },
    );
    const rows = parseRows(value);
    expect(rows.map((r) => r.id)).toEqual(["opt_aaa", "opt_bbb"]);
    expect(JSON.parse(serializeRows(rows))).toEqual(JSON.parse(value));
  });

  it("empty / invalid text gives no rows; no rows serialise to the empty string", () => {
    for (const v of ["", "  ", "{", "{}", "5"]) expect(parseRows(v)).toEqual([]);
    expect(serializeRows([])).toBe("");
  });

  it("tolerates bad entries (blank row) and mints an id when one is missing", () => {
    const rows = parseRows(stored({ title: "No id", score: 1 }, "junk", { id: 5, title: 7, score: "x" }));
    expect(rows).toHaveLength(3);
    expect(rows[0].id).toMatch(/^opt_/);
    expect(rows[1]).toMatchObject({ title: "", score: "" });
    expect(rows[2]).toMatchObject({ title: "", score: "" });
  });

  it("emits an unparseable / empty score as null so the validator reports it (never a silent 0)", () => {
    const rows = parseRows(stored({ id: "opt_aaa", title: "A", score: 1 }));
    expect(JSON.parse(serializeRows([{ ...rows[0], score: "" }]))[0].score).toBeNull();
    expect(JSON.parse(serializeRows([{ ...rows[0], score: "abc" }]))[0].score).toBeNull();
    expect(JSON.parse(serializeRows([{ ...rows[0], score: "0" }]))[0].score).toBe(0);
    expect(JSON.parse(serializeRows([{ ...rows[0], score: "-1.25" }]))[0].score).toBe(-1.25);
  });

  it("moveRow reorders and ignores out-of-range / no-op moves without mutating", () => {
    const a = ["a", "b", "c"];
    expect(moveRow(a, 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveRow(a, 2, 0)).toEqual(["c", "a", "b"]);
    for (const [f, t] of [[1, 1], [-1, 0], [0, 3], [5, 1]]) expect(moveRow(a, f, t)).toEqual(a);
    expect(a).toEqual(["a", "b", "c"]);
  });
});

/** Controlled harness like the item sheet's form field. */
function Harness({ initial = "", onValue }: { initial?: string; onValue?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return h("div", null,
    h(AnswerOptionsEditor, { value, onChange: (v: string) => { setValue(v); onValue?.(v); } }),
    h("button", { type: "button", onClick: () => setValue(stored({ id: "opt_ext", title: "External", score: 9 })) }, "external-reset"),
    h("output", { "data-testid": "value" }, value),
  );
}
const current = () => screen.getByTestId("value").textContent ?? "";
const parsed = () => JSON.parse(current());

beforeEach(() => {
  useEditorStore.setState({ openFileManager: vi.fn() } as never);
  vi.mocked(toast.error).mockClear();
});
afterEach(() => cleanup());

describe("AnswerOptionsEditor", () => {
  it("starts empty with guidance and an Add option button", () => {
    render(h(Harness));
    expect(screen.getByText(/Add at least 2/i)).toBeTruthy();
    expect(screen.queryAllByTestId(/-row$/)).toHaveLength(0);
  });

  it("adds options with fresh unique ids and a default score of 0", async () => {
    render(h(Harness));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /add option/i }));
    await user.click(screen.getByRole("button", { name: /add option/i }));
    const value = parsed();
    expect(value).toHaveLength(2);
    expect(value[0].id).not.toBe(value[1].id);
    expect(value[0].id).toMatch(/^opt_[a-z0-9]{8}$/);
    expect(value.map((o: { score: number }) => o.score)).toEqual([0, 0]);
  });

  it("edits title, score, description and icon into the emitted JSON", async () => {
    render(h(Harness, { initial: stored({ id: "opt_aaa", title: "", score: 0 }) }));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Option 1 title"), "Strongly agree");
    await user.clear(screen.getByLabelText("Option 1 score"));
    await user.type(screen.getByLabelText("Option 1 score"), "-2.5");
    await user.type(screen.getByLabelText("Option 1 description"), "Fully");
    await user.type(screen.getByLabelText("Option 1 icon"), "👍");
    expect(parsed()).toEqual([{ id: "opt_aaa", title: "Strongly agree", description: "Fully", score: -2.5, icon: "👍" }]);
  });

  it("preserves existing option ids across edits (ids are identity)", async () => {
    render(h(Harness, { initial: stored({ id: "opt_keep", title: "A", score: 1 }, { id: "opt_keep2", title: "B", score: 2 }) }));
    await userEvent.setup().type(screen.getByLabelText("Option 2 title"), "!");
    expect(parsed().map((o: { id: string }) => o.id)).toEqual(["opt_keep", "opt_keep2"]);
  });

  it("reorders with move up / move down and disables the edges", async () => {
    render(h(Harness, { initial: stored({ id: "opt_aaa", title: "First", score: 1 }, { id: "opt_bbb", title: "Second", score: 2 }, { id: "opt_ccc", title: "Third", score: 3 }) }));
    const user = userEvent.setup();
    expect((screen.getByLabelText("Move option 1 up") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Move option 3 down") as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByLabelText("Move option 3 up"));
    expect(parsed().map((o: { title: string }) => o.title)).toEqual(["First", "Third", "Second"]);
    await user.click(screen.getByLabelText("Move option 1 down"));
    expect(parsed().map((o: { title: string }) => o.title)).toEqual(["Third", "First", "Second"]);
    expect((screen.getByLabelText("Option 1 title") as HTMLInputElement).value).toBe("Third");
  });

  it("removes an option; removing the last one empties the value", async () => {
    render(h(Harness, { initial: stored({ id: "opt_aaa", title: "A", score: 1 }, { id: "opt_bbb", title: "B", score: 2 }) }));
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Remove option 1"));
    expect(parsed().map((o: { id: string }) => o.id)).toEqual(["opt_bbb"]);
    await user.click(screen.getByLabelText("Remove option 1"));
    expect(current()).toBe("");
  });

  it("caps the list at 50 options", async () => {
    const fifty = Array.from({ length: 50 }, (_, i) => ({ id: `opt_item${i}`, title: `o${i}`, score: i }));
    render(h(Harness, { initial: JSON.stringify(fifty) }));
    expect((screen.getByRole("button", { name: /add option/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("resets to an EXTERNAL change (form reset / item switch) but not to its own echo", async () => {
    render(h(Harness, { initial: stored({ id: "opt_aaa", title: "Mine", score: 1 }) }));
    const user = userEvent.setup();
    const title = screen.getByLabelText("Option 1 title") as HTMLInputElement;
    await user.type(title, "x");
    expect(title.value).toBe("Minex"); // own echo did not reset the input / cursor
    fireEvent.click(screen.getByText("external-reset"));
    await waitFor(() => expect((screen.getByLabelText("Option 1 title") as HTMLInputElement).value).toBe("External"));
  });

  it("attaches an image through the file manager and can remove it", async () => {
    const open = vi.fn((cb: (a: unknown) => unknown) => cb({ id: ASSET, mime_type: "image/png", public_url: "https://cdn/x.png", filename: "x.png" }));
    useEditorStore.setState({ openFileManager: open } as never);
    render(h(Harness, { initial: stored({ id: "opt_aaa", title: "A", score: 1 }) }));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /add image/i }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(parsed()[0].image).toEqual({ asset_id: ASSET });
    await user.click(screen.getByLabelText("Remove option 1 image"));
    expect(parsed()[0].image).toBeUndefined();
  });

  it("rejects a non-image asset with a message and leaves the option unchanged", async () => {
    const open = vi.fn((cb: (a: unknown) => unknown) => cb({ id: ASSET, mime_type: "video/mp4", public_url: "https://cdn/v.mp4", filename: "v.mp4" }));
    useEditorStore.setState({ openFileManager: open } as never);
    render(h(Harness, { initial: stored({ id: "opt_aaa", title: "A", score: 1 }) }));
    await userEvent.setup().click(screen.getByRole("button", { name: /add image/i }));
    expect(toast.error).toHaveBeenCalledWith("Invalid asset type", expect.anything());
    expect(parsed()[0].image).toBeUndefined();
  });

  it("is fully keyboard-labelled (every control has an accessible name)", () => {
    render(h(Harness, { initial: stored({ id: "opt_aaa", title: "A", score: 1 }) }));
    for (const name of ["Option 1 title", "Option 1 score", "Option 1 icon", "Option 1 description", "Move option 1 up", "Move option 1 down", "Remove option 1"]) {
      expect(screen.getByLabelText(name)).toBeTruthy();
    }
  });
});
