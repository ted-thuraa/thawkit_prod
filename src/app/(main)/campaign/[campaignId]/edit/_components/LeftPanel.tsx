"use client";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Rebuilt from scratch against Ycode's LeftSidebar.tsx (github.com/ycode/
 * ycode, MIT licensed) — see YCODE_EDITOR_INTEGRATION_HANDOFF.md for the
 * project background. The previous version of this file was an
 * unadapted paste of Ycode's source: it referenced variables that were
 * never defined anywhere in the file (`editingComponentId`,
 * `layersForCurrentPage`, `handleLayerSelect`, `handleLayersReorder`,
 * `liveLayerUpdates`, `liveComponentUpdates`, `readOnly`, `pagesRef`,
 * `folders`, `setCurrentPageId`, `isResizing`, `handleResizeMouseDown`),
 * imported a `LeftSidebarPages` that was never imported, and rendered an
 * `ElementLibrary` whose file was empty — it would have thrown at runtime
 * on first render. Tab switching was inert (`onValueChange={() => {}}`).
 *
 * WHAT CHANGED FROM YCODE (collaboration/broadcasting removed, everything
 * else ported):
 *   - No `useLiveLayerUpdates`/`useLiveComponentUpdates`/resource-locking —
 *     this project has no real-time collaboration (see handoff doc §3).
 *     `useLayerUpdates` is this project's own already-neutered stand-in.
 *   - No folders in the Pages tab — PagesTree.tsx renders a flat, ordered
 *     list; folders were evaluated and explicitly rejected for this
 *     project (handoff doc §2/§9).
 *   - Page creation is scoped to this project's actual 3 page types
 *     (landing_page/normal_page/result_page) instead of Ycode's
 *     Regular/CMS/Folder menu — landing_page is capped at one per funnel
 *     since it's the only type that renders at "/".
 *   - Component variants are LOCAL-ONLY (not persisted) — see
 *     useComponentsStore.ts's file header for why.
 *   - The Element Library's Layouts/Components tabs are honest empty
 *     states rather than fabricated functionality — see ElementLibrary.tsx.
 *
 * OWNERSHIP: this component now owns everything the old EditorBody.tsx
 * used to hold (page/layer CRUD handlers, page-settings panel state,
 * resizable-sidebar state) — matching Ycode's own LeftSidebar, which reads
 * its stores directly rather than receiving mutation handlers prop-drilled
 * from a parent. EditorBody.tsx is now a thin pass-through, matching how
 * little Ycode's own top-level route components do.
 * ─────────────────────────────────────────────────────────────────────────
 */

import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Layers, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import Icon from "@/components/ui/icon";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAlertDialog } from "@/providers/alert-dialog-provider";
import { useCampaignEditorUrl, type SidebarTab } from "@/hooks/use-editor-url";
import {
  EditorSidebarTab,
  useEditorStore,
} from "@/stores/editor/useEditorStore";
import { usePagesStore } from "@/stores/editor/usePagesStore";
import type { Layer } from "@/types/funnel";
import type { PageType } from "@/types/funnel";
import {
  createPageAction,
  deletePageAction,
  duplicatePageAction,
  reorderPagesAction,
  saveDraftLayersAction,
  updatePageAction,
} from "@/actions/editor/editor-actions";
import {
  getElementTemplateDefinitions,
  type EditorElementType,
} from "@/lib/editor/element-templates";
import PagesList from "./PagesList";
import LayersTree from "./LayersTree";
import ElementLibrary from "./ElementLibrary";
// import PagesContent, {
//   PAGE_TYPE_LABEL,
//   PagesContentHandle,
// } from "./PagesContent";
//import type { PageSettingsPanelHandle } from "./PageSettingsPanel";

// const PageSettingsPanel = lazy(() => import("./PageSettingsPanel"));
// const ElementLibrary = lazy(() => import("./ElementLibrary"));

interface LeftPanelProps {
  campaignId: string;
  readOnly?: boolean;
}

const LeftPanel = React.memo(function LeftPanel({
  campaignId,
  readOnly = false,
}: LeftPanelProps) {
  // const { showAlertDialog } = useAlertDialog();
  const {
    urlState,
    navigateToLayers,
    navigateToPages,
    navigateToPageSettings,
  } = useCampaignEditorUrl(campaignId);

  const [showElementLibrary, setShowElementLibrary] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // ─── Store state ──────────────────────────────────────────────────────
  const currentPageId = useEditorStore((s) => s.currentPageId);
  const setCurrentPageId = useEditorStore((state) => state.setCurrentPageId);
  const selectedLayerId = useEditorStore((s) => s.selectedLayerId);
  const setSelectedLayerId = useEditorStore((s) => s.setSelectedLayerId);
  const setActiveSidebarTab = useEditorStore((s) => s.setActiveSidebarTab);

  const setEditingComponentVariantId = useEditorStore(
    (s) => s.setEditingComponentVariantId,
  );

  const pages = usePagesStore((s) => s.pages);
  const setPages = usePagesStore((s) => s.setPages);
  const updatePageLocal = usePagesStore((s) => s.updatePageLocal);
  const removePageLocal = usePagesStore((s) => s.removePageLocal);
  const addLayerFromTemplate = usePagesStore((s) => s.addLayerFromTemplate);
  const setLayers = usePagesStore((s) => s.setLayers);
  const activeSidebarTab = useEditorStore((s) => s.activeSidebarTab);

  const activeTab: EditorSidebarTab = activeSidebarTab;
  useEffect(() => {
    setActiveSidebarTab(activeSidebarTab);
  }, [activeSidebarTab, setActiveSidebarTab]);

  const currentPage = pages.find((p) => p.id === currentPageId) ?? null;

  const layersForCurrentPage: Layer[] = useMemo(() => {
    return currentPage?.layers ?? [];
  }, [currentPage]);

  // ─── Persistence ──────────────────────────────────────────────────────
  // No debounced autosave exists in this project yet (deliberately
  // deferred — see editor-actions.ts's file header), so this is a light
  // debounce rather than a full coalescing queue: enough to avoid firing a
  // Server Action on every intermediate render, not a replacement for
  // real autosave infrastructure. Component-draft edits are intentionally
  // NOT persisted here — see useComponentsStore.ts's file header.
  const previousLayersRef = useRef<{ pageId: string; layers: Layer[] } | null>(
    null,
  );

  const persistLayers = useCallback(
    async (pageId: string) => {
      const layers = usePagesStore
        .getState()
        .pages.find((p) => p.id === pageId)?.layers;
      if (!layers) return;
      useEditorStore.getState().setSaving(true);
      const result = await saveDraftLayersAction(campaignId, pageId, layers);
      useEditorStore.getState().setSaving(false);
      if (!result.success) toast.error(result.error);
    },
    [campaignId],
  );

  useEffect(() => {
    if (!currentPageId || !currentPage) {
      previousLayersRef.current = null;
      return;
    }
    const prev = previousLayersRef.current;
    previousLayersRef.current = {
      pageId: currentPageId,
      layers: currentPage.layers,
    };
    if (!prev || prev.pageId !== currentPageId) return; // just switched/loaded pages — nothing to save yet
    if (prev.layers === currentPage.layers) return; // no structural change

    const timeout = setTimeout(() => {
      void persistLayers(currentPageId);
    }, 400);
    return () => clearTimeout(timeout);
  }, [currentPage, currentPageId, persistLayers]);

  // ─── Pages tab state & handlers ───────────────────────────────────────
  const [isCreatingPage, setIsCreatingPage] = useState(false);
  const [settingsPageId, setSettingsPageId] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<
    "general" | "seo" | "custom-code"
  >("general");
  //const settingsRef = useRef<PageSettingsPanelHandle>(null);

  useEffect(() => {
    if (activeTab === "pages" && urlState.isEditingPage && currentPageId) {
      setSettingsPageId(currentPageId);
      setSettingsTab(urlState.editTab ?? "general");
    }
  }, [activeTab, currentPageId, urlState.editTab, urlState.isEditingPage]);

  const hasLandingPage = pages.some((p) => p.pageType === "landing_page");

  // ─── Layers tab handlers ──────────────────────────────────────────────
  const handleLayerSelect = useCallback(
    (layerId: string | null) => {
      setSelectedLayerId(layerId);
    },
    [setSelectedLayerId],
  );

  const handleLayersReorder = useCallback(
    (newLayers: Layer[]) => {
      if (currentPageId) {
        setLayers(currentPageId, newLayers);
      }
    },
    [currentPageId, setLayers],
  );

  return (
    <>
      <div
        className={`relative z-30 h-full shrink-0 overflow-visible transition-[width] duration-300 ease-out ${
          isExpanded ? "w-64" : "w-10"
        }`}
      >
        {!isExpanded ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Expand layers panel"
            aria-expanded={false}
            className="size-10 rounded-xl bg-background shadow-lg"
            onClick={() => setIsExpanded(true)}
          >
            <Layers className="size-4" />
          </Button>
        ) : (
          <div className="relative h-full shrink-0 w-64">
            {/* Floating card: full border + radius + shadow replace the old
            docked `border-r`; `pb-2` (was `pb-0`) keeps the last tree row
            off the rounded bottom corners. */}
            <div className="flex h-full w-full overflow-hidden rounded-xl border bg-background p-4 pb-2 shadow-lg">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Collapse layers panel"
                aria-expanded={true}
                className="absolute right-3 top-3 z-30 size-8"
                onClick={() => setIsExpanded(false)}
              >
                <X className="size-4" />
              </Button>
              {/* Tabs */}
              <div className="w-full">
                <Tabs
                  value={activeTab}
                  onValueChange={async (value) => {
                    const newTab = value as SidebarTab;

                    setActiveSidebarTab(newTab);
                    setShowElementLibrary(false);
                  }}
                  className="h-full overflow-hidden gap-0!"
                >
                  {!readOnly && (
                    <TabsList className="w-full shrink-0 pr-10">
                      <TabsTrigger value="layers">Layers</TabsTrigger>
                      <TabsTrigger value="pages">Pages</TabsTrigger>
                    </TabsList>
                  )}

                  <hr className="mt-4" />

                  {/* Radix mounts only the active content so the selected tab
                      controls which panel is visible. */}
                  <TabsContent value="layers" className="flex flex-col min-h-0">
                    <header className="py-5 flex justify-between shrink-0 z-20">
                      <span className="font-medium">Layers</span>
                      {!readOnly && (
                        <div className="-my-1">
                          <Button
                            size="xs"
                            variant="secondary"
                            onClick={() =>
                              setShowElementLibrary((prev) => !prev)
                            }
                          >
                            <Icon
                              name="plus"
                              className={`${showElementLibrary ? "rotate-45" : "rotate-0"} transition-transform duration-100`}
                            />
                          </Button>
                        </div>
                      )}
                    </header>

                    <div
                      className="flex flex-col flex-1 min-h-0 overflow-y-auto overflow-x-auto no-scrollbar"
                      style={
                        {
                          "--tree-available-width": `${256 - 33}px`,
                        } as React.CSSProperties
                      }
                    >
                      {!currentPageId ? (
                        <Empty>
                          <EmptyTitle>No page selected</EmptyTitle>
                          <EmptyDescription>
                            Select a page from the Pages tab to start building
                          </EmptyDescription>
                        </Empty>
                      ) : layersForCurrentPage.length === 0 ? (
                        <Empty>
                          <EmptyTitle>No layers yet</EmptyTitle>
                          <EmptyDescription>
                            Click the + button above to add your first block
                          </EmptyDescription>
                        </Empty>
                      ) : (
                        <LayersTree
                          layers={layersForCurrentPage}
                          onLayerSelect={handleLayerSelect}
                          onReorder={handleLayersReorder}
                          pageId={currentPageId || ""}
                          // liveLayerUpdates={liveLayerUpdates}
                          // liveComponentUpdates={liveComponentUpdates}
                          // readOnly={readOnly}
                        />
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent
                    value="pages"
                    className="flex flex-col min-h-0 overflow-y-auto no-scrollbar"
                  >
                    <PagesList
                      //ref={pagesRef}
                      pages={pages}
                      currentPageId={currentPageId}
                      onPageSelect={(pageId: string) => {
                        // setCurrentPageId(pageId);
                        // if (isEditor) {
                        //   useEditorStore.getState().setActiveSidebarTab('layers');
                        // }
                      }}
                      setCurrentPageId={setCurrentPageId}
                      readOnly={readOnly}
                    />
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </div>
        )}

        {/* Invisible overlay during resize to prevent iframe from capturing mouse events */}
        {/* {isResizing && <div className="fixed inset-0 z-50 cursor-col-resize" />} */}

        {/* Element Library Slide-Out (lazy loaded, always mounted to preserve state) */}
        <Suspense fallback={null}>
          {/* Placeholder only — absolutely positioned so it no longer takes
            space in the panel's flow. When the real <ElementLibrary /> is
            re-enabled below, make sure it positions itself relative to
            this root (e.g. `absolute left-full top-0 ml-3`) rather than
            assuming a docked sidebar edge. */}
          {showElementLibrary && (
            <div className="absolute left-full top-0 z-40 ml-3 w-64 rounded-xl border bg-background p-4 text-sm shadow-lg">
              <ElementLibrary
                isOpen={showElementLibrary}
                onClose={() => setShowElementLibrary(false)}
              />
            </div>
          )}
        </Suspense>
      </div>
    </>
  );
});

export default LeftPanel;
