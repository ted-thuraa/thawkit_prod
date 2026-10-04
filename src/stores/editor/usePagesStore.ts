// path: src/stores/editor/usePagesStore.ts

"use client";

import { create } from "zustand";
import { cloneDeep } from "lodash";
import type { Layer, Page, PageSettings, PageType } from "@/types/funnel";
import {
  canHaveChildren,
  canMoveLayer,
  canPasteIntoParent,
  findLayerById,
  findParentAndIndex,
  insertLayerAfter,
  insertLayerAt,
  isDescendant,
  regenerateIdsWithInteractionRemapping,
  removeLayerById,
  updateLayerInTree,
  generateLayerId,
} from "@/lib/editor/layer-tree-utils";
import {
  createElementFromTemplate,
  type EditorElementType,
} from "@/lib/editor/element-templates";
import {
  cleanLayersForComponentCreation,
  createComponentViaApi,
  replaceLayerWithComponentInstance,
  resetBindingsForDeletedCollection,
  resetBindingsForDeletedField,
} from "@/lib/layer-utils";
import {
  triggerThumbnailGeneration,
  useComponentsStore,
} from "./useComponentsStore";
import { pagesApi } from "@/lib/api";
import {
  createPageAction,
  deletePageAction,
  duplicatePageAction,
  type PageOrderUpdate,
} from "@/actions/editor/editor-actions";
import { pageFromRow } from "@/lib/editor/page-from-row";
import { generateUniqueSlug } from "@/lib/page-utils";

import {
  detachComponentFromLayers,
  updateLayersWithComponent,
} from "@/lib/component-utils";

// Pages saved before addLayerFromTemplate was fixed persisted the display
// label ("Section") in layer.name instead of the element type ("section").
// Repair those on load so structural checks and the renderer see lowercase names.
const LEGACY_CAPITALISED_NAMES = new Set([
  "section",
  "div",
  "button",
  "link",
  "form",
  "input",
  "textarea",
  "select",
  "checkbox",
  "hr",
  "image",
  "video",
  "heading",
  "text",
]);

function normalizeLegacyLayerNames(page: Page): Page {
  const fix = (layer: Layer): Layer => {
    const lower = layer.name.toLowerCase();
    const name =
      layer.name !== lower && LEGACY_CAPITALISED_NAMES.has(lower)
        ? lower
        : layer.name;
    return { ...layer, name, children: layer.children?.map(fix) };
  };
  return { ...page, layers: page.layers.map(fix) };
}

/** Fields the client decides for a new page before the server confirms it. */
export interface CreatePageInput {
  name: string;
  slug: string;
  pageType: PageType;
  /** Position in the flat order; pages at/after it shift +1. */
  order: number;
  isDynamic: boolean;
  settings: PageSettings;
}

export type PageMutationOutcome =
  | { success: true; page: Page }
  | { success: false; error: string };

/**
 * The optimistic half is committed synchronously (`tempId` is already in the
 * store when this returns); the network half is the `result` promise.
 */
export type StartedPageMutation =
  | { ok: true; tempId: string; result: Promise<PageMutationOutcome> }
  | { ok: false; error: string };

export const TEMP_PAGE_ID_PREFIX = "temp-page-";
export function isTempPageId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(TEMP_PAGE_ID_PREFIX);
}

function makeTempPageId(): string {
  return `${TEMP_PAGE_ID_PREFIX}${crypto.randomUUID()}`;
}

/** Orders >= `fromOrder` move +1 (making room for an insert) …*/
function shiftOrdersUp(pages: Page[], fromOrder: number): Page[] {
  return pages.map((p) =>
    p.order >= fromOrder ? { ...p, order: p.order + 1 } : p,
  );
}

/** … and the exact inverse, applied only to the ids that were shifted. */
function unshiftOrders(pages: Page[], shiftedIds: ReadonlySet<string>): Page[] {
  return pages.map((p) =>
    shiftedIds.has(p.id) ? { ...p, order: p.order - 1 } : p,
  );
}

/** Authoritative order values from the server win over the optimistic shift. */
function applyOrderUpdates(
  pages: Page[],
  updates: readonly PageOrderUpdate[],
): Page[] {
  if (updates.length === 0) return pages;
  const byId = new Map(updates.map((u) => [u.id, u.order]));
  return pages.map((p) =>
    byId.has(p.id) ? { ...p, order: byId.get(p.id)! } : p,
  );
}

interface PagesState {
  /** Single source of truth for every page's layer tree (`page.layers`). */
  pages: Page[];
  isLoading: boolean;
  error: string | null;
}

interface PagesActions {
  setPages: (pages: Page[]) => void;
  setError: (error: string | null) => void;

  /** Replace the store's page list wholesale from a fresh bootstrap — see CampaignEditorMain.tsx's hydration effect. Callers map raw rows with `pagesFromRows` first. */
  hydrateFromBootstrap: (pages: Page[]) => void;
  /** Clear all page data (called by `useEditorStore.resetForNewCampaign`). */
  reset: () => void;

  updatePageLocal: (pageId: string, updates: Partial<Omit<Page, "id">>) => void;
  removePageLocal: (pageId: string) => void;

  getPageById: (pageId: string) => Page | undefined;

  /**
   * Optimistically create a page (temp id, `body`-only layer tree), then
   * persist. Replaces the temp page with the server's row on success; on
   * failure removes it and un-shifts sibling orders. Never blocks the UI:
   * await `result`, not this call.
   */
  createPage: (
    campaignId: string,
    input: CreatePageInput,
  ) => StartedPageMutation;
  /**
   * Optimistically duplicate `pageId` right after itself (same type/settings,
   * cloned layers), then persist. Same commit / reconcile / rollback shape as
   * `createPage`. The caller decides about selection — this never navigates.
   */
  duplicatePage: (campaignId: string, pageId: string) => StartedPageMutation;
  /** Delete on the server, THEN remove locally. Resolves with the outcome. */
  deletePage: (
    campaignId: string,
    pageId: string,
  ) => Promise<{ success: true } | { success: false; error: string }>;

  /**
   * Re-fetch a single page from the server and replace it in the array
   * immutably (used by undo/redo "restore latest"). Resolves `true` when the
   * page was refreshed, `false` when the fetch failed or the page is gone.
   */
  reloadPage: (pageId: string) => Promise<boolean>;

  setLayers: (pageId: string, layers: Layer[]) => void;
  addLayerWithId: (
    pageId: string,
    parentLayerId: string | null,
    layer: Layer,
  ) => void;
  addLayerFromTemplate: (
    pageId: string,
    selectedLayerId: string | null,
    elementType: EditorElementType,
  ) => { newLayerId: string; parentToExpand: string | null } | null;
  updateLayer: (
    pageId: string,
    layerId: string,
    updates: Partial<Layer>,
  ) => void;
  deleteLayer: (pageId: string, layerId: string) => void;
  deleteLayers: (pageId: string, layerIds: string[]) => void;
  moveLayer: (
    pageId: string,
    layerId: string,
    targetParentId: string | null,
    targetIndex: number,
  ) => boolean;

  copyLayer: (pageId: string, layerId: string) => Layer | null;
  copyLayers: (pageId: string, layerIds: string[]) => Layer[];
  duplicateLayer: (pageId: string, layerId: string) => Layer | null;
  duplicateLayers: (pageId: string, layerIds: string[]) => Layer[];
  pasteAfter: (
    pageId: string,
    targetLayerId: string,
    layerToPaste: Layer,
  ) => Layer | null;

  // CMS Binding Cleanup Actions
  cleanupDeletedCollection: (collectionId: string) => void;
  cleanupDeletedField: (fieldId: string) => void;

  // Component Actions
  createComponentFromLayer: (
    pageId: string,
    layerId: string,
    componentName: string,
  ) => Promise<string | null>;
  updateComponentOnLayers: (componentId: string) => void;
  detachComponentFromAllLayers: (componentId: string) => void;

  pasteInside: (
    pageId: string,
    targetLayerId: string,
    layerToPaste: Layer,
  ) => Layer | null;
}

type PagesStore = PagesState & PagesActions;

/** Update `pageId`'s `layers` in place within the `pages` array. Every mutation below funnels through this. */
function withUpdatedLayers(
  pages: Page[],
  pageId: string,
  layers: Layer[],
): Page[] {
  return pages.map((page) => (page.id === pageId ? { ...page, layers } : page));
}

export const usePagesStore = create<PagesStore>((set, get) => ({
  pages: [],
  isLoading: false,
  error: null,

  setPages: (pages) => set({ pages }),
  setError: (error) => set({ error }),
  // hydrateFromBootstrap: (pages) => set({ pages, error: null }),
  hydrateFromBootstrap: (pages) =>
    set({ pages: pages.map(normalizeLegacyLayerNames), error: null }),
  reset: () => set({ pages: [], isLoading: false, error: null }),

  updatePageLocal: (pageId, updates) => {
    set((state) => ({
      pages: state.pages.map((page) =>
        page.id === pageId ? { ...page, ...updates } : page,
      ),
    }));
  },

  removePageLocal: (pageId) => {
    set((state) => ({
      pages: state.pages.filter((page) => page.id !== pageId),
    }));
  },

  getPageById: (pageId) => get().pages.find((page) => page.id === pageId),

  createPage: (campaignId, input) => {
    const existing = get().pages;
    const tempId = makeTempPageId();
    const now = new Date();

    const tempPage: Page = {
      id: tempId,
      slug: input.slug,
      name: input.name,
      funnelId: existing[0]?.funnelId ?? "",
      order: input.order,
      depth: 0,
      pageType: input.pageType,
      isDynamic: input.isDynamic,
      layers: [{ id: "body", name: "body", classes: "", children: [] }],
      settings: input.settings,
      contentHash: null,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
    };

    const shiftedIds = new Set(
      existing.filter((p) => p.order >= input.order).map((p) => p.id),
    );
    set((state) => ({
      pages: [...shiftOrdersUp(state.pages, input.order), tempPage],
      isLoading: true,
      error: null,
    }));

    const result = (async (): Promise<PageMutationOutcome> => {
      try {
        const response = await createPageAction(campaignId, {
          title: input.name,
          pageType: input.pageType,
          slug: input.slug,
          order: input.order,
          settings: input.settings,
          isDynamic: input.isDynamic,
        });
        if (!response.success) throw new Error(response.error);

        const real = pageFromRow(response.data.page);
        set((state) => ({
          pages: applyOrderUpdates(
            state.pages.map((p) => (p.id === tempId ? real : p)),
            response.data.orderUpdates,
          ),
          isLoading: false,
        }));
        return { success: true, page: real };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to create page.";
        set((state) => ({
          pages: unshiftOrders(
            state.pages.filter((p) => p.id !== tempId),
            shiftedIds,
          ),
          isLoading: false,
          error: message,
        }));
        return { success: false, error: message };
      }
    })();

    return { ok: true, tempId, result };
  },

  duplicatePage: (campaignId, pageId) => {
    const source = get().pages.find((p) => p.id === pageId);
    if (!source)
      return { ok: false, error: "Couldn't find the page to duplicate." };
    if (isTempPageId(pageId)) {
      return { ok: false, error: "Wait for this page to finish saving first." };
    }
    // Mirror the server's rules up front so we never flash an optimistic copy
    // that is guaranteed to roll back: "/" belongs to the landing page, and
    // the dynamic slug ("*") is unique per funnel.
    if (source.pageType === "landing_page") {
      return { ok: false, error: "The landing page can't be duplicated." };
    }
    if (source.isDynamic) {
      return {
        ok: false,
        error:
          "A funnel can only have one dynamic page, so it can't be duplicated.",
      };
    }

    const tempId = makeTempPageId();
    const now = new Date();
    const order = source.order + 1;

    const tempPage: Page = {
      ...source,
      id: tempId,
      name: `${source.name} (Copy)`,
      // Placeholder until the server assigns the final unique slug.
      slug: generateUniqueSlug(
        `${source.name} (Copy)`,
        get().pages,
        null,
        false,
      ),
      order,
      isDynamic: false,
      layers: cloneDeep(source.layers),
      settings: cloneDeep(source.settings),
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
    };

    const shiftedIds = new Set(
      get()
        .pages.filter((p) => p.order >= order)
        .map((p) => p.id),
    );
    set((state) => ({
      pages: [...shiftOrdersUp(state.pages, order), tempPage],
      isLoading: true,
      error: null,
    }));

    const result = (async (): Promise<PageMutationOutcome> => {
      try {
        const response = await duplicatePageAction(campaignId, pageId);
        if (!response.success) throw new Error(response.error);

        const real = pageFromRow(response.data.page);
        set((state) => ({
          pages: applyOrderUpdates(
            state.pages.map((p) => (p.id === tempId ? real : p)),
            response.data.orderUpdates,
          ),
          isLoading: false,
        }));
        return { success: true, page: real };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to duplicate page.";
        set((state) => ({
          pages: unshiftOrders(
            state.pages.filter((p) => p.id !== tempId),
            shiftedIds,
          ),
          isLoading: false,
          error: message,
        }));
        return { success: false, error: message };
      }
    })();

    return { ok: true, tempId, result };
  },

  deletePage: async (campaignId, pageId) => {
    set({ isLoading: true, error: null });
    try {
      const response = await deletePageAction(campaignId, pageId);
      if (!response.success) throw new Error(response.error);
      // Server first: deletion is destructive, so there is nothing to
      // "optimistically" roll back. The caller removes the page locally once
      // it has navigated away (see PagesList's handleDelete).
      set({ isLoading: false });
      return { success: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete page.";
      set({ isLoading: false, error: message });
      return { success: false, error: message };
    }
  },

  reloadPage: async (pageId) => {
    const response = await pagesApi.getById(pageId);
    const fresh = response.data;
    if (response.error || !fresh) return false;

    const normalized: Page = {
      ...fresh,
      layers: Array.isArray(fresh.layers) ? fresh.layers : [],
    };
    set((state) => ({
      pages: state.pages.some((page) => page.id === pageId)
        ? state.pages.map((page) => (page.id === pageId ? normalized : page))
        : state.pages,
    }));
    return true;
  },

  setLayers: (pageId, layers) => {
    set((state) => ({ pages: withUpdatedLayers(state.pages, pageId, layers) }));
  },

  addLayerWithId: (pageId, parentLayerId, layer) => {
    const page = get().pages.find((p) => p.id === pageId);
    if (!page) return;

    const newLayers = !parentLayerId
      ? [...page.layers, layer]
      : updateLayerInTree(page.layers, parentLayerId, (parent) => ({
          ...parent,
          children: [...(parent.children || []), layer],
        }));

    set((state) => ({
      pages: withUpdatedLayers(state.pages, pageId, newLayers),
    }));
  },

  addLayerFromTemplate: (pageId, selectedLayerId, elementType) => {
    const page = get().pages.find((p) => p.id === pageId);
    const template = createElementFromTemplate(elementType);
    if (!page || !template) return null;

    // `name` is the element type ("section", "div", ...) and drives every
    // structural check below — it must stay lowercase. Only the display
    // `customName` is capitalised, and plain divs are left unnamed.
    const templateName = template?.name ?? "div";
    const displayName =
      templateName === "div"
        ? undefined
        : templateName.charAt(0).toUpperCase() + templateName.slice(1);
    const newLayer: Layer = {
      ...template,
      id: generateLayerId("lyr"),
      name: templateName,
      customName: displayName,
    };

    const targetId =
      newLayer.name === "section" ? "body" : (selectedLayerId ?? "body");
    const target = findLayerById(page.layers, targetId);
    const targetLocation = target
      ? findParentAndIndex(page.layers, target.id)
      : null;
    const isFormField = ["input", "textarea", "select", "checkbox"].includes(
      newLayer.name,
    );
    const addAsSibling =
      !!target &&
      !!targetLocation &&
      (!canHaveChildren(target, newLayer.name) ||
        (isFormField && target.name === "form"));

    let newLayers: Layer[];
    let parentToExpand: string | null;
    if (addAsSibling && targetLocation) {
      newLayers = insertLayerAfter(
        page.layers,
        targetLocation.parent,
        targetLocation.index,
        newLayer,
      );
      parentToExpand = targetLocation.parent?.id ?? null;
    } else {
      const parent =
        target && canHaveChildren(target, newLayer.name)
          ? target
          : findLayerById(page.layers, "body");
      if (!parent || !canHaveChildren(parent, newLayer.name)) return null;
      newLayers = updateLayerInTree(page.layers, parent.id, (node) => ({
        ...node,
        children: [...(node.children ?? []), newLayer],
      }));
      parentToExpand = parent.id;
    }

    set((state) => ({
      pages: withUpdatedLayers(state.pages, pageId, newLayers),
    }));
    return { newLayerId: newLayer.id, parentToExpand };
  },

  updateLayer: (pageId, layerId, updates) => {
    const page = get().pages.find((p) => p.id === pageId);
    if (!page) return;

    const newLayers = updateLayerInTree(page.layers, layerId, (layer) => ({
      ...layer,
      ...updates,
    }));
    set((state) => ({
      pages: withUpdatedLayers(state.pages, pageId, newLayers),
    }));
  },

  deleteLayer: (pageId, layerId) => {
    const page = get().pages.find((p) => p.id === pageId);
    if (!page) return;

    const layerToDelete = findLayerById(page.layers, layerId);
    if (layerToDelete?.id === "body") {
      // Matches Ycode: the root layer is never deletable. See
      // layerSchema.ts's convention note on the `'body'` id.
      console.warn("Cannot delete the body layer");
      return;
    }

    const newLayers = removeLayerById(page.layers, layerId);
    set((state) => ({
      pages: withUpdatedLayers(state.pages, pageId, newLayers),
    }));
  },

  deleteLayers: (pageId, layerIds) => {
    const page = get().pages.find((p) => p.id === pageId);
    if (!page || layerIds.length === 0) return;

    const validIds = new Set(
      layerIds.filter(
        (id) => id !== "body" && findLayerById(page.layers, id) !== null,
      ),
    );
    if (validIds.size === 0) return;

    let newLayers = page.layers;
    for (const id of validIds) {
      newLayers = removeLayerById(newLayers, id);
    }
    set((state) => ({
      pages: withUpdatedLayers(state.pages, pageId, newLayers),
    }));
  },

  moveLayer: (pageId, layerId, targetParentId, targetIndex) => {
    const page = get().pages.find((p) => p.id === pageId);
    if (!page) return false;

    if (!canMoveLayer(page.layers, layerId, targetParentId)) {
      console.warn("Cannot move layer — ancestor restriction violated");
      return false;
    }
    if (
      targetParentId === layerId ||
      isDescendant(page.layers, layerId, targetParentId ?? "")
    ) {
      console.warn("Cannot create a circular layer reference");
      return false;
    }
    if (targetParentId) {
      const targetParent = findLayerById(page.layers, targetParentId);
      if (!targetParent || !canHaveChildren(targetParent)) {
        console.warn("Target layer cannot have children");
        return false;
      }
    }

    const layerToMove = findLayerById(page.layers, layerId);
    if (!layerToMove) return false;

    const withoutMoved = removeLayerById(page.layers, layerId);
    const newLayers = insertLayerAt(
      withoutMoved,
      targetParentId,
      targetIndex,
      layerToMove,
    );

    set((state) => ({
      pages: withUpdatedLayers(state.pages, pageId, newLayers),
    }));
    return true;
  },

  copyLayer: (pageId, layerId) => {
    const page = get().pages.find((p) => p.id === pageId);
    if (!page) return null;
    const layer = findLayerById(page.layers, layerId);
    return layer ? cloneDeep(layer) : null;
  },

  copyLayers: (pageId, layerIds) => {
    const { copyLayer } = get();
    const layers: Layer[] = [];
    for (const id of layerIds) {
      const layer = copyLayer(pageId, id);
      if (layer) layers.push(layer);
    }
    return layers;
  },

  duplicateLayer: (pageId, layerId) => {
    const page = get().pages.find((p) => p.id === pageId);
    if (!page) return null;

    const original = findLayerById(page.layers, layerId);
    if (!original) return null;

    const newLayer = regenerateIdsWithInteractionRemapping(cloneDeep(original));

    const location = findParentAndIndex(page.layers, layerId);
    if (!location) return null;

    const newLayers = insertLayerAfter(
      page.layers,
      location.parent,
      location.index,
      newLayer,
    );
    set((state) => ({
      pages: withUpdatedLayers(state.pages, pageId, newLayers),
    }));
    return newLayer;
  },

  duplicateLayers: (pageId, layerIds) => {
    const { duplicateLayer } = get();
    const results: Layer[] = [];
    for (const id of layerIds) {
      const layer = duplicateLayer(pageId, id);
      if (layer) results.push(layer);
    }
    return results;
  },

  pasteAfter: (pageId, targetLayerId, layerToPaste) => {
    const page = get().pages.find((p) => p.id === pageId);
    if (!page) return null;

    const newLayer = regenerateIdsWithInteractionRemapping(
      cloneDeep(layerToPaste),
    );
    const location = findParentAndIndex(page.layers, targetLayerId);
    if (!location) {
      console.error("pasteAfter: target layer not found", targetLayerId);
      return null;
    }

    if (
      location.parent &&
      !canPasteIntoParent(page.layers, location.parent.id, newLayer)
    ) {
      return null;
    }

    // Ycode redirects a root-level paste into `body` rather than allowing
    // a layer to land outside it — matches the same "body is the one true
    // root" convention documented in layerSchema.ts.
    if (location.parent === null) {
      const bodyLayer = page.layers.find((l) => l.id === "body");
      if (bodyLayer) {
        const newLayers = page.layers.map((layer) =>
          layer.id === bodyLayer.id
            ? { ...layer, children: [...(layer.children || []), newLayer] }
            : layer,
        );
        set((state) => ({
          pages: withUpdatedLayers(state.pages, pageId, newLayers),
        }));
        return newLayer;
      }
    }

    const newLayers = insertLayerAfter(
      page.layers,
      location.parent,
      location.index,
      newLayer,
    );
    set((state) => ({
      pages: withUpdatedLayers(state.pages, pageId, newLayers),
    }));
    return newLayer;
  },

  /**
   * Create a component from a layer
   * Extracts the layer tree and creates a component
   * Then replaces the original layer with a component instance
   *
   * IMPORTANT: componentId is preserved in nested layers to support nested components
   */
  createComponentFromLayer: async (pageId, layerId, componentName) => {
    const { getPageById, copyLayer } = get();
    const draft = getPageById(pageId);
    if (!draft) return null;

    const layerToCopy = copyLayer(pageId, layerId);
    if (!layerToCopy) return null;

    // Regenerate IDs so the component's internal layers don't collide with the
    // instance layer that keeps the original id in the page tree.
    const regeneratedLayer = regenerateIdsWithInteractionRemapping(layerToCopy);
    // Strip CMS bindings that won't be valid inside a standalone component
    const cleanedLayers = cleanLayersForComponentCreation([regeneratedLayer]);
    const newComponent = await createComponentViaApi(
      componentName,
      cleanedLayers,
    );
    if (!newComponent) return null;

    // Add to components store
    const { useComponentsStore } = await import("./useComponentsStore");
    const componentsState = useComponentsStore.getState();
    componentsState.setComponents([
      newComponent,
      ...componentsState.components,
    ]);

    // Replace layer with component instance
    const newLayers = replaceLayerWithComponentInstance(
      draft.layers,
      layerId,
      newComponent.id,
    );

    get().setLayers(pageId, newLayers);

    // Generate thumbnail in the background (fire-and-forget)
    triggerThumbnailGeneration(
      newComponent.id,
      newComponent.layers,
      componentsState.components,
    );

    return newComponent.id;
  },

  /**
   * Update all layers using a specific component across all pages
   * Used when a component is updated
   */
  updateComponentOnLayers: (componentId) => {
    set((state) => {
      let mutated = false;
      const pages = state.pages.map((page) => {
        const nextLayers = updateLayersWithComponent(page.layers, componentId);
        if (nextLayers === page.layers) return page;
        mutated = true;
        return { ...page, layers: nextLayers };
      });
      return mutated ? { pages } : state;
    });
  },

  /**
   * Detach a component from all layers across all pages
   * Used when a component is deleted
   * Replaces component instances with the component's actual children layers
   */
  detachComponentFromAllLayers: (componentId) => {
    const { getComponentById } = useComponentsStore.getState();

    // Get the component data to extract its layers
    const component = getComponentById(componentId);

    set((state) => ({
      pages: state.pages.map((page) => {
        const nextLayers = detachComponentFromLayers(
          page.layers,
          componentId,
          component || undefined,
        );
        return nextLayers === page.layers
          ? page
          : { ...page, layers: nextLayers };
      }),
    }));
  },

  /**
   * Reset CMS bindings referencing a deleted collection across every page's
   * layer tree. Clears collection sources and field variables that reference
   * the collection. Pages whose layers are unchanged keep their identity.
   */
  cleanupDeletedCollection: (collectionId) => {
    set((state) => ({
      pages: state.pages.map((page) => {
        const cleaned = resetBindingsForDeletedCollection(
          page.layers,
          collectionId,
        );
        return cleaned === page.layers ? page : { ...page, layers: cleaned };
      }),
    }));
  },

  /**
   * Reset CMS bindings referencing a deleted field across every page's layer
   * tree. Clears field variables, inline variables, and design bindings that
   * use the field. Pages whose layers are unchanged keep their identity.
   */
  cleanupDeletedField: (fieldId) => {
    set((state) => ({
      pages: state.pages.map((page) => {
        const cleaned = resetBindingsForDeletedField(page.layers, fieldId);
        return cleaned === page.layers ? page : { ...page, layers: cleaned };
      }),
    }));
  },

  pasteInside: (pageId, targetLayerId, layerToPaste) => {
    const page = get().pages.find((p) => p.id === pageId);
    if (!page) return null;

    const target = findLayerById(page.layers, targetLayerId);
    if (!target) return null;

    const newLayer = regenerateIdsWithInteractionRemapping(
      cloneDeep(layerToPaste),
    );
    if (!canPasteIntoParent(page.layers, targetLayerId, newLayer)) return null;
    if (!canHaveChildren(target, newLayer.name)) return null;

    const newLayers = updateLayerInTree(
      page.layers,
      targetLayerId,
      (layer) => ({
        ...layer,
        children: [...(layer.children || []), newLayer],
      }),
    );

    set((state) => ({
      pages: withUpdatedLayers(state.pages, pageId, newLayers),
    }));
    return newLayer;
  },
}));
