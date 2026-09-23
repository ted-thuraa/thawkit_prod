// path: src/stores/use-editor-store.ts

"use client";

import { create } from "zustand";
import type { Layer, Breakpoint, UIState } from "@/types/funnel";
import { scheduleLayerIdUrlUpdate } from "@/hooks/use-editor-url";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Pruned port of Ycode's stores/useEditorStore.ts (813 lines,
 * github.com/ycode/ycode, MIT licensed) — pure interaction/UI state for
 * the editor: selection, breakpoint/UI-state, undo/redo history,
 * component-edit-mode navigation, canvas drag-and-drop, and a handful of
 * small UI flags. Nothing here touches persisted data — see
 * use-pages-store.ts for the actual layer tree.
 *
 * EXCLUDED FROM THIS PORT, with reasons:
 *   - Every `ai*` field/action (setAiActiveLayerIds, aiBuildingPageId,
 *     canvasEnterLayerIds/canvasEnterNonce, aiOpenedComponentEdit,
 *     pendingAiComponentExit, ...) — agentic features are out of scope.
 *   - `collectionItemSheet`/open/closeCollectionItemSheet,
 *     `currentPageCollectionItemId` — CMS/Collections excluded.
 *   - `fileManager`/open/closeFileManager — no asset system exists yet.
 *   - `keyboardShortcutsOpen` — keyboard shortcuts excluded.
 *   - `isSliderAnimating`/`sliderSnapCounts` — slider widget deferred (see
 *     types/PageCMS/layerSchema.ts's file header).
 *   - `isAiLayerPicking`, `elementPicker` (explicitly CMS-bound per its own
 *     Ycode comment: "for linking filter inputs to collection conditions").
 *   - `richTextSheetLayerId`, `activeSublayerIndex`, `activeListItemIndex`,
 *     `activeTextStyleKey`, `showTextStyleControls` — all depend on the
 *     canvas rich-text editing sheet, which doesn't exist yet (Phase 5+
 *     territory). Revisit together when that's built, not piecemeal.
 *   - `interactionTriggerLayerIds`/`interactionTargetLayerIds`,
 *     `activeInteractionTriggerLayerId`/`activeInteractionTargetLayerIds` —
 *     drive the RightPanel's interactions-tab hover highlighting;
 *     RightPanel is a visual stub only right now (see project decision
 *     log), so this state has nothing to serve yet.
 *   - `lastDesignUrl`, `previewReturnUrl`/`previewReturnTab` — preview-mode
 *     navigation memory; deferred alongside real preview mode (Phase 5+).
 *   - `builderDataPreloaded` — doesn't apply here. Ycode needs this because
 *     its bootstrap is a client-side fetch that resolves after mount; our
 *     bootstrap (resolve-editor-bootstrap.ts) is server-fetched and
 *     already present as props on first render, so there's no "still
 *     loading initial data" state to track at all.
 *   - `dragElementSource`'s `'layouts'` option — Ycode's pre-built
 *     layout-blocks library; not something this project has. Pruned to
 *     `'elements' | 'components'`.
 *
 * `activeSidebarTab` is likewise NOT carried over as store state: Ycode
 * keeps it here as independent client state that the route-handling effect
 * happens to also call `setActiveSidebarTab()` on. This project instead
 * derives the equivalent value (`urlState.sidebarTab`) directly from the
 * URL in use-campaign-editor-url.ts and passes it to EditorBody as a
 * controlled prop — see that file's comment. Simpler here because there's
 * currently no way to change the active sidebar tab independently of
 * navigating; if one shows up later, that's the point to reconsider.
 * ─────────────────────────────────────────────────────────────────────────
 */

interface HistoryEntry {
  pageId: string;
  layers: Layer[];
  timestamp: number;
}

/** Breadcrumb stack entry for nested component editing (editing a component that itself contains an instance of another component). */
export interface ComponentNavigationEntry {
  type: "page" | "component";
  id: string;
  name: string;
  layerId?: string | null;
  variantId?: string | null;
}

export type EditorSidebarTab = "layers" | "pages" | "cms";

export type CanvasDropPosition = "above" | "below" | "inside";

export interface CanvasDropTarget {
  layerId: string;
  position: CanvasDropPosition;
  parentId: string | null;
  targetDisplayName?: string;
}

export interface CanvasSiblingDropTarget {
  layerId: string;
  position: "above" | "below";
  projectedIndex: number;
}

export interface DragPosition {
  x: number;
  y: number;
}

interface EditorState {
  selectedLayerId: string | null;
  selectedLayerIds: string[];
  lastSelectedLayerId: string | null;
  currentPageId: string | null;
  isLoading: boolean;
  isSaving: boolean;
  activeBreakpoint: Breakpoint;
  activeUIState: UIState;
  activeSidebarTab: EditorSidebarTab;
  history: HistoryEntry[];
  historyIndex: number;
  maxHistorySize: number;

  editingComponentId: string | null;
  /** null = "use the first variant" (also the default for single-variant components). */
  editingComponentVariantId: string | null;
  returnToPageId: string | null;
  returnToLayerId: string | null;
  componentNavigationStack: ComponentNavigationEntry[];

  hoveredLayerId: string | null;
  renamingLayerId: string | null;
  isPreviewMode: boolean;

  createComponentDialog: {
    open: boolean;
    layerId: string | null;
    defaultName: string;
  };

  // Canvas drag-and-drop (dragging a new element/component onto the canvas)
  isDraggingToCanvas: boolean;
  dragElementType: string | null;
  dragElementName: string | null;
  dragElementSource: "elements" | "layouts" | null;
  dragPosition: DragPosition | null;
  canvasDropTarget: CanvasDropTarget | null;

  // Canvas sibling reorder (dragging an existing layer within the tree/canvas)
  isDraggingLayerOnCanvas: boolean;
  draggedLayerId: string | null;
  draggedLayerName: string | null;
  draggedLayerParentId: string | null;
  draggedLayerOriginalIndex: number | null;
  siblingLayerIds: string[];
  canvasSiblingDropTarget: CanvasSiblingDropTarget | null;
  layerDragStartPosition: { x: number; y: number } | null;

  isSidebarResizing: boolean;
  leftSidebarWidth: number;
  isCanvasContextMenuOpen: boolean;
}

interface EditorActions {
  setSelectedLayerId: (id: string | null) => void;
  setSelectedLayerIds: (ids: string[]) => void;
  addToSelection: (id: string) => void;
  toggleSelection: (id: string) => void;
  /**
   * `flattenedLayerIds: string[]`, not Ycode's `flattenedLayers: any[]` —
   * the caller (the layers tree, once built) only ever needs id-based
   * range lookup, and this codebase's "no `any`" standard doesn't allow
   * porting that signature as-is.
   */
  selectRange: (
    fromId: string,
    toId: string,
    flattenedLayerIds: string[],
  ) => void;
  clearSelection: () => void;
  setActiveSidebarTab: (tab: EditorSidebarTab) => void;
  setCurrentPageId: (id: string | null) => void;
  setLoading: (value: boolean) => void;
  setSaving: (value: boolean) => void;
  setActiveBreakpoint: (breakpoint: Breakpoint) => void;
  setActiveUIState: (state: UIState) => void;

  pushHistory: (pageId: string, layers: Layer[]) => void;
  undo: () => HistoryEntry | null;
  redo: () => HistoryEntry | null;
  canUndo: () => boolean;
  canRedo: () => boolean;

  setEditingComponentId: (
    id: string | null,
    returnPageId?: string | null,
    returnToLayerId?: string | null,
  ) => void;
  setEditingComponentVariantId: (id: string | null) => void;
  pushComponentNavigation: (entry: ComponentNavigationEntry) => void;
  getReturnDestination: () => ComponentNavigationEntry | null;

  setHoveredLayerId: (id: string | null) => void;
  setRenamingLayerId: (id: string | null) => void;
  setPreviewMode: (enabled: boolean) => void;

  openCreateComponentDialog: (layerId: string, defaultName: string) => void;
  closeCreateComponentDialog: () => void;

  startCanvasDrag: (
    elementType: string,
    source: "elements" | "layouts",
    elementName: string,
    initialPosition: DragPosition,
  ) => void;
  updateDragPosition: (position: DragPosition) => void;
  updateCanvasDropTarget: (target: CanvasDropTarget | null) => void;
  endCanvasDrag: () => void;

  startCanvasLayerDrag: (
    layerId: string,
    layerName: string,
    parentId: string | null,
    originalIndex: number,
    siblingIds: string[],
    startPosition: { x: number; y: number },
  ) => void;
  updateCanvasSiblingDropTarget: (
    target: CanvasSiblingDropTarget | null,
  ) => void;
  endCanvasLayerDrag: () => void;

  setSidebarResizing: (value: boolean) => void;
  setLeftSidebarWidth: (value: number) => void;
  setCanvasContextMenuOpen: (value: boolean) => void;

  /**
   * Reset all of the above back to defaults. NOT present in Ycode's
   * version — Ycode is single-project per deployment, so it never needs to
   * discard interaction state and start over mid-session. This project is
   * multi-tenant: navigating from editing Campaign A to Campaign B reuses
   * the same global Zustand singleton (Next.js layouts persist across
   * dynamic-segment changes; params updating doesn't remount the module),
   * so without an explicit reset, Campaign B's editor could open with
   * Campaign A's selection/history/drag state still attached. Called from
   * CampaignEditorMain whenever `campaignId` changes — see that file.
   */
  resetForNewCampaign: () => void;
}

type EditorStore = EditorState & EditorActions;

const initialState: EditorState = {
  selectedLayerId: null,
  selectedLayerIds: [],
  lastSelectedLayerId: null,
  currentPageId: null,
  isLoading: false,
  isSaving: false,
  activeBreakpoint: "desktop",
  activeUIState: "neutral",
  history: [],
  historyIndex: -1,
  maxHistorySize: 50,
  editingComponentId: null,
  editingComponentVariantId: null,
  returnToPageId: null,
  returnToLayerId: null,
  componentNavigationStack: [],
  hoveredLayerId: null,
  renamingLayerId: null,
  isPreviewMode: false,
  activeSidebarTab: "layers" as EditorSidebarTab,
  createComponentDialog: { open: false, layerId: null, defaultName: "" },
  isDraggingToCanvas: false,
  dragElementType: null,
  dragElementName: null,
  dragElementSource: null,
  dragPosition: null,
  canvasDropTarget: null,
  isDraggingLayerOnCanvas: false,
  draggedLayerId: null,
  draggedLayerName: null,
  draggedLayerParentId: null,
  draggedLayerOriginalIndex: null,
  siblingLayerIds: [],
  canvasSiblingDropTarget: null,
  layerDragStartPosition: null,
  isSidebarResizing: false,
  leftSidebarWidth: 256,
  isCanvasContextMenuOpen: false,
};

export const useEditorStore = create<EditorStore>((set, get) => ({
  ...initialState,

  setSelectedLayerId: (id) => {
    set({
      selectedLayerId: id,
      selectedLayerIds: id ? [id] : [],
      lastSelectedLayerId: id,
    });

    if (typeof window !== "undefined") {
      const isResourceRoute =
        /^\/campaign\/[^/]+\/editor\/(layers|pages|components)\//.test(
          window.location.pathname,
        );
      if (isResourceRoute) {
        scheduleLayerIdUrlUpdate(id);
      }
    }
  },

  setSelectedLayerIds: (ids) => {
    set({
      selectedLayerIds: ids,
      selectedLayerId:
        ids.length === 1 ? ids[0] : ids.length > 0 ? ids[ids.length - 1] : null,
      lastSelectedLayerId: ids.length > 0 ? ids[ids.length - 1] : null,
    });
  },

  addToSelection: (id) => {
    const { selectedLayerIds } = get();
    if (!selectedLayerIds.includes(id)) {
      const newIds = [...selectedLayerIds, id];
      set({
        selectedLayerIds: newIds,
        selectedLayerId: newIds.length === 1 ? newIds[0] : id,
        lastSelectedLayerId: id,
      });
    }
  },

  toggleSelection: (id) => {
    const { selectedLayerIds } = get();
    const newIds = selectedLayerIds.includes(id)
      ? selectedLayerIds.filter((layerId) => layerId !== id)
      : [...selectedLayerIds, id];

    set({
      selectedLayerIds: newIds,
      selectedLayerId:
        newIds.length === 1
          ? newIds[0]
          : newIds.length > 0
            ? newIds[newIds.length - 1]
            : null,
      lastSelectedLayerId: newIds.length > 0 ? id : null,
    });
  },

  selectRange: (fromId, toId, flattenedLayerIds) => {
    const fromIndex = flattenedLayerIds.indexOf(fromId);
    const toIndex = flattenedLayerIds.indexOf(toId);
    if (fromIndex === -1 || toIndex === -1) return;

    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    const rangeIds = flattenedLayerIds
      .slice(start, end + 1)
      .filter((id) => id !== "body");

    set({
      selectedLayerIds: rangeIds,
      selectedLayerId: rangeIds.length === 1 ? rangeIds[0] : toId,
      lastSelectedLayerId: toId,
    });
  },

  clearSelection: () => {
    set({
      selectedLayerIds: [],
      selectedLayerId: null,
      lastSelectedLayerId: null,
    });
  },

  setCurrentPageId: (id) =>
    set({ currentPageId: id, activeUIState: "neutral" }),
  setLoading: (value) => set({ isLoading: value }),
  setSaving: (value) => set({ isSaving: value }),
  setActiveBreakpoint: (breakpoint) => set({ activeBreakpoint: breakpoint }),
  setActiveUIState: (uiState) => set({ activeUIState: uiState }),
  setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab }),
  pushHistory: (pageId, layers) => {
    const { history, historyIndex, maxHistorySize } = get();
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({
      pageId,
      layers: JSON.parse(JSON.stringify(layers)),
      timestamp: Date.now(),
    });

    if (newHistory.length > maxHistorySize) {
      newHistory.shift();
    } else {
      set({ historyIndex: historyIndex + 1 });
    }
    set({ history: newHistory });
  },

  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex > 0) {
      set({ historyIndex: historyIndex - 1 });
      return history[historyIndex - 1];
    }
    return null;
  },

  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex < history.length - 1) {
      set({ historyIndex: historyIndex + 1 });
      return history[historyIndex + 1];
    }
    return null;
  },

  canUndo: () => get().historyIndex > 0,
  canRedo: () => {
    const { history, historyIndex } = get();
    return historyIndex < history.length - 1;
  },

  setEditingComponentId: (
    id,
    returnPageId = null,
    returnToLayerId = undefined,
  ) => {
    const state = get();

    let layerToReturn: string | null;
    if (id !== null) {
      layerToReturn =
        returnToLayerId !== undefined ? returnToLayerId : state.selectedLayerId;
    } else {
      layerToReturn = state.returnToLayerId;
    }

    // Stack is pushed explicitly by callers (the layer context menu, the
    // RightPanel component-instance controls) with proper display names —
    // this function only pops when exiting, matching Ycode's own division
    // of responsibility.
    const newStack = [...state.componentNavigationStack];
    if (id === null) newStack.pop();

    set({
      editingComponentId: id,
      editingComponentVariantId:
        id === null ? null : get().editingComponentVariantId,
      returnToPageId: returnPageId,
      returnToLayerId: layerToReturn,
      componentNavigationStack: newStack,
    });
  },

  setEditingComponentVariantId: (id) => set({ editingComponentVariantId: id }),

  pushComponentNavigation: (entry) => {
    set((state) => ({
      componentNavigationStack: [...state.componentNavigationStack, entry],
    }));
  },

  getReturnDestination: () => {
    const stack = get().componentNavigationStack;
    return stack.length > 0 ? stack[stack.length - 1] : null;
  },

  setHoveredLayerId: (id) => set({ hoveredLayerId: id }),
  setRenamingLayerId: (id) => set({ renamingLayerId: id }),
  setPreviewMode: (enabled) => set({ isPreviewMode: enabled }),

  openCreateComponentDialog: (layerId, defaultName) =>
    set({ createComponentDialog: { open: true, layerId, defaultName } }),
  closeCreateComponentDialog: () =>
    set({
      createComponentDialog: { open: false, layerId: null, defaultName: "" },
    }),

  startCanvasDrag: (elementType, source, elementName, initialPosition) =>
    set({
      isDraggingToCanvas: true,
      dragElementType: elementType,
      dragElementName: elementName,
      dragElementSource: source,
      dragPosition: initialPosition,
      canvasDropTarget: null,
    }),
  updateDragPosition: (position) => set({ dragPosition: position }),
  updateCanvasDropTarget: (target) => set({ canvasDropTarget: target }),
  endCanvasDrag: () =>
    set({
      isDraggingToCanvas: false,
      dragElementType: null,
      dragElementName: null,
      dragElementSource: null,
      dragPosition: null,
      canvasDropTarget: null,
    }),

  startCanvasLayerDrag: (
    layerId,
    layerName,
    parentId,
    originalIndex,
    siblingIds,
    startPosition,
  ) =>
    set({
      isDraggingLayerOnCanvas: true,
      draggedLayerId: layerId,
      draggedLayerName: layerName,
      draggedLayerParentId: parentId,
      draggedLayerOriginalIndex: originalIndex,
      siblingLayerIds: siblingIds,
      canvasSiblingDropTarget: null,
      layerDragStartPosition: startPosition,
    }),
  updateCanvasSiblingDropTarget: (target) =>
    set({ canvasSiblingDropTarget: target }),
  endCanvasLayerDrag: () =>
    set({
      isDraggingLayerOnCanvas: false,
      draggedLayerId: null,
      draggedLayerName: null,
      draggedLayerParentId: null,
      draggedLayerOriginalIndex: null,
      siblingLayerIds: [],
      canvasSiblingDropTarget: null,
      layerDragStartPosition: null,
    }),

  setSidebarResizing: (value) => set({ isSidebarResizing: value }),
  setLeftSidebarWidth: (value) => set({ leftSidebarWidth: value }),
  setCanvasContextMenuOpen: (value) => set({ isCanvasContextMenuOpen: value }),

  resetForNewCampaign: () => set({ ...initialState }),
}));
