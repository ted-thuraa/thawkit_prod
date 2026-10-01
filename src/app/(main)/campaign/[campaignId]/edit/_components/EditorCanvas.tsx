// 1. React/Next.js
import React, {
  useEffect,
  useRef,
  useMemo,
  useState,
  useCallback,
} from "react";

import type {
  Layer,
  ComponentVariable,
  CollectionField,
  CollectionItemWithValues,
  Asset,
  Translation,
} from "@/types/funnel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import Canvas from "./Canvas";
import { useEditorStore } from "@/stores/editor/useEditorStore";
import { usePagesStore } from "@/stores/editor/usePagesStore";
import { useCanvasTextEditorStore } from "@/stores/editor/useCanvasTextEditorStore";
import { SelectionOverlay } from "@/components/SelectionOverlay";
import { BREAKPOINTS } from "@/lib/breakpoint-utils";
import { CANVAS_BORDER, CANVAS_PADDING } from "@/lib/canvas-utils";
import {
  DropContainerIndicator,
  DropLineIndicator,
} from "@/components/DropIndicators";
import DragCaptureOverlay from "@/components/DragCaptureOverlay";
import ElementPickerOverlay from "./ElementPickerOverlay";
import { cn } from "@/lib/utils";
import {
  findLayerById,
  getLayerCmsFieldBinding,
  isRichTextLayer,
  removeRichTextSublayer,
  updateLayerProps,
} from "@/lib/layer-utils";
import { useLocalisationStore } from "@/stores/editor/useLocalisationStore";
import { useCollectionsStore } from "@/stores/editor/useCollectionsStore";
import { useAssetsStore } from "@/stores/editor/useAssetsStore";
import { useZoom } from "@/hooks/use-zoom";
import { useCanvasPan } from "@/hooks/use-canvas-pan";
import { toast } from "sonner";
import { buildFieldGroupsForLayer } from "@/lib/collection-field-utils";
import { getRichTextValue } from "@/lib/tiptap-utils";
import { useCanvasDropDetection } from "@/hooks/use-canvas-drop-detection";
import { useCanvasSiblingReorder } from "@/hooks/use-canvas-sibling-reorder";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import Icon from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { clearDragCursor, setDragCursor } from "@/lib/drag-cursor";

type ViewportMode = "desktop" | "tablet" | "mobile";

interface EditorCenterCanvasProps {
  currentPageId: string | null;
  viewportMode: ViewportMode;
  setViewportMode: (mode: ViewportMode) => void;
  onLayerSelect?: (layerId: string) => void;
  onLayerDeselect?: () => void;
  onExitComponentEditMode?: () => void;
}
// Viewport widths are derived from BREAKPOINTS to avoid sitting on exact
// breakpoint boundaries where CSS zoom sub-pixel rounding can toggle styles.
const MOBILE_MAX_WIDTH = BREAKPOINTS.find(
  (bp) => bp.value === "mobile",
)!.maxWidth!;

const viewportSizes: Record<
  ViewportMode,
  { width: string; label: string; icon: string }
> = {
  desktop: { width: "1366px", label: "Desktop", icon: "🖥️" },
  tablet: { width: `${MOBILE_MAX_WIDTH + 10}px`, label: "Tablet", icon: "📱" },
  mobile: { width: "375px", label: "Mobile", icon: "📱" },
};

interface ViewportZoomControlsProps {
  viewportMode: ViewportMode;
  zoom: number;
  onViewportChange: (mode: ViewportMode) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onZoomToFit: () => void;
  onAutofit: () => void;
}

/**
 * Canvas Drop Indicator Overlay
 *
 * Subscribes to store directly to avoid re-rendering the parent CenterCanvas component.
 * Renders drop indicators inside the scaled canvas div during drag-and-drop.
 */
interface CanvasDropIndicatorOverlayProps {
  iframeElement: HTMLIFrameElement | null;
}

function CanvasDropIndicatorOverlay({
  iframeElement,
}: CanvasDropIndicatorOverlayProps) {
  // Subscribe to store directly - only this component re-renders on changes
  const isDraggingToCanvas = useEditorStore(
    (state) => state.isDraggingToCanvas,
  );
  const dropTarget = useEditorStore((state) => state.canvasDropTarget);

  if (!isDraggingToCanvas || !dropTarget || !iframeElement) return null;

  // Use display name from drop target (already computed during hit-testing)
  const displayName = dropTarget.targetDisplayName || "";

  // Find element in iframe and calculate position
  const iframeDoc = iframeElement.contentDocument;
  if (!iframeDoc) return null;

  const targetElement = iframeDoc.querySelector(
    `[data-layer-id="${dropTarget.layerId}"]`,
  ) as HTMLElement;
  if (!targetElement) return null;

  // Get element rect in iframe's internal coordinate system
  const elementRect = targetElement.getBoundingClientRect();

  const top = elementRect.top;
  const left = elementRect.left;
  const width = elementRect.width;
  const height = elementRect.height;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-visible z-50">
      <div
        style={{
          position: "absolute",
          // Use transform for GPU-accelerated positioning
          transform: `translate(${left}px, ${top}px)`,
          width: `${width}px`,
          height: `${height}px`,
          // Hint to browser for GPU layer promotion
          willChange: "transform",
          // Ensure it's on its own compositing layer
          contain: "layout style",
        }}
      >
        {dropTarget.position === "inside" ? (
          <DropContainerIndicator
            label={`Add in ${displayName}`}
            variant="dashed"
          />
        ) : (
          <DropLineIndicator position={dropTarget.position} />
        )}
      </div>
    </div>
  );
}

interface CanvasSiblingReorderOverlayProps {
  iframeElement: HTMLIFrameElement | null;
}

function CanvasSiblingReorderOverlay({
  iframeElement,
}: CanvasSiblingReorderOverlayProps) {
  // Subscribe to store for drag state
  const isDragging = useEditorStore((state) => state.isDraggingLayerOnCanvas);
  const draggedId = useEditorStore((state) => state.draggedLayerId);
  const parentId = useEditorStore((state) => state.draggedLayerParentId);
  const originalIndex = useEditorStore(
    (state) => state.draggedLayerOriginalIndex,
  );
  const siblingIds = useEditorStore((state) => state.siblingLayerIds);
  const dropTarget = useEditorStore((state) => state.canvasSiblingDropTarget);

  const projectedIndex = dropTarget?.projectedIndex ?? null;

  // State for visual indicator positions
  const [parentRect, setParentRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const [dropLineY, setDropLineY] = useState<number | null>(null);
  const [dropzoneHeight, setDropzoneHeight] = useState<number>(0);
  const [dropzoneWidth, setDropzoneWidth] = useState<number>(0);
  const [dropzoneLeft, setDropzoneLeft] = useState<number>(0);

  // Cache element references and heights to avoid repeated DOM queries
  const cachedDataRef = useRef<{
    elements: Map<string, HTMLElement>;
    heights: Map<string, number>;
    tops: Map<string, number>;
    draggedHeight: number;
    draggedWidth: number;
    draggedLeft: number;
    parentElement: HTMLElement | null;
  } | null>(null);

  // Track previous projected index to avoid unnecessary updates
  const prevProjectedIndexRef = useRef<number | null>(null);

  // Store siblingIds in a ref for cleanup (since store clears them before cleanup runs)
  const siblingIdsRef = useRef<string[]>([]);

  // Change cursor to "grabbing" when dragging
  useEffect(() => {
    if (!isDragging) return;

    const iframeDoc = iframeElement?.contentDocument;
    // Pass both iframe document and iframe element for comprehensive cursor setting
    setDragCursor(iframeDoc, iframeElement);

    return () => {
      clearDragCursor(iframeDoc);
    };
  }, [isDragging, iframeElement]);

  // Cache elements and heights when drag starts
  useEffect(() => {
    if (!iframeElement) return;

    const iframeDoc = iframeElement.contentDocument;
    if (!iframeDoc) return;

    if (isDragging && draggedId && siblingIds.length > 0) {
      // Store siblingIds in ref for cleanup (before store clears them)
      siblingIdsRef.current = [...siblingIds];

      // Build cache on drag start
      const elements = new Map<string, HTMLElement>();
      const heights = new Map<string, number>();
      const tops = new Map<string, number>();
      let draggedHeight = 0;
      let draggedWidth = 0;
      let draggedLeft = 0;

      siblingIds.forEach((id) => {
        const el = iframeDoc.querySelector(
          `[data-layer-id="${id}"]`,
        ) as HTMLElement;
        if (el) {
          elements.set(id, el);
          const rect = el.getBoundingClientRect();
          heights.set(id, rect.height);
          tops.set(id, rect.top);
          if (id === draggedId) {
            draggedHeight = rect.height;
            draggedWidth = rect.width;
            draggedLeft = rect.left;
          }
        }
      });

      // Find and cache parent element
      let parentElement: HTMLElement | null = null;
      if (parentId) {
        parentElement = iframeDoc.querySelector(
          `[data-layer-id="${parentId}"]`,
        ) as HTMLElement;
      }

      cachedDataRef.current = {
        elements,
        heights,
        tops,
        draggedHeight,
        draggedWidth,
        draggedLeft,
        parentElement,
      };
      prevProjectedIndexRef.current = null;

      // Set dropzone dimensions to match dragged element
      setDropzoneHeight(draggedHeight);
      setDropzoneWidth(draggedWidth);
      setDropzoneLeft(draggedLeft);

      // Set initial parent rect
      if (parentElement) {
        const rect = parentElement.getBoundingClientRect();
        setParentRect({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        });
      }
    } else {
      // Clear cache and visual state when drag ends
      cachedDataRef.current = null;
      prevProjectedIndexRef.current = null;
      setParentRect(null);
      setDropLineY(null);
      setDropzoneHeight(0);
      setDropzoneWidth(0);
      setDropzoneLeft(0);
    }
  }, [iframeElement, isDragging, draggedId, parentId, siblingIds]);

  // Update dropzone box position and shift siblings when projectedIndex changes
  useEffect(() => {
    const cache = cachedDataRef.current;
    if (!cache || !isDragging || originalIndex === null) {
      return;
    }

    // For free-drag behavior: if projectedIndex is null during active drag,
    // keep the last valid projected index (preserve visual state)
    if (projectedIndex === null && prevProjectedIndexRef.current !== null) {
      // Still dragging but cursor moved outside valid positions - keep current visual state
      return;
    }

    const currentProjectedIndex = projectedIndex ?? originalIndex;

    // Skip if projected index hasn't changed
    if (currentProjectedIndex === prevProjectedIndexRef.current) {
      return;
    }

    // Check if this is the FIRST positioning (no previous index)
    // On first positioning, skip transition to avoid "jump" animation
    const isFirstPositioning = prevProjectedIndexRef.current === null;
    prevProjectedIndexRef.current = currentProjectedIndex;

    const { elements, heights, tops, draggedHeight } = cache;

    // Calculate dropzone Y position (where the blue box should appear)
    // The dropzone ALWAYS shows - at original position when first dragging,
    // then moves as you drag to different positions
    let lineY: number | null = null;

    if (currentProjectedIndex === originalIndex) {
      // Dropzone at original position (element "picked up", its spot is available)
      const draggedId = siblingIds[originalIndex];
      const draggedTop = tops.get(draggedId);
      if (draggedTop !== undefined) {
        lineY = draggedTop;
      }
    } else {
      const isDraggingDown = currentProjectedIndex > originalIndex;

      if (isDraggingDown) {
        // When dragging down, elements have shifted UP
        // The dropzone appears after the last shifted-up element
        if (currentProjectedIndex < siblingIds.length) {
          const targetId = siblingIds[currentProjectedIndex];
          const targetTop = tops.get(targetId);
          const targetHeight = heights.get(targetId);
          if (targetTop !== undefined && targetHeight !== undefined) {
            // Position at bottom of the target element, minus its shift
            lineY = targetTop + targetHeight - draggedHeight;
          }
        } else {
          // Dropping at the end
          const lastId = siblingIds[siblingIds.length - 1];
          const lastTop = tops.get(lastId);
          const lastHeight = heights.get(lastId);
          if (lastTop !== undefined && lastHeight !== undefined) {
            lineY = lastTop + lastHeight - draggedHeight;
          }
        }
      } else {
        // When dragging up, dropzone appears at the target position
        if (currentProjectedIndex < siblingIds.length) {
          const targetId = siblingIds[currentProjectedIndex];
          const targetTop = tops.get(targetId);
          if (targetTop !== undefined) {
            lineY = targetTop;
          }
        }
      }
    }
    setDropLineY(lineY);

    // Apply transforms to shift siblings and make space for dropzone
    siblingIds.forEach((layerId, index) => {
      const el = elements.get(layerId);
      if (!el) return;

      // The dragged element itself - hide it completely
      // Its position becomes the dropzone (element is "picked up")
      if (layerId === draggedId) {
        el.style.opacity = "0";
        // Only animate opacity after first frame to avoid initial "pop"
        el.style.transition = isFirstPositioning
          ? "none"
          : "opacity 100ms ease-out";
        return;
      }

      // Calculate shift amount based on direction of movement
      let shiftAmount = 0;

      if (currentProjectedIndex !== originalIndex) {
        const isDraggingDown = currentProjectedIndex > originalIndex;

        if (isDraggingDown) {
          // Dragging DOWN: elements between original and projected shift UP to fill gap
          // Elements at projected and after shift DOWN for dropzone (dropzone height = dragged element height)
          if (index > originalIndex && index <= currentProjectedIndex) {
            // These elements shift UP to fill the gap left by dragged element
            shiftAmount = -draggedHeight;
          }
          if (index > currentProjectedIndex) {
            // These elements shift DOWN for the dropzone
            // Since dropzone height = draggedHeight, net shift is 0
            shiftAmount = 0;
          }
        } else {
          // Dragging UP: elements between projected and original shift DOWN
          if (index >= currentProjectedIndex && index < originalIndex) {
            // These elements shift DOWN to make room for dropzone (dropzone height = dragged element height)
            shiftAmount = draggedHeight;
          }
        }
      }

      // Only animate after first frame to avoid initial "jump"
      el.style.transition = isFirstPositioning
        ? "none"
        : "transform 150ms ease-out";
      el.style.willChange = "transform";
      el.style.transform =
        shiftAmount !== 0 ? `translate3d(0, ${shiftAmount}px, 0)` : "";
    });
  }, [isDragging, draggedId, originalIndex, siblingIds, projectedIndex]);

  // Cleanup effect - reset styles when drag ends with smooth animation
  // Uses siblingIdsRef because store clears siblingIds before this effect runs
  useEffect(() => {
    if (!iframeElement) return;

    const iframeDoc = iframeElement.contentDocument;
    if (!iframeDoc) return;

    // Only clean up when drag ends - use ref since store already cleared siblingIds
    if (!isDragging && siblingIdsRef.current.length > 0) {
      // Remove transforms INSTANTLY (no transition) to prevent "jump" on drop
      // The DOM reorder changes element positions, so animating transforms causes glitches
      siblingIdsRef.current.forEach((id) => {
        const el = iframeDoc.querySelector(
          `[data-layer-id="${id}"]`,
        ) as HTMLElement;
        if (el) {
          el.style.transition = "none";
          el.style.opacity = "1";
          el.style.transform = "";
          el.style.willChange = "";
        }
      });

      // Clear the ref after cleanup
      siblingIdsRef.current = [];
    }
  }, [iframeElement, isDragging]);

  // Don't render anything if not dragging
  if (!isDragging || !parentRect) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-visible z-50">
      {/* Blue dropzone box - shows where element will be inserted */}
      {dropLineY !== null && dropzoneHeight > 0 && dropzoneWidth > 0 && (
        <div
          className="animate-in fade-in duration-100"
          style={{
            position: "absolute",
            transform: `translate(${dropzoneLeft}px, ${dropLineY}px)`,
            width: `${dropzoneWidth}px`,
            height: `${dropzoneHeight}px`,
            willChange: "transform",
            transition: "transform 150ms ease-out",
          }}
        >
          <div className="absolute inset-0 bg-blue-100 rounded-sm border border-blue-300 border-dashed" />
        </div>
      )}
    </div>
  );

  // This component doesn't render anything visible - it only applies effects
  return null;
}

const EditorCenterCanvas = React.memo(function EditorCenterCanvas({
  currentPageId,
  viewportMode,
  setViewportMode,
  onLayerSelect,
  onLayerDeselect,
  onExitComponentEditMode,
}: EditorCenterCanvasProps) {
  const selectedLayerId = useEditorStore((state) => state.selectedLayerId);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [previewContentHeight, setPreviewContentHeight] = useState(0);
  const [previewContainerHeight, setPreviewContainerHeight] = useState(0);
  const [previewContainerWidth, setPreviewContainerWidth] = useState(0);
  // State for iframe element (for SelectionOverlay)
  const [canvasIframeElement, setCanvasIframeElement] =
    useState<HTMLIFrameElement | null>(null);
  const [showAddBlockPanel, setShowAddBlockPanel] = useState(false);

  // Scroll canvas to selected element if it's off-screen
  const prevCanvasLayerIdRef = useRef<string | null>(null);
  const isInitialScrollRef = useRef(true);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollCanvasToLayer = useCallback(
    (layerId: string, smooth: boolean, force = false) => {
      if (!canvasIframeElement) return;

      const iframeDoc = canvasIframeElement.contentDocument;
      const iframeWin = canvasIframeElement.contentWindow;
      if (!iframeDoc || !iframeWin) return;

      const el = iframeDoc.querySelector(
        `[data-layer-id="${layerId}"]`,
      ) as HTMLElement;
      if (!el) return;

      // Scrolling happens inside the iframe (the iframe element is sized to the
      // visible canvas area; its own document handles overflow). All coordinates
      // here are in the iframe's coordinate system, so zoom doesn't apply.
      const scrollEl = iframeDoc.scrollingElement || iframeDoc.documentElement;
      const elRect = el.getBoundingClientRect();
      const currentScroll = scrollEl.scrollTop;
      const viewHeight = scrollEl.clientHeight;

      const elTopInDoc = currentScroll + elRect.top;
      const elBottomInDoc = elTopInDoc + elRect.height;
      const viewTop = currentScroll;
      const viewBottom = viewTop + viewHeight;

      if (!force && elTopInDoc >= viewTop && elBottomInDoc <= viewBottom)
        return;

      const fitsInView = elRect.height <= viewHeight;
      const targetScroll = fitsInView
        ? elTopInDoc - viewHeight / 2 + elRect.height / 2
        : elTopInDoc;
      // scrollEl.scrollTo starts the animation more reliably than iframeWin.scrollTo
      // across browsers, which avoids a noticeable lag before smooth scrolling begins.
      scrollEl.scrollTo({
        top: Math.max(0, targetScroll),
        behavior: smooth ? "smooth" : "auto",
      });
    },
    [canvasIframeElement],
  );
  const scrollCanvasToLayerRef = useRef(scrollCanvasToLayer);
  scrollCanvasToLayerRef.current = scrollCanvasToLayer;

  // Track iframe content size from iframe reports
  const [reportedContentHeight, setReportedContentHeight] = useState(0);
  const [reportedContentWidth, setReportedContentWidth] = useState(0);

  // Track container height for dynamic alignment
  const [containerHeight, setContainerHeight] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);

  // Track whether zoom calculation is ready (prevents flash of wrong zoom on initial load)
  const [isCanvasReady, setIsCanvasReady] = useState(false);

  // Hide the component canvas while its auto-zoom settles. Opening a component
  // runs several measurement passes (width/height) that each re-fit the zoom;
  // revealing only after dimensions hold steady avoids a visible size jump.
  const [isComponentCanvasSettling, setIsComponentCanvasSettling] =
    useState(false);
  const componentSettleTimerRef = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  const addLayerFromTemplate = usePagesStore(
    (state) => state.addLayerFromTemplate,
  );
  const updateLayer = usePagesStore((state) => state.updateLayer);
  const deleteLayer = usePagesStore((state) => state.deleteLayer);
  const deleteLayers = usePagesStore((state) => state.deleteLayers);
  const setLayers = usePagesStore((state) => state.setLayers);
  const pages = usePagesStore((state) => state.pages);
  const setSelectedLayerId = useEditorStore(
    (state) => state.setSelectedLayerId,
  );
  const activeInteractionTriggerLayerId = useEditorStore(
    (state) => state.activeInteractionTriggerLayerId,
  );
  const activeInteractionTargetLayerIds = useEditorStore(
    (state) => state.activeInteractionTargetLayerIds,
  );
  const selectedLayerIds = useEditorStore((state) => state.selectedLayerIds);
  const getReturnDestination = useEditorStore(
    (state) => state.getReturnDestination,
  );
  const clearSelection = useEditorStore((state) => state.clearSelection);
  const setActiveSidebarTab = useEditorStore(
    (state) => state.setActiveSidebarTab,
  );
  const selectLayerWithSublayer = useEditorStore(
    (state) => state.selectLayerWithSublayer,
  );
  const activeUIState = useEditorStore((state) => state.activeUIState);
  const activeSidebarTab = useEditorStore((state) => state.activeSidebarTab);

  const editingComponentId = useEditorStore(
    (state) => state.editingComponentId,
  );

  const isPreviewMode = useEditorStore((state) => state.isPreviewMode);
  const richTextSheetLayerId = useEditorStore(
    (state) => state.richTextSheetLayerId,
  );
  const closeRichTextSheet = useEditorStore(
    (state) => state.closeRichTextSheet,
  );
  const activeSublayerIndex = useEditorStore(
    (state) => state.activeSublayerIndex,
  );
  const setActiveSublayerIndex = useEditorStore(
    (state) => state.setActiveSublayerIndex,
  );
  const activeListItemIndex = useEditorStore(
    (state) => state.activeListItemIndex,
  );
  const elementPicker = useEditorStore((state) => state.elementPicker);
  // Get current page (the single source of truth: `usePagesStore.pages`)
  const currentPage = useMemo(
    () => pages.find((p) => p.id === currentPageId),
    [pages, currentPageId],
  );

  // Get collection ID from current page if it's dynamic
  const collectionId = useMemo(() => {
    if (!currentPage?.isDynamic) return null;
    return currentPage.settings?.cms?.collection_id || null;
  }, [currentPage]);
  const selectedLocaleId = useLocalisationStore(
    (state) => state.selectedLocaleId,
  );
  const translations = useLocalisationStore((state) => state.translations);
  const locales = useLocalisationStore((state) => state.locales);
  // Derive the selected locale here (instead of via getSelectedLocale()) so it
  // is in scope for callbacks defined below — non-default locales gate every
  // canvas mutation handler into a no-op (read-only translation mode).
  const selectedLocale = useMemo(
    () =>
      selectedLocaleId
        ? (locales.find((l) => l.id === selectedLocaleId) ?? null)
        : null,
    [selectedLocaleId, locales],
  );

  // ── Canvas data props ────────────────────────────────────────────────────
  // Collection data is read straight from the collections store; nothing else
  // is layered on top of it, so the "merged" items ARE the store items.
  const mergedCollectionItems: Record<string, CollectionItemWithValues[]> =
    useCollectionsStore((state) => state.items);
  const collectionFieldsFromStore: Record<string, CollectionField[]> =
    useCollectionsStore((state) => state.fields);
  const assetsMap: Record<string, Asset> = useAssetsStore(
    (state) => state.assetsById,
  );

  // Fields + preview item for a dynamic (CMS-driven) page. The first item of
  // the page's collection is used as the preview record. Canvas applies CMS
  // translations to it internally, so it is passed through untranslated.
  const pageCollectionFields = useMemo<CollectionField[]>(
    () => (collectionId ? (collectionFieldsFromStore[collectionId] ?? []) : []),
    [collectionId, collectionFieldsFromStore],
  );
  const translatedPageCollectionItem = useMemo<CollectionItemWithValues | null>(
    () =>
      collectionId ? (mergedCollectionItems[collectionId]?.[0] ?? null) : null,
    [collectionId, mergedCollectionItems],
  );

  // Translation map for the active locale (keyed by translatable key).
  const localeTranslations = useMemo<Record<string, Translation> | null>(
    () => (selectedLocaleId ? (translations[selectedLocaleId] ?? null) : null),
    [selectedLocaleId, translations],
  );

  // ── Component-editing stubs ─────────────────────────────────────────────
  // Component editing is not wired into this route yet (no components store).
  // Typed no-ops keep Canvas's contract satisfied until that wiring exists.
  const editingComponentVariables: ComponentVariable[] | undefined = undefined;
  const handleCanvasComponentEdit = useCallback(
    (_componentId: string, _instanceLayerId: string): void => {},
    [],
  );

  // Re-scroll when content height changes during initial load (images loading shifts layout)
  const canvasReadyTimeRef = useRef<number | null>(null);
  useEffect(() => {
    if (isCanvasReady && !canvasReadyTimeRef.current) {
      canvasReadyTimeRef.current = Date.now();
    }
  }, [isCanvasReady]);

  useEffect(() => {
    if (
      !selectedLayerId ||
      !canvasIframeElement ||
      !isCanvasReady ||
      !reportedContentHeight
    )
      return;

    const readyTime = canvasReadyTimeRef.current;
    if (!readyTime || Date.now() - readyTime > 5000) return;

    const timeout = setTimeout(() => {
      scrollCanvasToLayer(selectedLayerId, false, true);
    }, 100);
    return () => clearTimeout(timeout);
  }, [
    reportedContentHeight,
    selectedLayerId,
    canvasIframeElement,
    isCanvasReady,
    scrollCanvasToLayer,
  ]);

  // Scroll to selected layer after breakpoint change (uses ref to avoid stale zoom closure)
  useEffect(() => {
    if (
      isPreviewMode ||
      !selectedLayerId ||
      !canvasIframeElement ||
      !isCanvasReady
    )
      return;

    const timeout = setTimeout(() => {
      scrollCanvasToLayerRef.current(selectedLayerId, true, true);
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportMode]);

  // Track container dimensions for dynamic alignment
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    const updateContainerDimensions = () => {
      const height = container.clientHeight;
      const width = container.clientWidth;
      setContainerHeight(height);
      setContainerWidth(width);

      // Mark canvas ready once we have valid dimensions
      if (height > 0 && width > 0 && !isCanvasReady) {
        // Use rAF to ensure zoom calculation has applied before revealing
        requestAnimationFrame(() => {
          setIsCanvasReady(true);
        });
      }
    };

    updateContainerDimensions();
    const resizeObserver = new ResizeObserver(updateContainerDimensions);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [isCanvasReady]);

  // Track preview container height so the preview iframe wrapper can be sized
  // to fit the visible area (mirrors the canvas container tracking).
  useEffect(() => {
    const container = previewContainerRef.current;
    if (!container) return;

    const update = () => {
      setPreviewContainerHeight(container.clientHeight);
      setPreviewContainerWidth(container.clientWidth);
    };
    update();
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [isPreviewMode]);

  const layers = useMemo<Layer[]>(() => {
    // Page layers come only from `usePagesStore.pages`
    if (!currentPageId) {
      return [];
    }

    return currentPage ? currentPage.layers : [];
  }, [currentPage, editingComponentId, currentPageId]);

  // Check if canvas is empty (only Body layer with no children)
  const isCanvasEmpty = useMemo(() => {
    if (layers?.length === 0) return false; // No layers at all - handled separately

    // Find Body layer
    const bodyLayer = layers.find(
      (layer) => layer.id === "body" || layer.name === "body",
    );

    if (!bodyLayer) return false;

    // Check if Body has no children or empty children array
    const hasNoChildren =
      !bodyLayer.children || bodyLayer.children.length === 0;

    // Canvas is empty if we only have Body with no children
    return layers.length === 1 && hasNoChildren;
  }, [layers]);

  // Note: Canvas drag-and-drop state is handled by useCanvasDropDetection hook
  // and CanvasDropIndicatorOverlay component (they subscribe to store directly)

  // Text editor toolbar state from store
  const isTextEditing = useCanvasTextEditorStore((state) => state.isEditing);
  const editingLayerId = useCanvasTextEditorStore(
    (state) => state.editingLayerId,
  );
  const textEditorActiveMarks = useCanvasTextEditorStore(
    (state) => state.activeMarks,
  );
  const toggleBold = useCanvasTextEditorStore((state) => state.toggleBold);
  const toggleItalic = useCanvasTextEditorStore((state) => state.toggleItalic);
  const toggleUnderline = useCanvasTextEditorStore(
    (state) => state.toggleUnderline,
  );
  const toggleStrike = useCanvasTextEditorStore((state) => state.toggleStrike);
  const toggleSubscript = useCanvasTextEditorStore(
    (state) => state.toggleSubscript,
  );
  const toggleSuperscript = useCanvasTextEditorStore(
    (state) => state.toggleSuperscript,
  );
  const setHeading = useCanvasTextEditorStore((state) => state.setHeading);
  const focusEditor = useCanvasTextEditorStore((state) => state.focusEditor);
  const requestFinishEditing = useCanvasTextEditorStore(
    (state) => state.requestFinish,
  );
  const addFieldVariable = useCanvasTextEditorStore(
    (state) => state.addFieldVariable,
  );
  const textEditor = useCanvasTextEditorStore((state) => state.editor);

  // Exit text edit mode if a different layer is selected
  useEffect(() => {
    if (isTextEditing && editingLayerId && selectedLayerId !== editingLayerId) {
      requestFinishEditing();
    }
  }, [isTextEditing, editingLayerId, selectedLayerId, requestFinishEditing]);

  // Close rich text sheet if a different layer is selected. Flushing the
  // pending translation save first ensures the last keystroke is persisted
  // when the user changes selection mid-edit. The flush function is defined
  // later in this component, so we go through a ref to keep effect ordering
  // and avoid a "use-before-declaration" cycle.
  const flushRichTextTranslationSaveRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (richTextSheetLayerId && selectedLayerId !== richTextSheetLayerId) {
      flushRichTextTranslationSaveRef.current();
      closeRichTextSheet();
    }
  }, [richTextSheetLayerId, selectedLayerId, closeRichTextSheet]);

  // Reset content height when page changes to force Canvas to recalculate
  useEffect(() => {
    setReportedContentHeight(0);
  }, [currentPageId]);

  // Reset content width when switching components
  useEffect(() => {
    setReportedContentWidth(0);
  }, [editingComponentId]);

  // On component open, hide the canvas so the initial multi-pass auto-zoom isn't
  // visible. Only keyed on editingComponentId — NOT on dimensions — so reveals
  // during normal editing don't re-hide and blink the canvas.
  useEffect(() => {
    setIsComponentCanvasSettling(!!editingComponentId);
  }, [editingComponentId]);

  // While settling (just opened), reveal once measured dimensions hold steady
  // (debounced). Runs only while settling, so editing-time dimension changes
  // don't trigger it. Fires even with no change via the settling dependency.
  useEffect(() => {
    if (!editingComponentId || !isComponentCanvasSettling) return;
    clearTimeout(componentSettleTimerRef.current);
    componentSettleTimerRef.current = setTimeout(
      () => setIsComponentCanvasSettling(false),
      200,
    );
    return () => clearTimeout(componentSettleTimerRef.current);
  }, [
    editingComponentId,
    isComponentCanvasSettling,
    reportedContentWidth,
    reportedContentHeight,
  ]);

  // Component editing canvas sizing
  const COMPONENT_CANVAS_PADDING = 0;

  // Parse viewport width
  const viewportWidth = useMemo(() => {
    return parseInt(viewportSizes[viewportMode].width);
  }, [viewportMode]);

  // Calculate default iframe height to fill canvas — track current container height
  // so the white canvas always fills all the available vertical space, even when the
  // surrounding panels (sidebar, inspector, etc.) resize the canvas container.
  const defaultCanvasHeight = useMemo(() => {
    if (!containerHeight) return 600;
    return Math.max(0, containerHeight - CANVAS_PADDING);
  }, [containerHeight]);

  // Effective iframe height: max of reported content and canvas height
  // This ensures Body fills canvas (min-height: 100%), but iframe shrinks when content is removed
  const iframeContentHeight = useMemo(() => {
    // When editing a component, use content height + padding (don't force-fill container)
    if (editingComponentId && reportedContentHeight > 0) {
      return reportedContentHeight + COMPONENT_CANVAS_PADDING;
    }
    // Use max of reported content and canvas height
    // When content is small: iframe = canvas height, Body fills it with min-height: 100%
    // When content is large: iframe = content height, and shrinks when content is deleted
    return Math.max(reportedContentHeight, defaultCanvasHeight);
  }, [reportedContentHeight, defaultCanvasHeight, editingComponentId]);

  // Effective canvas width: content-based for component editing, viewport-based for pages
  const effectiveCanvasWidth = useMemo(() => {
    if (editingComponentId && reportedContentWidth > 0) {
      const padded = reportedContentWidth + COMPONENT_CANVAS_PADDING;
      return Math.min(padded, viewportWidth);
    }
    return viewportWidth;
  }, [editingComponentId, reportedContentWidth, viewportWidth]);

  // Calculate content height for zoom calculations
  // Use actual iframe content height for both modes
  // This allows "Fit height" to zoom based on document content, not viewport
  const zoomContentHeight = iframeContentHeight;

  // Initialize zoom hook
  const {
    zoom,
    zoomMode,
    zoomIn,
    zoomOut,
    setZoomTo,
    resetZoom,
    zoomToFit,
    autofit,
    handleZoomGesture,
  } = useZoom({
    containerRef: canvasContainerRef,
    contentWidth: effectiveCanvasWidth,
    contentHeight: zoomContentHeight,
    minZoom: 10,
    maxZoom: 1000,
    zoomStep: 10,
    shortcutsEnabled: !isPreviewMode,
  });

  // Pan the canvas by dragging while holding Space or with the middle mouse button
  const { isPanGestureActive } = useCanvasPan({
    scrollContainerRef,
    iframeElement: canvasIframeElement,
    enabled: !isPreviewMode,
    isTextEditing,
  });

  // Independent zoom for the preview (second useZoom instance, active only in preview mode)
  const previewContentWidth = parseInt(viewportSizes[viewportMode].width);
  const {
    zoom: previewZoom,
    zoomMode: previewZoomMode,
    zoomIn: previewZoomIn,
    zoomOut: previewZoomOut,
    resetZoom: previewResetZoom,
    zoomToFit: previewZoomToFit,
    autofit: previewAutofit,
  } = useZoom({
    containerRef: previewContainerRef,
    contentWidth: previewContentWidth,
    contentHeight: previewContentHeight || defaultCanvasHeight,
    minZoom: 10,
    maxZoom: 1000,
    zoomStep: 10,
    shortcutsEnabled: isPreviewMode,
    iframeRef,
  });

  // Size the iframe element to exactly fill the visible canvas area at the
  // current zoom. The iframe's native scrolling then handles document content
  // taller than this — giving a single, properly-bounded scrollbar inside the
  // canvas instead of an (invisible) outer container scroll. Content height
  // (iframeContentHeight) still drives Fit Height zoom calc separately.
  const finalIframeHeight = useMemo(() => {
    if (editingComponentId) return iframeContentHeight;
    if (!containerHeight || zoom <= 0) return iframeContentHeight;

    return (containerHeight - CANVAS_PADDING) / (zoom / 100);
  }, [iframeContentHeight, containerHeight, zoom, editingComponentId]);

  // Same logic as finalIframeHeight, applied to the preview iframe. Sizing the
  // wrapper to the measured scrollHeight is unstable on pages that pin absolute
  // elements to the viewport (e.g. `bottom: -6rem` with no positioned ancestor)
  // — once `h-full` is restored after measurement, those elements extend past
  // the wrapper. Sizing to the visible container area instead lets the iframe
  // scroll internally and keeps the scrollbar bounded and accurate.
  const finalPreviewIframeHeight = useMemo(() => {
    if (!previewContainerHeight || previewZoom <= 0) return 0;
    return (previewContainerHeight - CANVAS_PADDING) / (previewZoom / 100);
  }, [previewContainerHeight, previewZoom]);

  // Natural (unscaled) width of the preview iframe — its true layout viewport.
  // Mirrors the previous `width: '100%' (minWidth: viewport)` vs fixed-width
  // logic, but as a concrete pixel value so the iframe can be scaled with
  // `transform` instead of CSS `zoom`. In desktop autofit the preview fills the
  // available container width (but never below the desktop breakpoint); other
  // modes use the exact breakpoint width.
  const previewStageWidth = useMemo(() => {
    if (viewportMode === "desktop" && previewZoomMode === "autofit") {
      return Math.max(
        previewContainerWidth - CANVAS_PADDING,
        previewContentWidth,
      );
    }
    return previewContentWidth;
  }, [
    viewportMode,
    previewZoomMode,
    previewContainerWidth,
    previewContentWidth,
  ]);

  // Handle any click inside the canvas (closes ElementLibrary panel and other popovers)
  const handleCanvasClick = useCallback(() => {
    // Ignore clicks that are part of a pan gesture (Space-drag / middle-mouse)
    if (isPanGestureActive()) return;
    window.dispatchEvent(new CustomEvent("closeElementLibrary"));
    window.dispatchEvent(new CustomEvent("canvasClick"));
  }, [isPanGestureActive]);

  // Canvas callback handlers
  const handleCanvasLayerClick = useCallback(
    (layerId: string, event?: React.MouseEvent) => {
      // Don't select layers while panning the canvas (Space-drag / middle-mouse)
      if (isPanGestureActive()) return;

      // Skip selection changes during drag operations
      const {
        isDraggingLayerOnCanvas,
        isDraggingToCanvas,
        elementPicker: picker,
      } = useEditorStore.getState();
      if (isDraggingLayerOnCanvas || isDraggingToCanvas) {
        return;
      }

      // Element picker mode: intercept click to select an element
      if (picker?.active && picker.onSelect) {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }
        if (picker.validate && !picker.validate(layerId)) {
          toast.error("Please select an input element inside a Filter form.");
          return;
        }
        picker.onSelect(layerId);
        return;
      }

      if (!isPreviewMode) {
        // Switch to Layers tab when a layer is clicked on canvas
        setActiveSidebarTab("layers");

        // Detect if clicked on a text style element or a richText sublayer block
        let textStyleKey: string | null = null;
        let blockIndex: number | null = null;
        let listItemIndex: number | null = null;

        if (event) {
          let target = event.target as HTMLElement;
          let blockLevelStyleKey: string | null = null;

          // Walk up the DOM tree to find data-style, data-block-index, data-list-item-index.
          // The textStyleKey from the element with data-block-index is the actual content
          // block type (e.g. blockquote), not an inner element's style (e.g. paragraph).
          while (target && target !== event.currentTarget) {
            const styleAttr = target.getAttribute?.("data-style");
            if (styleAttr && !textStyleKey) {
              textStyleKey = styleAttr;
            }
            if (listItemIndex === null) {
              const listItemAttr = target.getAttribute?.(
                "data-list-item-index",
              );
              if (listItemAttr !== null)
                listItemIndex = parseInt(listItemAttr, 10);
            }
            if (blockIndex === null) {
              const blockAttr = target.getAttribute?.("data-block-index");
              if (blockAttr !== null) {
                blockIndex = parseInt(blockAttr, 10);
                if (styleAttr) blockLevelStyleKey = styleAttr;
              }
            }
            target = target.parentElement as HTMLElement;
          }

          // Prefer the block-level style over structural inner elements (e.g.
          // paragraph inside blockquote), but keep inline marks and sub-block
          // styles like listItem that shouldn't be overridden by their container
          const INNER_STYLE_KEYS = new Set([
            "bold",
            "italic",
            "underline",
            "strike",
            "link",
            "subscript",
            "superscript",
          ]);
          if (
            blockLevelStyleKey &&
            (!textStyleKey || !INNER_STYLE_KEYS.has(textStyleKey))
          ) {
            textStyleKey = blockLevelStyleKey;
          }
        }

        // For non-CMS-bound rich text, sublayers are style-based (unique types),
        // so skip block-level sublayerIndex/listItemIndex — only set textStyleKey
        let resolvedSublayerIndex = Number.isFinite(blockIndex)
          ? blockIndex
          : null;
        let resolvedListItemIndex = Number.isFinite(listItemIndex)
          ? listItemIndex
          : null;
        if (resolvedSublayerIndex !== null && textStyleKey) {
          const layers = currentPage?.layers || [];
          const layer = findLayerById(layers, layerId);
          if (
            layer &&
            isRichTextLayer(layer) &&
            !getLayerCmsFieldBinding(layer)
          ) {
            resolvedSublayerIndex = null;
            resolvedListItemIndex = null;
          }
        }

        selectLayerWithSublayer(layerId, {
          textStyleKey,
          sublayerIndex: resolvedSublayerIndex,
          listItemIndex: resolvedListItemIndex,
        });
      }
    },
    [
      isPanGestureActive,
      isPreviewMode,
      setActiveSidebarTab,
      selectLayerWithSublayer,
      editingComponentId,
    ],
  );

  const handleCanvasLayerUpdate = useCallback(
    (layerId: string, updates: Partial<Layer>) => {
      // Block all source-layer mutations from the canvas while in a non-default
      // locale. The Translate panel writes through the translations table instead
      // of mutating the layer tree.
      if (selectedLocale && !selectedLocale.is_default) return;

      if (currentPageId) {
        updateLayer(currentPageId, layerId, updates);
      }
    },
    [editingComponentId, currentPageId, updateLayer, selectedLocale],
  );

  const handleCanvasDeleteLayer = useCallback(() => {
    if (!selectedLayerId || !currentPageId) return;
  }, [
    selectedLayerId,
    currentPageId,
    selectedLayerIds,

    deleteLayers,
    clearSelection,
    deleteLayer,
    setSelectedLayerId,
    activeSublayerIndex,
    setActiveSublayerIndex,
    updateLayer,
    selectedLocale,
  ]);

  const handleCanvasGapUpdate = useCallback(
    (layerId: string, gapValue: string) => {},
    [currentPageId, updateLayer, selectedLocale],
  );

  // Track the current value locally so the value prop always matches the editor's
  // internal state. This prevents the editor's sync effect from resetting content
  // when other deps (fields, allFields) change.
  const [richTextSheetValue, setRichTextSheetValue] = useState<unknown>(null);

  // Translation context for the rich-text sheet. When the user is browsing the
  // canvas in a non-default locale and a rich-text layer is the sheet target,
  // we redirect read/write through the translations table instead of mutating
  // the source layer. This is what makes the rich-text editor act as the
  // translation surface for rich text (no plain-textarea fallback in the sidebar).
  const richTextTranslationContext = useMemo(() => {}, [
    richTextSheetLayerId,
    selectedLocale,
    editingComponentId,

    currentPageId,
  ]);

  useEffect(() => {
    if (!richTextSheetLayerId) {
      setRichTextSheetValue(null);
      return;
    }

    // Localization mode: only show the saved translation. Per spec we don't
    // surface the default-locale source inside the editor — the user types the
    // translation from scratch (the source is visible on the canvas).

    const source: Layer[] | null =
      usePagesStore.getState().pages.find((p) => p.id === currentPageId)
        ?.layers ?? null;
    const layer = source ? findLayerById(source, richTextSheetLayerId) : null;
    setRichTextSheetValue(getRichTextValue(layer?.variables));
    // Only re-derive when the sheet target layer (or translation context) changes,
    // not on every layer update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [richTextSheetLayerId, richTextTranslationContext, selectedLocaleId]);

  // Debounced save for translation writes — the rich-text editor fires onChange
  // on every keystroke, so we coalesce writes to avoid spamming the API and
  // racing the optimistic create with concurrent updates.
  const richTextTranslationSaveTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const richTextTranslationPendingValueRef = useRef<{
    key: string;
    value: string;
    localeId: string;
  } | null>(null);

  const flushRichTextTranslationSave = useCallback(() => {}, [
    richTextTranslationContext,
    selectedLocaleId,
  ]);

  // Keep the flush ref pointing at the latest closure so the early
  // close-on-different-selection effect can flush without a forward reference.
  useEffect(() => {
    flushRichTextTranslationSaveRef.current = flushRichTextTranslationSave;
  }, [flushRichTextTranslationSave]);

  const handleRichTextSheetChange = useCallback(
    (_value: unknown): void => {},
    [
      richTextSheetLayerId,
      updateLayer,
      richTextTranslationContext,
      flushRichTextTranslationSave,
    ],
  );

  // Handle iframe ready callback (for SelectionOverlay)
  const handleIframeReady = useCallback((iframeElement: HTMLIFrameElement) => {
    setCanvasIframeElement(iframeElement);
  }, []);

  // Undo/Redo handlers
  // Note: We don't auto-save after undo/redo to preserve the redo stack
  // The state will be saved when the user makes the next change
  const handleUndo = useCallback(async () => {}, []);

  const handleRedo = useCallback(async () => {}, []);

  // Handle layer hover from Canvas (for SelectionOverlay)
  const handleCanvasLayerHover = useCallback(
    (layerId: string | null) => {},
    [],
  );

  // Handle drop callback for useCanvasDropDetection
  const handleCanvasDrop = useCallback(
    (
      elementType: string,
      source: "elements" | "layouts" | "components",
      dropTarget: {
        layerId: string;
        position: "above" | "below" | "inside";
        parentId: string | null;
      },
    ) => {},
    [currentPageId, addLayerFromTemplate, setSelectedLayerId, selectedLocale],
  );

  // Use the canvas drop detection hook for throttled hit-testing
  useCanvasDropDetection({
    iframeElement: canvasIframeElement,
    zoom,
    layers,
    pageId: currentPageId,
    onDrop: handleCanvasDrop,
  });

  // Handle layer reorder callback for sibling reordering on canvas
  const handleLayerReorder = useCallback(
    (newLayers: Layer[]) => {
      if (!currentPageId) return;

      // Component editing is not supported on this route yet.
      if (editingComponentId) return;

      setLayers(currentPageId, newLayers);
    },
    [currentPageId, editingComponentId, setLayers],
  );

  // Use the canvas sibling reorder hook for drag-to-reorder within same parent
  // Disable during text edit mode so text selection works
  useCanvasSiblingReorder({
    iframeElement: canvasIframeElement,
    zoom,
    layers,
    pageId: currentPageId,
    selectedLayerId,
    disabled: isTextEditing,
    onReorder: handleLayerReorder,
    onLayerSelect: setSelectedLayerId,
  });

  // Calculate parent layer ID for selection overlay (one level up from selected)
  const parentLayerId = useMemo(() => {
    if (!selectedLayerId || !currentPageId) return null;

    const layersToSearch: Layer[] = currentPage ? currentPage.layers : [];

    if (!layersToSearch.length) return null;

    const findParentId = (
      layers: Layer[],
      targetId: string,
      parentId: string | null = null,
    ): string | null | undefined => {
      for (const layer of layers) {
        if (layer.id === targetId) {
          return parentId;
        }
        if (layer.children && layer.children.length > 0) {
          const result = findParentId(layer.children, targetId, layer.id);
          if (result !== undefined) {
            return result;
          }
        }
      }
      return undefined;
    };

    const result = findParentId(layersToSearch, selectedLayerId);
    if (result === undefined) return null;

    const selectedLayer = findLayerById(layersToSearch, selectedLayerId);
    if (selectedLayer?.name === "slide") return null;

    return result;
  }, [selectedLayerId, currentPageId, editingComponentId, currentPage]);

  // Get selected layer name for drag preview
  const selectedLayerName = useMemo(() => {
    if (!selectedLayerId) return null;
    const layer = findLayerById(layers, selectedLayerId);
    // Use layer's name property (e.g., 'div', 'section', 'heading')
    return layer?.name || null;
  }, [selectedLayerId, layers]);

  return (
    <div className="flex-1 min-w-0 flex flex-col relative">
      {/* Top Bar */}

      {/* Canvas Area */}
      <div
        ref={canvasContainerRef}
        className="flex-1 relative overflow-hidden bg-neutral-50 dark:bg-neutral-950/80 select-none"
      >
        {/* Selection overlay - renders outlines on top of the iframe */}
        {!isPreviewMode &&
          activeSidebarTab !== "pages" &&
          canvasIframeElement && (
            <SelectionOverlay
              iframeElement={canvasIframeElement}
              containerElement={scrollContainerRef.current}
              selectedLayerId={selectedLayerId}
              parentLayerId={parentLayerId}
              zoom={zoom}
              activeSublayerIndex={activeSublayerIndex}
              activeListItemIndex={activeListItemIndex}
            />
          )}

        {/* Drag capture overlay - prevents iframe from swallowing mouse events during drag */}
        {!isPreviewMode && <DragCaptureOverlay />}

        {/* Element picker SVG connector overlay */}
        <ElementPickerOverlay iframeElement={canvasIframeElement} zoom={zoom} />

        {/* Translation loading overlay — shown while translations for the
            active locale are being fetched. Mirrors the preview-mode overlay
            below for visual consistency. */}
        {/* {isLocalizing && isLoadingTranslations && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-background/80">
            <Spinner />
          </div>
        )} */}

        {/* Scrollable container with hidden scrollbars (editor canvas) */}
        <div
          ref={scrollContainerRef}
          className={cn(
            "absolute inset-0 z-0 overflow-auto",
            elementPicker?.active && "cursor-crosshair",
          )}
          style={{
            opacity: isCanvasReady && !isComponentCanvasSettling ? 1 : 0,
            transition: "opacity 120ms ease-out",
            scrollbarWidth: "none", // Firefox
            msOverflowStyle: "none", // IE/Edge
            WebkitOverflowScrolling: "touch",
          }}
          onClick={handleCanvasClick}
        >
          {/* Hide scrollbars for Webkit browsers */}
          <style jsx>{`
            div::-webkit-scrollbar {
              display: none;
            }
          `}</style>

          {/* Editor mode: Scaled canvas with zoom controls - always in DOM, never resized */}
          <div
            style={{
              position: "relative",
              minWidth: "100%",
              minHeight: "100%",
              // When editing a component, center the canvas inside the scroll area.
              // Rely on minHeight (not a fixed height) so the container grows with
              // tall content — a fixed height:100% would keep the centered child
              // overflowing past the unreachable top edge (flexbox centering clip).
              // Page editing keeps default block flow so absolute overlays anchor at the top.
              ...(editingComponentId
                ? {
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }
                : null),
            }}
          >
            <div
              style={{
                // Width: exact scaled size, min 100% to fill viewport horizontally
                width: `${effectiveCanvasWidth * (zoom / 100) + CANVAS_PADDING}px`,
                minWidth: "100%",
                // Height: scaled iframe size + canvas padding. finalIframeHeight is
                // already stretched to fill the viewport at any zoom level, so the
                // white canvas always fills the available height.
                height: `${finalIframeHeight * (zoom / 100) + CANVAS_PADDING}px`,
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "center",
                paddingTop: `${CANVAS_BORDER}px`,
                position: "relative",
              }}
            >
              {/* Sizer: occupies the SCALED footprint so the scroll area,
                    centering, and drop shadow match the visible canvas size. */}
              <div
                className={
                  editingComponentId
                    ? "relative"
                    : "bg-white shadow-3xl relative"
                }
                style={{
                  width: `${effectiveCanvasWidth * (zoom / 100)}px`,
                  height: `${finalIframeHeight * (zoom / 100)}px`,
                  flexShrink: 0, // Prevent shrinking - maintain fixed size
                  // Clip overflow when canvas is smaller than iframe (component editing)
                  overflow: editingComponentId ? "hidden" : undefined,
                }}
              >
                {/* Stage: natural (unscaled) size, scaled with CSS transform from
                      the top-left corner. We deliberately use `transform: scale()`
                      instead of CSS `zoom`: Safari shrinks an iframe's content layout
                      viewport when an ancestor uses `zoom`, which rendered the page
                      too narrow (white space on the right) and misaligned the
                      selection overlay. transform keeps the iframe at its true
                      breakpoint width while only scaling the painted output. */}
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: `${effectiveCanvasWidth}px`,
                    height: `${finalIframeHeight}px`,
                    transform: `scale(${zoom / 100})`,
                    transformOrigin: "top left",
                    // No transition to prevent shifts
                    transition: "none",
                  }}
                >
                  {/* Inner wrapper: keep iframe at viewport width for natural content rendering */}
                  <div
                    style={{
                      width:
                        editingComponentId &&
                        effectiveCanvasWidth < viewportWidth
                          ? `${viewportWidth}px`
                          : "100%",
                      height: "100%",
                    }}
                  >
                    {/* Canvas for editor */}
                    {layers.length > 0 ? (
                      <>
                        <Canvas
                          key={`editor-${currentPageId}`}
                          layers={layers}
                          //components={components}
                          selectedLayerId={selectedLayerId}
                          hoveredLayerId={null}
                          breakpoint={viewportMode}
                          activeUIState={activeUIState}
                          editingComponentId={editingComponentId || null}
                          collectionItems={mergedCollectionItems}
                          collectionFields={collectionFieldsFromStore}
                          pageCollectionItem={translatedPageCollectionItem}
                          pageCollectionFields={pageCollectionFields}
                          currentLocale={selectedLocale}
                          availableLocales={locales}
                          translations={localeTranslations}
                          assets={assetsMap}
                          pageId={currentPageId || ""}
                          onLayerClick={handleCanvasLayerClick}
                          onLayerUpdate={handleCanvasLayerUpdate}
                          onDeleteLayer={handleCanvasDeleteLayer}
                          onContentHeightChange={setReportedContentHeight}
                          onContentWidthChange={
                            editingComponentId
                              ? setReportedContentWidth
                              : undefined
                          }
                          onGapUpdate={handleCanvasGapUpdate}
                          onZoomGesture={handleZoomGesture}
                          onZoomIn={zoomIn}
                          onZoomOut={zoomOut}
                          onResetZoom={resetZoom}
                          onZoomToFit={zoomToFit}
                          onAutofit={autofit}
                          onUndo={handleUndo}
                          onRedo={handleRedo}
                          onIframeReady={handleIframeReady}
                          onLayerHover={handleCanvasLayerHover}
                          onCanvasClick={handleCanvasClick}
                          onComponentEdit={handleCanvasComponentEdit}
                          editingComponentVariables={editingComponentVariables}
                          forceVisibleLayerIds={
                            activeInteractionTriggerLayerId
                              ? activeInteractionTargetLayerIds
                              : undefined
                          }
                          zoom={zoom}
                          referenceViewportHeight={defaultCanvasHeight}
                        />

                        {/* Drop indicator overlay - subscribes to store directly */}
                        <CanvasDropIndicatorOverlay
                          iframeElement={canvasIframeElement}
                        />

                        {/* Sibling reorder indicator overlay - for drag-to-reorder on canvas */}
                        <CanvasSiblingReorderOverlay
                          iframeElement={canvasIframeElement}
                        />

                        {/* Empty overlay when only Body with no children */}
                        {isCanvasEmpty && (
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                            <div className="pointer-events-auto">
                              <Empty className="bg-transparent border-0 text-neutral-900">
                                <EmptyContent>
                                  <EmptyMedia
                                    variant="icon"
                                    className="size-9 mb-0 bg-neutral-900/5"
                                  >
                                    <Icon
                                      name="layout"
                                      className="size-3 text-neutral-900"
                                    />
                                  </EmptyMedia>
                                  <EmptyHeader>
                                    <EmptyTitle className="text-sm">
                                      "Start building"
                                    </EmptyTitle>
                                    <EmptyDescription>
                                      Add your first block to begin creating
                                      your page.
                                    </EmptyDescription>
                                  </EmptyHeader>

                                  <Button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      window.dispatchEvent(
                                        new CustomEvent(
                                          "toggleElementLibrary",
                                          {
                                            detail: { tab: "layouts" },
                                          },
                                        ),
                                      );
                                    }}
                                    size="sm"
                                    variant="secondary"
                                    className="bg-neutral-900/5 hover:bg-neutral-900/10 text-neutral-900"
                                  >
                                    <Icon name="plus" />
                                    Add layout
                                  </Button>
                                </EmptyContent>
                              </Empty>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center p-12">
                        <div className="text-center max-w-md relative">
                          <div className="w-20 h-20 bg-linear-to-br from-blue-100 to-blue-50 rounded-2xl mx-auto mb-6 flex items-center justify-center">
                            <Icon
                              name="layout"
                              className="w-10 h-10 text-blue-500"
                            />
                          </div>
                          <h2 className="text-2xl font-bold text-gray-900 mb-3">
                            "Start building"
                          </h2>
                          <p className="text-gray-600 mb-8">
                            "Add your first block to begin creating your page."
                          </p>

                          <div className="relative inline-block">
                            <Button
                              size="lg"
                              className="gap-2"
                              disabled={
                                !!(selectedLocale && !selectedLocale.is_default)
                              }
                            >
                              <Icon name="plus" className="w-5 h-5" />
                              Add Block
                            </Button>

                            {/* Add Block Panel */}
                            {showAddBlockPanel && currentPageId && (
                              <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-50 bg-white border border-gray-200 rounded-lg shadow-2xl min-w-60">
                                <div className="p-2">
                                  <div className="text-xs text-gray-500 px-3 py-2 mb-1 font-medium">
                                    Choose a block
                                  </div>

                                  <Button
                                    onClick={() => {
                                      // Always add inside Body container
                                      addLayerFromTemplate(
                                        currentPageId,
                                        "body",
                                        "div",
                                      );
                                      setShowAddBlockPanel(false);
                                    }}
                                    variant="ghost"
                                    className="w-full justify-start gap-3 px-3 py-3 h-auto"
                                  >
                                    <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                                      <Icon
                                        name="container"
                                        className="w-5 h-5 text-gray-700"
                                      />
                                    </div>
                                    <div className="text-left">
                                      <div className="text-sm font-semibold text-gray-900">
                                        Div
                                      </div>
                                      <div className="text-xs text-gray-500">
                                        Container element
                                      </div>
                                    </div>
                                  </Button>

                                  <Button
                                    onClick={() => {
                                      // Always add inside Body container
                                      addLayerFromTemplate(
                                        currentPageId,
                                        "body",
                                        "heading",
                                      );
                                      setShowAddBlockPanel(false);
                                    }}
                                    variant="ghost"
                                    className="w-full justify-start gap-3 px-3 py-3 h-auto"
                                  >
                                    <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                                      <Icon
                                        name="heading"
                                        className="w-5 h-5 text-gray-700"
                                      />
                                    </div>
                                    <div className="text-left">
                                      <div className="text-sm font-semibold text-gray-900">
                                        Heading
                                      </div>
                                      <div className="text-xs text-gray-500">
                                        Title text
                                      </div>
                                    </div>
                                  </Button>

                                  <Button
                                    onClick={() => {
                                      // Always add inside Body container
                                      addLayerFromTemplate(
                                        currentPageId,
                                        "body",
                                        "text",
                                      );
                                      setShowAddBlockPanel(false);
                                    }}
                                    variant="ghost"
                                    className="w-full justify-start gap-3 px-3 py-3 h-auto"
                                  >
                                    <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                                      <Icon
                                        name="type"
                                        className="w-5 h-5 text-gray-700"
                                      />
                                    </div>
                                    <div className="text-left">
                                      <div className="text-sm font-semibold text-gray-900">
                                        Paragraph
                                      </div>
                                      <div className="text-xs text-gray-500">
                                        Body text
                                      </div>
                                    </div>
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Preview panel - fixed overlay covering sidebars + canvas below the main header.
          Always rendered so the iframe stays mounted (no reload on toggle). */}
      <div
        className="flex flex-col bg-neutral-50 dark:bg-neutral-950"
        style={{
          position: "fixed",
          top: "3.5rem", // h-14 header height
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 50,
          display: isPreviewMode ? "flex" : "none",
        }}
      >
        {/* Preview toolbar */}
        <div className="shrink-0 grid grid-cols-3 items-center p-4 border-b bg-background">
          <div />
          {/* <ViewportZoomControls
            viewportMode={viewportMode}
            zoom={previewZoom}
            onViewportChange={setViewportMode}
            onZoomIn={previewZoomIn}
            onZoomOut={previewZoomOut}
            onResetZoom={previewResetZoom}
            onZoomToFit={previewZoomToFit}
            onAutofit={previewAutofit}
          /> */}
          <div className="flex justify-end">
            {/* {previewUrl && ( */}
            <Button
              variant="secondary"
              size="sm"
              // onClick={() => window.open(previewUrl, "_blank")}
            >
              Open in new tab
              <Icon name="external-link" />
            </Button>
            {/* )} */}
          </div>
        </div>

        {/* Preview iframe area */}
        <div
          ref={previewContainerRef}
          className="flex-1 relative flex items-start overflow-x-auto overflow-y-hidden"
          style={{ padding: `${CANVAS_BORDER}px` }}
        >
          {/* {isPreviewLoading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-background">
              <Spinner />
            </div>
          )} */}
          {/* Sizer: occupies the SCALED footprint so centering and scrolling
              match the visible preview size. */}
          <div
            className="bg-white shadow-3xl relative mx-auto my-auto"
            style={{
              width: `${previewStageWidth * (previewZoom / 100)}px`,
              height:
                finalPreviewIframeHeight > 0
                  ? `${finalPreviewIframeHeight * (previewZoom / 100)}px`
                  : "100%",
              flexShrink: 0,
            }}
          >
            {/* Stage: natural (unscaled) size, scaled with `transform` instead of
                CSS `zoom`. Safari shrinks an iframe's content viewport under an
                ancestor `zoom`, which rendered previews too narrow; transform keeps
                the iframe at its true breakpoint width. */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: `${previewStageWidth}px`,
                height:
                  finalPreviewIframeHeight > 0
                    ? `${finalPreviewIframeHeight}px`
                    : "100%",
                transform: `scale(${previewZoom / 100})`,
                transformOrigin: "top left",
                transition: "none",
              }}
            >
              {/* {layers.length > 0 && isPreviewMode ? (
                <iframe
                  ref={iframeRef}
                  src={previewUrl}
                  className="w-full h-full border-0"
                  title="Preview"
                  tabIndex={-1}
                  onLoad={handlePreviewLoad}
                />
              ) : layers.length === 0 && isPreviewMode ? ( */}
              <div className="w-full h-full flex items-center justify-center p-12">
                <div className="text-center max-w-md">
                  <div className="w-20 h-20 bg-linear-to-br from-blue-100 to-blue-50 rounded-2xl mx-auto mb-6 flex items-center justify-center">
                    <Icon name="layout" className="w-10 h-10 text-blue-500" />
                  </div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-3">
                    No content
                  </h2>
                  <p className="text-gray-600">
                    This page has no content to preview.
                  </p>
                </div>
              </div>
              {/*  ) : null} */}
            </div>
          </div>
        </div>
      </div>

      {/* Rich text sheet for canvas double-click on layers with components/variables */}
      {/* {richTextSheetValue && (
        <RichTextEditorSheet
          open={!!richTextSheetLayerId}
          onOpenChange={(open) => {
            if (!open) {
              flushRichTextTranslationSave();
              closeRichTextSheet();
            }
          }}
          title="Content editor"
          description={richTextTranslationContext && selectedLocale
            ? `Translate to ${selectedLocale.label}`
            : 'Element content'}
          value={richTextSheetValue}
          onChange={handleRichTextSheetChange}
          fieldGroups={richTextSheetFieldGroups}
          allFields={collectionFieldsFromStore}
          collections={collectionsFromStore}
        />
      )} */}
    </div>
  );
});
export default EditorCenterCanvas;
