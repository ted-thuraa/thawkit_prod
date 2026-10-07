// path: src/stores/editor/useEditorStore.ts

"use client";

import { create } from "zustand";
import type { Layer, Breakpoint, UIState } from "@/types/funnel";
import {
  isEditorResourceRoute,
  scheduleLayerIdUrlUpdate,
} from "@/lib/editor/editor-url";
import { useCanvasTextEditorStore } from "./useCanvasTextEditorStore";
import { usePagesStore } from "./usePagesStore";

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
 *     aiOpenedComponentEdit, pendingAiComponentExit, ...) and
 *     AI layer-picking flag — agentic features are out of scope.
 *     (`canvasEnterLayerIds`/`canvasEnterNonce` ARE kept, as a plain
 *     non-AI entrance-animation signal — see `triggerCanvasEnter`.)
 *   - `collectionItemSheet`/open/closeCollectionItemSheet,
 *     `currentPageCollectionItemId` — CMS/Collections excluded.
 *   - `fileManager`/open/closeFileManager — no asset system exists yet.
 *   - `keyboardShortcutsOpen` — keyboard shortcuts excluded.
 *   - `isSliderAnimating`/`sliderSnapCounts` — slider widget deferred (see
 *     types/PageCMS/layerSchema.ts's file header).
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
 * `activeSidebarTab` (Layers / Pages) is STORE-OWNED client state, default
 * "layers". It is never derived from the URL and has no query param: the
 * route only says what is being edited (page / component / settings mode),
 * while this field says which left-sidebar tab is showing. Tab changes just
 * call `setActiveSidebarTab`, and `resetForNewCampaign` restores the default.
 * Navigation helpers (`navigateToNextPage` in use-editor-url.ts) may READ this
 * value to pick page- vs layer-oriented behaviour, but never write the URL
 * from it.
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
  activeInteractionTriggerLayerId: string | null;
  activeInteractionTargetLayerIds: string[];
  activeTextStyleKey: string | null; // Currently active text style (e.g., 'bold', 'italic'),
  /** Layer ID whose content should be opened in a RichTextEditorSheet (set from iframe on double-click) */
  richTextSheetLayerId: string | null;
  isRightPanelOpen: boolean;
  isSidebarResizing: boolean;
  leftSidebarWidth: number;
  /** Whether the floating left panel is expanded (not the collapsed 40px trigger). */
  isLeftPanelOpen: boolean;
  isCanvasContextMenuOpen: boolean;
  // Slider transition state (hides outlines during slide animation)
  isSliderAnimating: boolean;
  sliderSnapCounts: Record<string, number>;
  /** Index of the selected sublayer within a richText element (null = no sublayer selected) */
  activeSublayerIndex: number | null;
  /** Index of the selected list item within its parent list (null = no list item selected) */
  activeListItemIndex: number | null;
  collectionItemSheet: {
    open: boolean;
    collectionId: string;
    itemId: string;
  } | null;
  // Element picker state (for linking filter inputs to collection conditions)
  elementPicker: {
    active: boolean;
    onSelect: ((layerId: string) => void) | null;
    validate?: ((layerId: string) => boolean) | null;
    originPosition?: { x: number; y: number } | null;
  } | null;
  /**
   * Non-AI entrance-animation signal for the canvas. `canvasEnterNonce` is
   * bumped on every `triggerCanvasEnter` call so identical id arrays still
   * re-trigger the animation; `canvasEnterLayerIds` carries the ids to reveal.
   */
  canvasEnterLayerIds: string[];
  canvasEnterNonce: number;
  // Computed getters
  showTextStyleControls: () => boolean;
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
  setSliderSnapCount: (sliderId: string, count: number) => void;

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
  setSliderAnimating: (value: boolean) => void;

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
  setActiveSublayerIndex: (index: number | null) => void;
  selectLayerWithSublayer: (
    layerId: string,
    sublayer: {
      textStyleKey: string | null;
      sublayerIndex: number | null;
      listItemIndex: number | null;
    },
  ) => void;
  /** Open a RichTextEditorSheet for the given layer (triggered from iframe on double-click) */
  openRichTextSheet: (layerId: string) => void;
  openCollectionItemSheet: (collectionId: string, itemId: string) => void;
  setSidebarResizing: (value: boolean) => void;
  setLeftSidebarWidth: (value: number) => void;
  setLeftPanelOpen: (value: boolean) => void;
  setCanvasContextMenuOpen: (value: boolean) => void;
  closeRichTextSheet: () => void;
  openRightPanel: () => void;
  closeRightPanel: () => void;
  toggleRightPanel: () => void;
  setActiveTextStyleKey: (key: string | null) => void;
  startElementPicker: (config: {
    onSelect: (layerId: string) => void;
    validate?: ((layerId: string) => boolean) | null;
    originPosition?: { x: number; y: number } | null;
  }) => void;
  stopElementPicker: () => void;
  /** Reveal `layerIds` with the canvas entrance animation (bumps `canvasEnterNonce`). */
  triggerCanvasEnter: (layerIds: string[]) => void;
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
   * Also clears `usePagesStore`, so no page/layer data from the previous
   * campaign survives; callers must re-hydrate pages AFTER calling this.
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
  isSliderAnimating: false,
  sliderSnapCounts: {},
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
  isLeftPanelOpen: false,
  activeTextStyleKey: null,
  isCanvasContextMenuOpen: false,
  activeInteractionTriggerLayerId: null,
  activeInteractionTargetLayerIds: [],
  richTextSheetLayerId: null,
  isRightPanelOpen: false,
  activeSublayerIndex: null,
  activeListItemIndex: null,
  collectionItemSheet: null,
  // Element picker initial state
  elementPicker: null,
  canvasEnterLayerIds: [],
  canvasEnterNonce: 0,
  // Placeholder only — the real getter is defined inside `create()` below and
  // must never be overwritten by a reset (see `resetForNewCampaign`).
  showTextStyleControls: () => false,
};

/** Everything `resetForNewCampaign` restores — i.e. `initialState` minus the computed getter. */
const { showTextStyleControls: _computedGetter, ...resettableInitialState } =
  initialState;
void _computedGetter;

export const useEditorStore = create<EditorStore>((set, get) => ({
  ...initialState,
  openRichTextSheet: (layerId) => set({ richTextSheetLayerId: layerId }),
  openCollectionItemSheet: (collectionId, itemId) =>
    set({
      collectionItemSheet: {
        open: true,
        collectionId,
        itemId,
      },
    }),
  setSliderSnapCount: (sliderId, count) =>
    set((state) => {
      // Swiper fires `update` on every DOM mutation inside its wrapper, which
      // happens constantly in the iframe (Tailwind class injections, child
      // re-renders). Bail out when the count hasn't changed so subscribers
      // — notably slideBullets `LayerItem`s — don't re-render.
      if (state.sliderSnapCounts[sliderId] === count) return state;
      return {
        sliderSnapCounts: { ...state.sliderSnapCounts, [sliderId]: count },
      };
    }),
  closeRichTextSheet: () => set({ richTextSheetLayerId: null }),
  openRightPanel: () => set({ isRightPanelOpen: true }),
  closeRightPanel: () => set({ isRightPanelOpen: false }),
  toggleRightPanel: () =>
    set((state) => ({ isRightPanelOpen: !state.isRightPanelOpen })),
  // Computed getter: Returns true when text style controls should be shown
  // This happens when:
  // 1. Canvas text editing is active, OR
  // 2. A text style is selected from the dropdown (e.g., bold, italic, custom style)
  showTextStyleControls: () => {
    const state = get();
    const isCanvasTextEditing = useCanvasTextEditorStore.getState().isEditing;
    return isCanvasTextEditing || !!state.activeTextStyleKey;
  },

  setSelectedLayerId: (id) => {
    set({
      selectedLayerId: id,
      selectedLayerIds: id ? [id] : [],
      lastSelectedLayerId: id,
    });

    // Mirror into `?layer=` (debounced, replaceState) — only while on a
    // page/component editor route.
    if (isEditorResourceRoute()) {
      scheduleLayerIdUrlUpdate(id);
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

  // Canonical hover state — written by BOTH the layers tree and direct canvas
  // hover. Bail out on an unchanged id so subscribers (SelectionOverlay) don't
  // wake up for every mousemove-driven re-entry of the same layer.
  setHoveredLayerId: (id) =>
    set((state) =>
      state.hoveredLayerId === id ? state : { hoveredLayerId: id },
    ),
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
  setLeftPanelOpen: (value) => set({ isLeftPanelOpen: value }),
  setCanvasContextMenuOpen: (value) => set({ isCanvasContextMenuOpen: value }),
  setSliderAnimating: (value) => set({ isSliderAnimating: value }),
  setActiveTextStyleKey: (key) => set({ activeTextStyleKey: key }),

  startElementPicker: ({ onSelect, validate = null, originPosition = null }) =>
    set({
      elementPicker: { active: true, onSelect, validate, originPosition },
    }),
  stopElementPicker: () => set({ elementPicker: null }),

  triggerCanvasEnter: (layerIds) =>
    set((state) => ({
      canvasEnterLayerIds: layerIds,
      canvasEnterNonce: state.canvasEnterNonce + 1,
    })),

  resetForNewCampaign: () => {
    // Drop the previous campaign's pages/layers first so nothing can render
    // stale data while the next bootstrap hydrates.
    usePagesStore.getState().reset();
    set({ ...resettableInitialState });
  },
  setActiveSublayerIndex: (index) => set({ activeSublayerIndex: index }),
  selectLayerWithSublayer: (layerId, sublayer) => {
    set({
      selectedLayerId: layerId,
      selectedLayerIds: [layerId],
      lastSelectedLayerId: layerId,
      activeTextStyleKey: sublayer.textStyleKey,
      activeSublayerIndex: sublayer.sublayerIndex,
      activeListItemIndex: sublayer.listItemIndex,
    });

    if (isEditorResourceRoute()) {
      scheduleLayerIdUrlUpdate(layerId);
    }
  },
}));
