// path: src/stores/editor/usePagesStore.ts

"use client";

import { create } from "zustand";
import { cloneDeep, isEqual } from "lodash";
import type {
  Layer,
  LayerStyle,
  Page,
  PageLayers,
  PageSettings,
  PageType,
} from "@/types/funnel";
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
import { useEditorBootstrapStore } from "./useEditorBootstrapStore";
import {
  createPageAction,
  deletePageAction,
  duplicatePageAction,
  savePageLayersAction,
  type PageOrderUpdate,
} from "@/actions/editor/editor-actions";
import { pagesReadApi } from "@/lib/editor/editor-read-api";
import { pageFromRow, pageLayersFromRow } from "@/lib/editor/page-from-row";
import { generateUniqueSlug } from "@/lib/page-utils";

import {
  detachComponentFromLayers,
  updateLayersWithComponent,
} from "@/lib/component-utils";
import {
  detachStyleFromLayers,
  updateLayersWithStyle,
} from "@/lib/layer-style-utils";

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

function normalizeLegacyLayerNames(layers: Layer[]): Layer[] {
  const fix = (layer: Layer): Layer => {
    const lower = layer.name.toLowerCase();
    const name =
      layer.name !== lower && LEGACY_CAPITALISED_NAMES.has(lower)
        ? lower
        : layer.name;
    return { ...layer, name, children: layer.children?.map(fix) };
  };
  return layers.map(fix);
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

/** Where a page's layer tree is in the autosave cycle. Absent from the map = `"idle"`. */
export type PageSaveStatus = "idle" | "dirty" | "saving" | "error";

/** The whole editor's save state, aggregated across pages (for the header). */
export type EditorSaveState = "saved" | "unsaved" | "saving" | "error";

/** Quiet period after the last edit before a page is saved. */
export const AUTOSAVE_DEBOUNCE_MS = 2000;
/** After a failed save: retry after each of these delays, then wait for the next edit. */
const AUTOSAVE_RETRY_DELAYS_MS = [2000, 5000, 15000] as const;

/** Stable empty tree — selectors return this instead of a fresh `[]`, which would re-render on every store update. */
export const EMPTY_LAYERS: Layer[] = [];

interface PagesState {
  /** Page METADATA only (name, slug, order, type, settings…). Never holds layers. */
  pages: Page[];
  /**
   * The editor's working copy of EVERY page's layer tree, keyed by page id —
   * the single source of truth for layers while a page is being edited.
   *
   * Lifecycle of an edit: read the entry → modify its `layers` immutably →
   * write it back (all writes go through one commit path) → the page is
   * autosaved 2 s after the last edit → publishing is a separate, explicit
   * action that snapshots the SAVED rows.
   */
  pagesByPageId: Record<string, PageLayers>;
  /** Autosave status per page. Pages not present are `"idle"` (nothing unsaved). */
  saveStatusByPageId: Record<string, PageSaveStatus>;
  /** Message of the most recent failed save; cleared once no page is in error. */
  saveError: string | null;
  isLoading: boolean;
  error: string | null;
}

interface PagesActions {
  /** Replace the page METADATA list. Layer trees are untouched (missing entries are seeded empty). */
  setPages: (pages: Page[]) => void;
  setError: (error: string | null) => void;

  /**
   * Replace everything from a fresh bootstrap: page metadata plus one layer
   * tree per page. Nothing is marked unsaved — this IS the saved state.
   */
  hydrateFromBootstrap: (pages: Page[], pageLayers: PageLayers[]) => void;
  /** Clear all page data and cancel pending saves (called by `useEditorStore.resetForNewCampaign`). Call `flushPendingSaves` first if unsaved edits must survive. */
  reset: () => void;

  updatePageLocal: (pageId: string, updates: Partial<Omit<Page, "id">>) => void;
  /** Remove a page's metadata AND its working copy; cancels its pending save. */
  removePageLocal: (pageId: string) => void;

  getPageById: (pageId: string) => Page | undefined;
  /** The page's working copy (`pagesByPageId[pageId]`). */
  getPageLayers: (pageId: string) => PageLayers | undefined;
  /** Shorthand for `getPageLayers(pageId)?.layers`. */
  getLayers: (pageId: string) => Layer[] | undefined;

  /**
   * Optimistically create a page (temp id, `body`-only layer tree), then
   * persist. Replaces the temp page with the server's row on success; on
   * failure removes it and un-shifts sibling orders. Never blocks the UI:
   * await `result`, not this call. Layer edits made to the temp page before
   * the server answers are carried over to the real page and saved.
   */
  createPage: (
    campaignId: string,
    input: CreatePageInput,
  ) => StartedPageMutation;
  /**
   * Optimistically duplicate `pageId` right after itself (same type/settings,
   * cloned layers), then persist. Unsaved edits to the source are saved first
   * so the server copies the latest tree. Same commit / reconcile / rollback
   * shape as `createPage`. The caller decides about selection — this never
   * navigates.
   */
  duplicatePage: (campaignId: string, pageId: string) => StartedPageMutation;
  /** Delete on the server, THEN remove locally. Resolves with the outcome. */
  deletePage: (
    campaignId: string,
    pageId: string,
  ) => Promise<{ success: true } | { success: false; error: string }>;

  /**
   * Replace a page's working copy with the last SAVED tree from the server
   * (undo/redo "restore latest"). Resolves `true` when refreshed, `false`
   * when the fetch failed or the page is gone.
   */
  reloadPage: (pageId: string) => Promise<boolean>;

  // ── Autosave ──────────────────────────────────────────────────────────
  /** Save one page now, skipping the debounce. Resolves `true` when it is saved (or had nothing to save). */
  savePageNow: (pageId: string) => Promise<boolean>;
  /** Save every page with unsaved changes. Resolves `true` only if all of them saved. Call before publishing. */
  flushPendingSaves: () => Promise<boolean>;

  /** The canonical layer write: replaces the page's tree, marks it unsaved and schedules its autosave. */
  setLayers: (pageId: string, layers: Layer[]) => void;
  /**
   * Apply `transform` to EVERY page's tree in one store update (component /
   * style / collection / color-variable changes that span pages). Pages whose
   * tree comes back identical (same reference, or deep-equal) are left alone —
   * not marked unsaved, not re-saved. Resolves with the ids that changed.
   */
  transformAllPageLayers: (
    transform: (layers: Layer[], pageId: string) => Layer[],
  ) => string[];

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

  // Layer Style Actions
  updateStyleOnLayers: (
    styleId: string,
    stylesById: Map<string, LayerStyle>,
  ) => void;
  detachStyleFromAllLayers: (
    styleId: string,
    stylesById?: Map<string, LayerStyle>,
  ) => void;

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

export type PagesStore = PagesState & PagesActions;

/** Selector factory: `usePagesStore(selectPageLayers(pageId))` — re-renders only when THAT page's tree changes. */
export const selectPageLayers =
  (pageId: string | null | undefined) =>
  (state: PagesStore): Layer[] | undefined =>
    pageId ? state.pagesByPageId[pageId]?.layers : undefined;

/** Aggregate save state for the header: error > saving > unsaved > saved. */
export const selectSaveState = (state: PagesStore): EditorSaveState => {
  let result: EditorSaveState = "saved";
  for (const status of Object.values(state.saveStatusByPageId)) {
    if (status === "error") return "error";
    if (status === "saving") result = "saving";
    else if (status === "dirty" && result === "saved") result = "unsaved";
  }
  return result;
};

function emptyPageLayers(pageId: string): PageLayers {
  const now = new Date().toISOString();
  return {
    id: pageId,
    page_id: pageId,
    layers: [],
    is_published: false,
    content_hash: null,
    created_at: now,
    updated_at: now,
  };
}

// ─── Autosave runtime ───────────────────────────────────────────────────────
// Timers and in-flight requests are not React state: nothing renders from
// them, and they must survive store updates. They are module-level, cleared
// by `reset` / `hydrateFromBootstrap`, and keyed by page id so each page has
// its own independent debounce.
const autosaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const inflightSaves = new Map<string, Promise<boolean>>();
const retryAttempts = new Map<string, number>();

function clearAutosaveTimer(pageId: string): void {
  const timer = autosaveTimers.get(pageId);
  if (timer !== undefined) {
    clearTimeout(timer);
    autosaveTimers.delete(pageId);
  }
}

function clearAutosaveRuntime(): void {
  for (const timer of autosaveTimers.values()) clearTimeout(timer);
  autosaveTimers.clear();
  inflightSaves.clear();
  retryAttempts.clear();
}

export const usePagesStore = create<PagesStore>((set, get) => {
  // ─── Internal: save-status bookkeeping ──────────────────────────────────

  /** Set one page's status without notifying subscribers when it is unchanged. */
  const setStatus = (pageId: string, status: PageSaveStatus) => {
    if ((get().saveStatusByPageId[pageId] ?? "idle") === status) return;
    set((state) => {
      const next = { ...state.saveStatusByPageId };
      if (status === "idle") delete next[pageId];
      else next[pageId] = status;
      return { saveStatusByPageId: next };
    });
  };

  /** (Re)start a page's debounce. A new edit also resets its retry budget. */
  const scheduleAutosave = (pageId: string) => {
    // A temp page has no database row yet — nothing to save until the server
    // confirms it, at which point the edit is carried over (see createPage).
    if (isTempPageId(pageId)) return;

    retryAttempts.delete(pageId);
    clearAutosaveTimer(pageId);
    autosaveTimers.set(
      pageId,
      setTimeout(() => {
        autosaveTimers.delete(pageId);
        void savePageNow(pageId);
      }, AUTOSAVE_DEBOUNCE_MS),
    );
  };

  /**
   * The ONE place a page's tree is written. Replaces each tree immutably,
   * marks the page unsaved and schedules its autosave — all in a single
   * store update. A write that does not change the tree (same reference) is
   * ignored, so a no-op never triggers a save.
   */
  const commitLayersMany = (changes: Record<string, Layer[]>): string[] => {
    const applied = Object.keys(changes).filter(
      (pageId) =>
        get().pagesByPageId[pageId] &&
        get().pagesByPageId[pageId].layers !== changes[pageId],
    );
    if (applied.length === 0) return applied;

    set((state) => {
      const pagesByPageId = { ...state.pagesByPageId };
      let saveStatusByPageId = state.saveStatusByPageId;
      for (const pageId of applied) {
        pagesByPageId[pageId] = {
          ...state.pagesByPageId[pageId],
          layers: changes[pageId],
        };
        const status = saveStatusByPageId[pageId];
        // `saving` stays `saving` until the in-flight request answers; it
        // then notices the tree moved on and flips to `dirty` itself.
        if (status !== "dirty" && status !== "saving") {
          if (saveStatusByPageId === state.saveStatusByPageId) {
            saveStatusByPageId = { ...saveStatusByPageId };
          }
          saveStatusByPageId[pageId] = "dirty";
        }
      }
      return { pagesByPageId, saveStatusByPageId };
    });

    applied.forEach(scheduleAutosave);
    return applied;
  };

  const commitLayers = (pageId: string, layers: Layer[]) => {
    commitLayersMany({ [pageId]: layers });
  };

  // ─── Internal: the save itself ──────────────────────────────────────────

  const runSave = async (
    pageId: string,
    savedLayers: Layer[],
  ): Promise<boolean> => {
    // Captured synchronously, before the first `await`: a caller that
    // immediately resets the stores (campaign switch) still gets this save
    // sent against the campaign the edits belong to.
    const campaignId = useEditorBootstrapStore.getState().campaignId;
    if (!campaignId) return false;

    setStatus(pageId, "saving");

    let result: Awaited<ReturnType<typeof savePageLayersAction>>;
    try {
      result = await savePageLayersAction(campaignId, pageId, savedLayers);
    } catch (error) {
      result = {
        success: false,
        error: error instanceof Error ? error.message : "Failed to save page.",
      };
    }

    // The editor moved to another campaign, or the page was removed, while
    // the request was in flight: the write itself went through, but this
    // store must not be touched with a result that no longer belongs to it.
    if (useEditorBootstrapStore.getState().campaignId !== campaignId) {
      return result.success;
    }
    if (!get().pagesByPageId[pageId]) return result.success;

    if (!result.success) {
      setStatus(pageId, "error");
      set({ saveError: result.error });

      const attempt = retryAttempts.get(pageId) ?? 0;
      if (attempt < AUTOSAVE_RETRY_DELAYS_MS.length) {
        retryAttempts.set(pageId, attempt + 1);
        clearAutosaveTimer(pageId);
        autosaveTimers.set(
          pageId,
          setTimeout(() => {
            autosaveTimers.delete(pageId);
            void savePageNow(pageId);
          }, AUTOSAVE_RETRY_DELAYS_MS[attempt]),
        );
      }
      return false;
    }

    retryAttempts.delete(pageId);

    // Edits that landed while the request was in flight are NOT in what was
    // sent. Layers are updated immutably, so a reference check is exact: if
    // the tree is still the one we sent, the page is clean; otherwise it is
    // dirty again and a follow-up save is already (or about to be) scheduled.
    const unchanged = get().pagesByPageId[pageId].layers === savedLayers;
    const savedAt = new Date(result.data.savedAt);

    set((state) => {
      const entry = state.pagesByPageId[pageId];
      const saveStatusByPageId = { ...state.saveStatusByPageId };
      if (unchanged) delete saveStatusByPageId[pageId];
      else saveStatusByPageId[pageId] = "dirty";

      return {
        pagesByPageId: {
          ...state.pagesByPageId,
          // New entry object, SAME `layers` reference — selectors on `.layers`
          // are not notified, so a save never re-renders the canvas.
          [pageId]: { ...entry, updated_at: savedAt.toISOString() },
        },
        pages: state.pages.map((page) =>
          page.id === pageId ? { ...page, updatedAt: savedAt } : page,
        ),
        saveStatusByPageId,
        saveError: Object.values(saveStatusByPageId).includes("error")
          ? state.saveError
          : null,
      };
    });

    if (!unchanged && !autosaveTimers.has(pageId)) scheduleAutosave(pageId);
    return true;
  };

  const savePageNow = (pageId: string): Promise<boolean> => {
    clearAutosaveTimer(pageId);

    // One save per page at a time, so requests can never land out of order.
    // Wait for the running one, then save again only if edits arrived since.
    const running = inflightSaves.get(pageId);
    if (running) {
      return running.then(() =>
        (get().saveStatusByPageId[pageId] ?? "idle") === "idle"
          ? true
          : savePageNow(pageId),
      );
    }

    const entry = get().pagesByPageId[pageId];
    if (!entry) return Promise.resolve(true);
    if (isTempPageId(pageId)) return Promise.resolve(false);
    if ((get().saveStatusByPageId[pageId] ?? "idle") === "idle") {
      return Promise.resolve(true);
    }

    const promise = runSave(pageId, entry.layers).finally(() => {
      if (inflightSaves.get(pageId) === promise) inflightSaves.delete(pageId);
    });
    inflightSaves.set(pageId, promise);
    return promise;
  };

  // ─── Internal: cross-page change helper ─────────────────────────────────

  const transformAll = (
    transform: (layers: Layer[], pageId: string) => Layer[],
  ): string[] => {
    const changes: Record<string, Layer[]> = {};
    for (const [pageId, entry] of Object.entries(get().pagesByPageId)) {
      const next = transform(entry.layers, pageId);
      // Utilities that rebuild the tree on every call return a new array
      // even when nothing changed; deep-equal keeps those pages clean.
      if (next === entry.layers || isEqual(next, entry.layers)) continue;
      changes[pageId] = next;
    }
    return commitLayersMany(changes);
  };

  const requireLayers = (pageId: string): Layer[] | undefined =>
    get().pagesByPageId[pageId]?.layers;

  return {
    pages: [],
    pagesByPageId: {},
    saveStatusByPageId: {},
    saveError: null,
    isLoading: false,
    error: null,

    setPages: (pages) =>
      set((state) => {
        // Keep the invariant "every page has a working copy".
        const missing = pages.filter((page) => !state.pagesByPageId[page.id]);
        if (missing.length === 0) return { pages };
        const pagesByPageId = { ...state.pagesByPageId };
        for (const page of missing) {
          pagesByPageId[page.id] = emptyPageLayers(page.id);
        }
        return { pages, pagesByPageId };
      }),
    setError: (error) => set({ error }),

    hydrateFromBootstrap: (pages, pageLayers) => {
      clearAutosaveRuntime();

      const known = new Set(pages.map((page) => page.id));
      const pagesByPageId: Record<string, PageLayers> = {};
      for (const entry of pageLayers) {
        if (!known.has(entry.page_id)) continue;
        pagesByPageId[entry.page_id] = {
          ...entry,
          layers: normalizeLegacyLayerNames(entry.layers),
        };
      }
      // A page whose row had no layers still gets a working copy.
      for (const page of pages) {
        if (!pagesByPageId[page.id]) {
          pagesByPageId[page.id] = emptyPageLayers(page.id);
        }
      }

      set({
        pages,
        pagesByPageId,
        saveStatusByPageId: {},
        saveError: null,
        error: null,
      });
    },

    reset: () => {
      clearAutosaveRuntime();
      set({
        pages: [],
        pagesByPageId: {},
        saveStatusByPageId: {},
        saveError: null,
        isLoading: false,
        error: null,
      });
    },

    updatePageLocal: (pageId, updates) => {
      set((state) => ({
        pages: state.pages.map((page) =>
          page.id === pageId ? { ...page, ...updates } : page,
        ),
      }));
    },

    removePageLocal: (pageId) => {
      clearAutosaveTimer(pageId);
      retryAttempts.delete(pageId);
      set((state) => {
        const { [pageId]: _removed, ...pagesByPageId } = state.pagesByPageId;
        const { [pageId]: _status, ...saveStatusByPageId } =
          state.saveStatusByPageId;
        void _removed;
        void _status;
        return {
          pages: state.pages.filter((page) => page.id !== pageId),
          pagesByPageId,
          saveStatusByPageId,
        };
      });
    },

    getPageById: (pageId) => get().pages.find((page) => page.id === pageId),
    getPageLayers: (pageId) => get().pagesByPageId[pageId],
    getLayers: (pageId) => get().pagesByPageId[pageId]?.layers,

    createPage: (campaignId, input) => {
      const existing = get().pages;
      const tempId = makeTempPageId();
      const now = new Date();
      const initialLayers: Layer[] = [
        { id: "body", name: "body", classes: "", children: [] },
      ];

      const tempPage: Page = {
        id: tempId,
        slug: input.slug,
        name: input.name,
        funnelId: existing[0]?.funnelId ?? "",
        order: input.order,
        depth: 0,
        pageType: input.pageType,
        isDynamic: input.isDynamic,
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
        pagesByPageId: {
          ...state.pagesByPageId,
          [tempId]: { ...emptyPageLayers(tempId), layers: initialLayers },
        },
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
          const realLayers = pageLayersFromRow(response.data.page);
          // The user may have edited the temp page while the server worked.
          // Those edits exist only here, so they win over the server's tree.
          const editedWhilePending =
            get().pagesByPageId[tempId]?.layers !== undefined &&
            get().pagesByPageId[tempId].layers !== initialLayers;
          const carriedLayers = get().pagesByPageId[tempId]?.layers;

          set((state) => {
            const { [tempId]: _temp, ...pagesByPageId } = state.pagesByPageId;
            const { [tempId]: _tempStatus, ...saveStatusByPageId } =
              state.saveStatusByPageId;
            void _temp;
            void _tempStatus;
            return {
              pages: applyOrderUpdates(
                state.pages.map((p) => (p.id === tempId ? real : p)),
                response.data.orderUpdates,
              ),
              pagesByPageId: {
                ...pagesByPageId,
                [real.id]:
                  editedWhilePending && carriedLayers
                    ? { ...realLayers, layers: carriedLayers }
                    : realLayers,
              },
              saveStatusByPageId: editedWhilePending
                ? { ...saveStatusByPageId, [real.id]: "dirty" }
                : saveStatusByPageId,
              isLoading: false,
            };
          });
          if (editedWhilePending) scheduleAutosave(real.id);

          return { success: true, page: real };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Failed to create page.";
          set((state) => {
            const { [tempId]: _temp, ...pagesByPageId } = state.pagesByPageId;
            const { [tempId]: _tempStatus, ...saveStatusByPageId } =
              state.saveStatusByPageId;
            void _temp;
            void _tempStatus;
            return {
              pages: unshiftOrders(
                state.pages.filter((p) => p.id !== tempId),
                shiftedIds,
              ),
              pagesByPageId,
              saveStatusByPageId,
              isLoading: false,
              error: message,
            };
          });
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
        return {
          ok: false,
          error: "Wait for this page to finish saving first.",
        };
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
      const initialLayers = cloneDeep(requireLayers(pageId) ?? []);

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
        pagesByPageId: {
          ...state.pagesByPageId,
          [tempId]: { ...emptyPageLayers(tempId), layers: initialLayers },
        },
        isLoading: true,
        error: null,
      }));

      const result = (async (): Promise<PageMutationOutcome> => {
        try {
          // The server copies the SAVED tree. If the source has edits still
          // inside the autosave window, save them first so the copy is current.
          const sourceSaved = await savePageNow(pageId);

          const response = await duplicatePageAction(campaignId, pageId);
          if (!response.success) throw new Error(response.error);

          const real = pageFromRow(response.data.page);
          const realLayers = pageLayersFromRow(response.data.page);
          const tempLayers = get().pagesByPageId[tempId]?.layers;
          // Keep the local tree when the user edited the copy meanwhile, or
          // when the source could not be saved (the server copy would be stale).
          const keepLocal =
            !!tempLayers && (tempLayers !== initialLayers || !sourceSaved);

          set((state) => {
            const { [tempId]: _temp, ...pagesByPageId } = state.pagesByPageId;
            const { [tempId]: _tempStatus, ...saveStatusByPageId } =
              state.saveStatusByPageId;
            void _temp;
            void _tempStatus;
            return {
              pages: applyOrderUpdates(
                state.pages.map((p) => (p.id === tempId ? real : p)),
                response.data.orderUpdates,
              ),
              pagesByPageId: {
                ...pagesByPageId,
                [real.id]:
                  keepLocal && tempLayers
                    ? { ...realLayers, layers: tempLayers }
                    : realLayers,
              },
              saveStatusByPageId: keepLocal
                ? { ...saveStatusByPageId, [real.id]: "dirty" }
                : saveStatusByPageId,
              isLoading: false,
            };
          });
          if (keepLocal) scheduleAutosave(real.id);

          return { success: true, page: real };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Failed to duplicate page.";
          set((state) => {
            const { [tempId]: _temp, ...pagesByPageId } = state.pagesByPageId;
            const { [tempId]: _tempStatus, ...saveStatusByPageId } =
              state.saveStatusByPageId;
            void _temp;
            void _tempStatus;
            return {
              pages: unshiftOrders(
                state.pages.filter((p) => p.id !== tempId),
                shiftedIds,
              ),
              pagesByPageId,
              saveStatusByPageId,
              isLoading: false,
              error: message,
            };
          });
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
      const response = await pagesReadApi.getLayers(pageId);
      if (response.error || !response.data) return false;

      const layers = normalizeLegacyLayerNames(response.data.layers);
      if (!get().pagesByPageId[pageId]) return false;

      // What the server holds IS the saved state, so the page is clean again
      // and any pending save of the version we just replaced is cancelled.
      clearAutosaveTimer(pageId);
      retryAttempts.delete(pageId);
      set((state) => {
        const entry = state.pagesByPageId[pageId];
        if (!entry) return state;
        const saveStatusByPageId = { ...state.saveStatusByPageId };
        delete saveStatusByPageId[pageId];
        return {
          pagesByPageId: {
            ...state.pagesByPageId,
            [pageId]: {
              ...entry,
              layers,
              updated_at: response.data!.updatedAt,
            },
          },
          saveStatusByPageId,
        };
      });
      return true;
    },

    savePageNow,

    flushPendingSaves: async () => {
      // `savePageNow` takes its synchronous snapshot (campaign id, tree) when
      // called, so this is safe to invoke right before a reset.
      const pending = Object.entries(get().saveStatusByPageId)
        .filter(([pageId, status]) => status !== "idle" && !isTempPageId(pageId))
        .map(([pageId]) => pageId);
      const results = await Promise.all(pending.map((id) => savePageNow(id)));
      return results.every(Boolean);
    },

    setLayers: (pageId, layers) => {
      commitLayers(pageId, layers);
    },

    transformAllPageLayers: (transform) => transformAll(transform),

    addLayerWithId: (pageId, parentLayerId, layer) => {
      const layers = requireLayers(pageId);
      if (!layers) return;

      const newLayers = !parentLayerId
        ? [...layers, layer]
        : updateLayerInTree(layers, parentLayerId, (parent) => ({
            ...parent,
            children: [...(parent.children || []), layer],
          }));

      commitLayers(pageId, newLayers);
    },

    addLayerFromTemplate: (pageId, selectedLayerId, elementType) => {
      const layers = requireLayers(pageId);
      const template = createElementFromTemplate(elementType);
      if (!layers || !template) return null;

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
      const target = findLayerById(layers, targetId);
      const targetLocation = target
        ? findParentAndIndex(layers, target.id)
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
          layers,
          targetLocation.parent,
          targetLocation.index,
          newLayer,
        );
        parentToExpand = targetLocation.parent?.id ?? null;
      } else {
        const parent =
          target && canHaveChildren(target, newLayer.name)
            ? target
            : findLayerById(layers, "body");
        if (!parent || !canHaveChildren(parent, newLayer.name)) return null;
        newLayers = updateLayerInTree(layers, parent.id, (node) => ({
          ...node,
          children: [...(node.children ?? []), newLayer],
        }));
        parentToExpand = parent.id;
      }

      commitLayers(pageId, newLayers);
      return { newLayerId: newLayer.id, parentToExpand };
    },

    updateLayer: (pageId, layerId, updates) => {
      const layers = requireLayers(pageId);
      if (!layers) return;

      commitLayers(
        pageId,
        updateLayerInTree(layers, layerId, (layer) => ({
          ...layer,
          ...updates,
        })),
      );
    },

    deleteLayer: (pageId, layerId) => {
      const layers = requireLayers(pageId);
      if (!layers) return;

      const layerToDelete = findLayerById(layers, layerId);
      if (layerToDelete?.id === "body") {
        // Matches Ycode: the root layer is never deletable. See
        // layerSchema.ts's convention note on the `'body'` id.
        console.warn("Cannot delete the body layer");
        return;
      }

      commitLayers(pageId, removeLayerById(layers, layerId));
    },

    deleteLayers: (pageId, layerIds) => {
      const layers = requireLayers(pageId);
      if (!layers || layerIds.length === 0) return;

      const validIds = new Set(
        layerIds.filter(
          (id) => id !== "body" && findLayerById(layers, id) !== null,
        ),
      );
      if (validIds.size === 0) return;

      let newLayers = layers;
      for (const id of validIds) {
        newLayers = removeLayerById(newLayers, id);
      }
      commitLayers(pageId, newLayers);
    },

    moveLayer: (pageId, layerId, targetParentId, targetIndex) => {
      const layers = requireLayers(pageId);
      if (!layers) return false;

      if (!canMoveLayer(layers, layerId, targetParentId)) {
        console.warn("Cannot move layer — ancestor restriction violated");
        return false;
      }
      if (
        targetParentId === layerId ||
        isDescendant(layers, layerId, targetParentId ?? "")
      ) {
        console.warn("Cannot create a circular layer reference");
        return false;
      }
      if (targetParentId) {
        const targetParent = findLayerById(layers, targetParentId);
        if (!targetParent || !canHaveChildren(targetParent)) {
          console.warn("Target layer cannot have children");
          return false;
        }
      }

      const layerToMove = findLayerById(layers, layerId);
      if (!layerToMove) return false;

      const withoutMoved = removeLayerById(layers, layerId);
      commitLayers(
        pageId,
        insertLayerAt(withoutMoved, targetParentId, targetIndex, layerToMove),
      );
      return true;
    },

    copyLayer: (pageId, layerId) => {
      const layers = requireLayers(pageId);
      if (!layers) return null;
      const layer = findLayerById(layers, layerId);
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
      const layers = requireLayers(pageId);
      if (!layers) return null;

      const original = findLayerById(layers, layerId);
      if (!original) return null;

      const newLayer = regenerateIdsWithInteractionRemapping(
        cloneDeep(original),
      );

      const location = findParentAndIndex(layers, layerId);
      if (!location) return null;

      commitLayers(
        pageId,
        insertLayerAfter(layers, location.parent, location.index, newLayer),
      );
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
      const layers = requireLayers(pageId);
      if (!layers) return null;

      const newLayer = regenerateIdsWithInteractionRemapping(
        cloneDeep(layerToPaste),
      );
      const location = findParentAndIndex(layers, targetLayerId);
      if (!location) {
        console.error("pasteAfter: target layer not found", targetLayerId);
        return null;
      }

      if (
        location.parent &&
        !canPasteIntoParent(layers, location.parent.id, newLayer)
      ) {
        return null;
      }

      // Ycode redirects a root-level paste into `body` rather than allowing
      // a layer to land outside it — matches the same "body is the one true
      // root" convention documented in layerSchema.ts.
      if (location.parent === null) {
        const bodyLayer = layers.find((l) => l.id === "body");
        if (bodyLayer) {
          commitLayers(
            pageId,
            layers.map((layer) =>
              layer.id === bodyLayer.id
                ? { ...layer, children: [...(layer.children || []), newLayer] }
                : layer,
            ),
          );
          return newLayer;
        }
      }

      commitLayers(
        pageId,
        insertLayerAfter(layers, location.parent, location.index, newLayer),
      );
      return newLayer;
    },

    pasteInside: (pageId, targetLayerId, layerToPaste) => {
      const layers = requireLayers(pageId);
      if (!layers) return null;

      const target = findLayerById(layers, targetLayerId);
      if (!target) return null;

      const newLayer = regenerateIdsWithInteractionRemapping(
        cloneDeep(layerToPaste),
      );
      if (!canPasteIntoParent(layers, targetLayerId, newLayer)) return null;
      if (!canHaveChildren(target, newLayer.name)) return null;

      commitLayers(
        pageId,
        updateLayerInTree(layers, targetLayerId, (layer) => ({
          ...layer,
          children: [...(layer.children || []), newLayer],
        })),
      );
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
      const { copyLayer } = get();
      const pageLayers = requireLayers(pageId);
      if (!pageLayers) return null;

      const layerToCopy = copyLayer(pageId, layerId);
      if (!layerToCopy) return null;

      // Regenerate IDs so the component's internal layers don't collide with the
      // instance layer that keeps the original id in the page tree.
      const regeneratedLayer =
        regenerateIdsWithInteractionRemapping(layerToCopy);
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

      // Replace layer with component instance. Re-read the tree: the page
      // may have been edited while the component was being created.
      const latest = requireLayers(pageId);
      if (!latest) return newComponent.id;
      get().setLayers(
        pageId,
        replaceLayerWithComponentInstance(latest, layerId, newComponent.id),
      );

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
      transformAll((layers) => updateLayersWithComponent(layers, componentId));
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

      transformAll((layers) =>
        detachComponentFromLayers(layers, componentId, component || undefined),
      );
    },

    /**
     * Update all layers using a specific style across all pages
     * Used when a style is updated
     * Updates the classes/design on layers that have the style applied
     */
    updateStyleOnLayers: (styleId, stylesById) => {
      transformAll((layers) =>
        updateLayersWithStyle(layers, styleId, stylesById),
      );
    },

    /**
     * Detach a style from all layers across all pages
     * Used when a style is deleted
     * Removes the style from each layer's stack, re-flattening remaining styles
     */
    detachStyleFromAllLayers: (styleId, stylesById) => {
      transformAll((layers) =>
        detachStyleFromLayers(layers, styleId, stylesById),
      );
    },

    /**
     * Reset CMS bindings referencing a deleted collection across every page's
     * layer tree. Clears collection sources and field variables that reference
     * the collection. Pages whose layers are unchanged are left alone.
     */
    cleanupDeletedCollection: (collectionId) => {
      transformAll((layers) =>
        resetBindingsForDeletedCollection(layers, collectionId),
      );
    },

    /**
     * Reset CMS bindings referencing a deleted field across every page's layer
     * tree. Clears field variables, inline variables, and design bindings that
     * use the field. Pages whose layers are unchanged are left alone.
     */
    cleanupDeletedField: (fieldId) => {
      transformAll((layers) => resetBindingsForDeletedField(layers, fieldId));
    },
  };
});
