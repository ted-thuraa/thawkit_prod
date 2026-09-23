// path: src/stores/use-pages-store.ts

"use client";

import { create } from "zustand";
import { cloneDeep } from "lodash";
import type { Layer } from "@/types/funnel";
import type { PageRow } from "@/lib/editor/resolve-editor-bootstrap";
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
  resetBindingsForDeletedCollection,
  resetBindingsForDeletedField,
} from "@/lib/layer-utils";

export interface PageLayers {
  id: string;
  page_id: string;
  layers: Layer[];
  content_hash?: string; // SHA-256 hash of layers and CSS for change detection
  is_published: boolean;
  created_at: string;
  updated_at?: string;
  deleted_at: string | null; // Soft delete timestamp
  generated_css?: string; // Extracted CSS from Play CDN for published pages
}

interface PagesState {
  pages: PageRow[];
  draftsByPageId: Record<string, PageLayers>;
  isLoading: boolean;
  error: string | null;
}

interface PagesActions {
  setPages: (pages: PageRow[]) => void;
  setError: (error: string | null) => void;

  /** Replace the store's page list wholesale from a fresh bootstrap — see CampaignEditorMain.tsx's hydration effect. */
  hydrateFromBootstrap: (pages: PageRow[]) => void;

  updatePageLocal: (pageId: string, updates: Partial<PageRow>) => void;
  removePageLocal: (pageId: string) => void;

  getPageById: (pageId: string) => PageRow | undefined;

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

  pasteInside: (
    pageId: string,
    targetLayerId: string,
    layerToPaste: Layer,
  ) => Layer | null;
}

type PagesStore = PagesState & PagesActions;

/** Update `pageId`'s `layers` in place within the `pages` array. Every mutation below funnels through this. */
function withUpdatedLayers(
  pages: PageRow[],
  pageId: string,
  layers: Layer[],
): PageRow[] {
  return pages.map((page) => (page.id === pageId ? { ...page, layers } : page));
}

export const usePagesStore = create<PagesStore>((set, get) => ({
  pages: [],
  draftsByPageId: {},
  isLoading: false,
  error: null,

  setPages: (pages) => set({ pages }),
  setError: (error) => set({ error }),
  hydrateFromBootstrap: (pages) => set({ pages, error: null }),

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

    const newLayer: Layer = {
      ...template,
      id: generateLayerId("lyr"),
      name:
        template.name === "div"
          ? undefined
          : template.name.charAt(0).toUpperCase() + template.name.slice(1),
      customName:
        template.name === "div"
          ? undefined
          : template.name.charAt(0).toUpperCase() + template.name.slice(1),
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
   * Reset CMS bindings referencing a deleted collection across all page drafts.
   * Clears collection sources and field variables that reference the collection.
   */
  cleanupDeletedCollection: (collectionId) => {
    const { draftsByPageId } = get();
    const updatedDrafts = { ...draftsByPageId };

    Object.keys(updatedDrafts).forEach((pageId) => {
      const draft = updatedDrafts[pageId];
      const cleaned = resetBindingsForDeletedCollection(
        draft.layers,
        collectionId,
      );
      if (cleaned !== draft.layers) {
        updatedDrafts[pageId] = { ...draft, layers: cleaned };
      }
    });

    set({ draftsByPageId: updatedDrafts });
  },
  /**
   * Reset CMS bindings referencing a deleted field across all page drafts.
   * Clears field variables, inline variables, and design bindings that use the field.
   */
  cleanupDeletedField: (fieldId) => {
    const { draftsByPageId } = get();
    const updatedDrafts = { ...draftsByPageId };

    Object.keys(updatedDrafts).forEach((pageId) => {
      const draft = updatedDrafts[pageId];
      const cleaned = resetBindingsForDeletedField(draft.layers, fieldId);
      if (cleaned !== draft.layers) {
        updatedDrafts[pageId] = { ...draft, layers: cleaned };
      }
    });

    set({ draftsByPageId: updatedDrafts });
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
