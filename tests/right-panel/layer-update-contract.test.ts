// Regression tests for the Right Panel → layer-update contract.
//
// Bug: RightPanel accepted `onLayerUpdate` but rendered <RightPanelContent />
// with no props, so every design control ended in
// "TypeError: onLayerUpdate is not a function". These tests pin:
//   1. RightPanel forwards the exact callback (and `embedded`) to its content.
//   2. A design edit (useDesignSync) emits a minimal partial update for the
//      right layer id.
//   3. That update, applied through the REAL usePagesStore.updateLayer,
//      touches only the target layer, keeps the tree valid, and schedules the
//      existing autosave.
//
// Run:  npm i -D vitest && npx vitest run --config tests/vitest.config.ts

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { savePageLayersAction } = vi.hoisted(() => ({
  savePageLayersAction: vi.fn(async () => ({
    success: true,
    data: { savedAt: new Date().toISOString() },
  })),
}));

vi.mock("@/actions/editor/editor-actions", () => ({
  createPageAction: vi.fn(),
  deletePageAction: vi.fn(),
  duplicatePageAction: vi.fn(),
  savePageLayersAction,
}));
vi.mock("@/stores/editor/useComponentsStore", () => ({
  triggerThumbnailGeneration: vi.fn(),
  useComponentsStore: { getState: () => ({}) },
}));
vi.mock("@/stores/editor/useEditorBootstrapStore", () => ({
  useEditorBootstrapStore: { getState: () => ({ campaignId: "c1" }) },
}));
vi.mock("@/lib/editor/editor-read-api", () => ({ pagesReadApi: {} }));

// The real RightPanelContent pulls in the whole editor; a sentinel is enough
// to observe what RightPanel hands it.
const ContentSentinel = vi.hoisted(() => {
  const Sentinel = () => null;
  return Sentinel;
});
vi.mock(
  "@/app/(main)/campaign/[campaignId]/edit/_components/RightPanelContent",
  () => ({ default: ContentSentinel }),
);

import type { Layer } from "@/types/funnel";
import { usePagesStore } from "@/stores/editor/usePagesStore";
import { findLayerById } from "@/lib/editor/layer-tree-utils";
import { useDesignSync } from "@/hooks/use-design-sync";
import RightPanel from "@/app/(main)/campaign/[campaignId]/edit/_components/RightPanel";

const PAGE = "p1";

const makeTree = (): Layer[] => [
  {
    id: "body",
    name: "body",
    classes: "",
    children: [
      {
        id: "a",
        name: "div",
        classes: "p-4 bg-red-500",
        customName: "Card A",
        children: [{ id: "a1", name: "text", classes: "text-sm" } as Layer],
      } as Layer,
      { id: "b", name: "div", classes: "flex", customName: "Card B" } as Layer,
    ],
  } as Layer,
];

const seed = () =>
  usePagesStore
    .getState()
    .hydrateFromBootstrap(
      [{ id: PAGE } as never],
      [{ page_id: PAGE, layers: makeTree() } as never],
    );
const tree = () => usePagesStore.getState().pagesByPageId[PAGE].layers;

// Walk the (unrendered) element tree returned by RightPanel's render function.
function findElementsOfType(node: unknown, type: unknown): React.ReactElement[] {
  const out: React.ReactElement[] = [];
  const visit = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (!React.isValidElement(n)) return;
    if (n.type === type) out.push(n);
    visit((n.props as { children?: unknown }).children);
  };
  visit(node);
  return out;
}

// Capture a hook's return value by rendering a probe once on the server.
function captureHook<T>(useHook: () => T): T {
  const box: { value?: T } = {};
  const Probe = () => {
    Object.assign(box, { value: useHook() });
    return null;
  };
  renderToStaticMarkup(React.createElement(Probe));
  return box.value as T;
}

describe("RightPanel → RightPanelContent callback contract", () => {
  it("forwards the exact onLayerUpdate function and embeds the content", () => {
    const onLayerUpdate = vi.fn();
    const render = (
      RightPanel as unknown as {
        type: (p: Record<string, unknown>) => React.ReactElement;
      }
    ).type;

    const rendered = render({ onLayerUpdate });
    const [content] = findElementsOfType(rendered, ContentSentinel);

    expect(content).toBeDefined();
    const props = content.props as {
      onLayerUpdate: unknown;
      embedded?: boolean;
    };
    expect(typeof props.onLayerUpdate).toBe("function");
    expect(props.onLayerUpdate).toBe(onLayerUpdate);
    expect(props.embedded).toBe(true);
  });
});

describe("design edit → onLayerUpdate payload", () => {
  const layerA = () => findLayerById(makeTree(), "a")!;

  it("position change emits a minimal partial update for the selected layer", () => {
    const onLayerUpdate = vi.fn();
    const api = captureHook(() =>
      useDesignSync({ layer: layerA(), onLayerUpdate }),
    );

    api.updateDesignProperty("positioning", "position", "absolute");

    expect(onLayerUpdate).toHaveBeenCalledTimes(1);
    const [id, updates] = onLayerUpdate.mock.calls[0] as [string, Partial<Layer>];
    expect(id).toBe("a");
    // Only the style fields travel — never children / customName / id.
    expect(Object.keys(updates).sort()).toEqual(["classes", "design"]);
    expect(String(updates.classes)).toContain("absolute");
    expect(String(updates.classes)).toContain("p-4"); // existing classes kept
    expect(updates.design?.positioning?.position).toBe("absolute");
  });

  it("a different category (spacing) goes through the same path", () => {
    const onLayerUpdate = vi.fn();
    const api = captureHook(() =>
      useDesignSync({ layer: layerA(), onLayerUpdate }),
    );

    api.updateDesignProperty("spacing", "marginTop", "8px");

    const [id, updates] = onLayerUpdate.mock.calls[0] as [string, Partial<Layer>];
    expect(id).toBe("a");
    expect(updates.design?.spacing?.marginTop).toBe("8px");
    expect(String(updates.classes)).toMatch(/mt-/);
  });
});

describe("applied through the real pages store (authoritative state + autosave)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    savePageLayersAction.mockClear();
    seed();
  });
  afterEach(() => vi.useRealTimers());

  it("updates only the target layer, preserves the rest, and autosaves once", async () => {
    const before = tree();
    const bBefore = findLayerById(before, "b");
    const a1Before = findLayerById(before, "a1");

    const api = captureHook(() =>
      useDesignSync({
        layer: findLayerById(before, "a")!,
        onLayerUpdate: (layerId, updates) =>
          usePagesStore.getState().updateLayer(PAGE, layerId, updates),
      }),
    );
    api.updateDesignProperty("positioning", "position", "absolute");

    const after = tree();
    expect(after).not.toBe(before); // immutable replace
    const a = findLayerById(after, "a")!;
    expect(a.classes).toContain("absolute");
    expect(a.classes).toContain("bg-red-500");
    expect(a.customName).toBe("Card A"); // unrelated field preserved
    expect(a.children?.map((c) => c.id)).toEqual(["a1"]); // nesting intact
    expect(findLayerById(after, "a1")).toBe(a1Before); // untouched subtree reused
    expect(findLayerById(after, "b")).toBe(bBefore); // sibling untouched
    expect(usePagesStore.getState().saveStatusByPageId[PAGE]).toBe("dirty");

    await vi.runAllTimersAsync();
    expect(savePageLayersAction).toHaveBeenCalledTimes(1);
    const saved = (savePageLayersAction.mock.calls[0] as unknown[])[2] as Layer[];
    expect(findLayerById(saved, "a")!.classes).toContain("absolute");
  });
});
