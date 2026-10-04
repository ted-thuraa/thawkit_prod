"use client";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Adapted from Ycode's PagesTree.tsx + its inner Page component
 * (github.com/ycode/ycode, MIT licensed). Ycode's version renders a real
 * FOLDER TREE (buildPageTree/flattenPageTree/rebuildPageTree), plus error
 * pages, CMS/dynamic pages, and publish/draft status badges — none of
 * which apply here:
 *   - Folders were evaluated and explicitly rejected for this project (see
 *     funnel-content-schema.ts's decision note on `pages.order`) — this
 *     project's pages are a flat, ordered list.
 *   - No error-page concept, no per-page CMS binding, no per-page
 *     publish/draft flag — see editor-actions.ts's file header: publishing
 *     works through `funnel_versions`, not a per-page toggle.
 *   - No live/collaborative broadcasting — see project scope decision.
 *
 * What's kept, matching Ycode's actual interaction pattern: dnd-kit
 * drag-to-reorder (swapped from Ycode's raw useDraggable/useDroppable to
 * @dnd-kit/sortable's SortableContext, since a flat list doesn't need
 * Ycode's above/below/inside drop-position math — that machinery exists
 * specifically for reparenting into folders), a hover-revealed row menu,
 * and a right-click context menu with the same actions (settings /
 * duplicate / delete).
 * ─────────────────────────────────────────────────────────────────────────
 */

import React, {
  Suspense,
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Icon, { type IconProps } from "@/components/ui/icon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import PagesTree from "./PagesTree";
// import PageSettingsPanel, {
//   PageSettingsPanelHandle,
// } from "./PageSettingsPanel";
import type { Page as PageData, PageSettings, PageType } from "@/types/funnel";
import { usePagesStore, isTempPageId } from "@/stores/editor/usePagesStore";
import { useEditorStore } from "@/stores/editor/useEditorStore";
import { useCollectionsStore } from "@/stores/editor/useCollectionsStore";
import { useCampaignEditorUrl } from "@/hooks/use-editor-url";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { findLayerById } from "@/lib/editor/layer-tree-utils";
import { DEFAULT_LAYER_ID } from "@/lib/editor/editor-url";
import {
  calculateNextOrder,
  generateUniqueSlug,
  getNextNumberFromNames,
  isHomepage,
} from "@/lib/page-utils";

export const PAGE_TYPE_LABEL: Record<PageData["pageType"], string> = {
  landing_page: "Landing",
  normal_page: "Regular",
  result_page: "Result",
};

const PAGE_TYPE_ICON: Record<PageData["pageType"], IconProps["name"]> = {
  landing_page: "homepage",
  normal_page: "page",
  result_page: "page",
};

export interface PagesContentHandle {
  checkAndCloseSettings: () => Promise<boolean>;
}

/**
 * Contract a page-settings panel implements so the list can ask it whether
 * leaving is safe (unsaved edits). Nothing mounts one yet — the panel is
 * deferred — so the ref stays null and the check passes.
 */
export interface PageSettingsGuardHandle {
  checkUnsavedChanges: () => Promise<boolean>;
}

interface PagesListProps {
  campaignId: string;
  /** Store data can be absent during the first client render. */
  pages?: PageData[] | null;
  currentPageId: string | null;
  /** Fired after a page was explicitly opened (double-click / "Open"). */
  onPageOpened?: (pageId: string) => void;
  readOnly?: boolean;
}

interface AddPageOptions {
  /** "normal_page" (default) or "result_page". Never "landing_page". */
  pageType?: Extract<PageType, "normal_page" | "result_page">;
  /** When set, creates a dynamic (CMS) page bound to this collection. */
  collectionId?: string;
}

interface PageRowProps {
  page: PageData;
  isActive: boolean;
  isMenuOpen: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onSettings: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMenuOpenChange: (open: boolean) => void;

  readOnly?: boolean;
}

const Page = React.memo(function Page({
  page,
  isActive,
  isMenuOpen,
  onSelect,
  onOpen,
  onSettings,
  onDuplicate,
  onDelete,
  onMenuOpenChange,
  readOnly,
}: PageRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: page.id,
    disabled: readOnly,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Only one page can render at "/" — the create menu already disables
  // creating a second landing page, but duplicating an existing one would
  // silently create a routing collision, so it's disabled here too.
  const canDuplicate = page.pageType !== "landing_page";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          {...attributes}
          {...(!readOnly ? listeners : {})}
          className={cn(
            "group relative flex items-center gap-2 h-8 rounded-lg px-2 text-left w-full select-none",
            !isDragging && "hover:bg-secondary/50",
            isActive
              ? "bg-primary text-primary-foreground hover:bg-primary"
              : "text-secondary-foreground/80 dark:text-muted-foreground",
            !readOnly && "cursor-grab active:cursor-grabbing",
          )}
          onClick={onSelect}
          onDoubleClick={onOpen}
        >
          <Icon
            name={PAGE_TYPE_ICON[page.pageType]}
            className={cn(
              "size-3 shrink-0",
              isActive ? "opacity-90" : "opacity-50",
            )}
          />
          <span className="flex-1 min-w-0 text-xs font-medium truncate">
            {page.name}
          </span>
          <span
            className={cn(
              "text-[10px] shrink-0",
              isActive ? "opacity-80" : "text-muted-foreground",
            )}
          >
            {PAGE_TYPE_LABEL[page.pageType]}
          </span>

          {!readOnly && (
            <div
              className={cn(
                "shrink-0",
                isMenuOpen
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100",
              )}
            >
              <DropdownMenu open={isMenuOpen} onOpenChange={onMenuOpenChange}>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="xs"
                    variant="ghost"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    className={cn("-mr-1", isActive && "hover:bg-primary/70")}
                    aria-label={`Page actions for ${page.name}`}
                  >
                    <Icon name="more" className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onSelect={onSettings}>
                    <Icon name="settings" className="size-3 opacity-60" />
                    Edit settings
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={onDuplicate}
                    disabled={!canDuplicate}
                  >
                    <Icon name="copy" className="size-3 opacity-60" />
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                    <Icon name="trash" className="size-3 opacity-60" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      {!readOnly && (
        <ContextMenuContent className="w-40">
          <ContextMenuItem onSelect={onSettings}>Edit settings</ContextMenuItem>
          <ContextMenuItem onSelect={onDuplicate} disabled={!canDuplicate}>
            Duplicate
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={onDelete}>
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
});

export default function PagesList({
  campaignId,
  pages,
  currentPageId,
  onPageOpened,
  readOnly = false,
}: PagesListProps) {
  const { navigateToNextPage } = useCampaignEditorUrl(campaignId);
  const collections = useCollectionsStore((s) => s.collections);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    currentPageId,
  );
  // Mirrors `selectedItemId` so async handlers (which outlive a render) can
  // check "is the user STILL selecting X?" without a stale closure.
  const selectedItemIdRef = useRef<string | null>(currentPageId);
  const currentPageIdRef = useRef<string | null>(currentPageId);
  // Page we have already asked the router to open — absorbs the repeat
  // `click` events of a double-click before the route has caught up.
  const pendingNavigationPageIdRef = useRef<string | null>(null);

  const [showPageSettings, setShowPageSettings] = useState(false);
  const pageSettingsPanelRef = useRef<PageSettingsGuardHandle | null>(null);
  const [, setEditingPage] = useState<PageData | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PageData | null>(null);

  const safePages = React.useMemo(
    () => (Array.isArray(pages) ? pages : []),
    [pages],
  );

  // Separate regular pages from result pages
  const { regularPages, resultPages } = React.useMemo(() => {
    const regular = safePages.filter((page) => page.pageType !== "result_page");
    const result = safePages.filter((page) => page.pageType === "result_page");
    return { regularPages: regular, resultPages: result };
  }, [safePages]);

  const selectTreeItem = useCallback((id: string | null) => {
    selectedItemIdRef.current = id;
    setSelectedItemId(id);
  }, []);

  // The route is the source of truth for the active page; when it changes
  // (click, back/forward, delete fallback…) the tree selection follows.
  // State is adjusted during render (React's "derive state from props"
  // pattern — no extra effect-driven render); refs are synced in the effect.
  const [prevCurrentPageId, setPrevCurrentPageId] = useState(currentPageId);
  if (currentPageId !== prevCurrentPageId) {
    setPrevCurrentPageId(currentPageId);
    if (currentPageId) setSelectedItemId(currentPageId);
  }
  useEffect(() => {
    currentPageIdRef.current = currentPageId;
    pendingNavigationPageIdRef.current = null;
    if (currentPageId) selectedItemIdRef.current = currentPageId;
  }, [currentPageId]);

  /**
   * Ask any open settings surface whether leaving the current selection is
   * safe. Page settings: delegate to the panel. Folder settings: not
   * applicable — this funnel's pages are a flat list with no folders.
   */
  const checkBeforeSelectionChange = useCallback(async (): Promise<boolean> => {
    if (showPageSettings) {
      const canProceed =
        await pageSettingsPanelRef.current?.checkUnsavedChanges();
      if (canProceed === false) return false;
    }
    return true;
  }, [showPageSettings]);

  // ─── Select ───────────────────────────────────────────────────────────
  // Clicking a page opens it on the canvas unless it is already active.
  // No data is fetched here: every page's layers are already in the store.
  const handlePageSelect = async (pageId: string): Promise<boolean> => {
    // 1. Unsaved-change guard — a rejection changes nothing at all.
    if (!(await checkBeforeSelectionChange())) return false;

    // A page that is still being created has no route yet: tree feedback only.
    if (isTempPageId(pageId)) {
      selectTreeItem(pageId);
      return true;
    }

    // 2. Already active (or already opening): never re-navigate or touch the
    //    canvas selection; just make sure the tree points back at it.
    if (
      pageId === currentPageIdRef.current ||
      pageId === pendingNavigationPageIdRef.current
    ) {
      if (selectedItemIdRef.current !== pageId) selectTreeItem(pageId);
      return true;
    }

    // 3. Reset the canvas selection to `body` and drop any text-style /
    //    sublayer / list-item sub-selection. (Also mirrors `layer=body` to
    //    the URL through the store's debounced helper.)
    useEditorStore.getState().selectLayerWithSublayer(DEFAULT_LAYER_ID, {
      textStyleKey: null,
      sublayerIndex: null,
      listItemIndex: null,
    });

    // 4. Immediate tree feedback.
    selectTreeItem(pageId);

    // 5. Navigate via the centralized helper (preserves view + right tab).
    //    The builder then updates `currentPageId` from the route and
    //    validates the layer against the new page's tree.
    pendingNavigationPageIdRef.current = pageId;
    startTransition(() => navigateToNextPage(pageId, DEFAULT_LAYER_ID));
    return true;
  };

  // ─── Add ──────────────────────────────────────────────────────────────
  // Creates a page right away (optimistically) and reconciles with the
  // server afterwards. If a collection ID is given this is a dynamic page.
  const handleAddPage = async ({
    pageType = "normal_page",
    collectionId,
  }: AddPageOptions = {}) => {
    if (readOnly) return;

    const allPages = usePagesStore.getState().pages;
    // `depth` is nullable in the schema; this flat list is all depth 0.
    const normalized = allPages.map((p) => ({ ...p, depth: p.depth ?? 0 }));

    // Folders don't exist in this funnel model → always root level.
    const newDepth = 0;

    // Display name only — slug uniqueness is handled separately below.
    const newPageName = `Page ${getNextNumberFromNames(allPages, "Page")}`;

    // Mixed order: right after the selected page, otherwise append.
    const newOrder = calculateNextOrder(
      null,
      newDepth,
      normalized,
      selectedItemIdRef.current,
    );

    // CMS metadata
    const settings: PageSettings = {};
    if (collectionId) {
      const fields = useCollectionsStore.getState().fields[collectionId] ?? [];
      const slugField = fields.find((field) => field.key === "slug");
      if (!slugField) {
        console.warn(
          `[PagesList] Collection "${collectionId}" has no slug field — not creating a dynamic page.`,
        );
        toast.error(
          "That collection has no slug field, so it can't drive a page.",
        );
        return;
      }
      // One dynamic page per funnel: its slug ("*") is unique.
      if (allPages.some((p) => p.isDynamic)) {
        toast.error("This funnel already has a dynamic page.");
        return;
      }
      settings.cms = {
        collection_id: collectionId,
        slug_field_id: slugField.id,
      };
    }

    // Client slug (the server re-validates and has the final say).
    const newPageSlug = collectionId
      ? "*"
      : generateUniqueSlug(newPageName, normalized, null, false);

    const started = usePagesStore.getState().createPage(campaignId, {
      name: newPageName,
      slug: newPageSlug,
      pageType,
      order: newOrder,
      isDynamic: Boolean(collectionId),
      settings,
    });
    if (!started.ok) {
      toast.error(started.error);
      return;
    }

    // Immediate feedback — the page is already in the store (the network
    // call below is NOT awaited by the UI).
    selectTreeItem(started.tempId);

    const outcome = await started.result;

    if (!outcome.success) {
      toast.error(outcome.error);
      // Creation rolled back; if the temp page was selected, fall back to
      // the page that is actually open.
      if (selectedItemIdRef.current === started.tempId) {
        selectTreeItem(currentPageIdRef.current);
      }
      return;
    }

    // Don't steal selection if the user moved on while this was in flight.
    if (selectedItemIdRef.current !== started.tempId) return;

    selectTreeItem(outcome.page.id);
    const currentLayerId = useEditorStore.getState().selectedLayerId;
    const layerId =
      currentLayerId && findLayerById(outcome.page.layers, currentLayerId)
        ? currentLayerId
        : DEFAULT_LAYER_ID;
    pendingNavigationPageIdRef.current = outcome.page.id;
    startTransition(() => navigateToNextPage(outcome.page.id, layerId));
  };

  // ─── Duplicate ────────────────────────────────────────────────────────
  // Tree selection only — the canvas deliberately stays on the open page.
  const handleDuplicate = async (id: string) => {
    if (readOnly) return;

    const started = usePagesStore.getState().duplicatePage(campaignId, id);
    if (!started.ok) {
      toast.error(started.error);
      return;
    }
    selectTreeItem(started.tempId);

    const outcome = await started.result;
    if (!outcome.success) {
      toast.error(outcome.error);
      if (selectedItemIdRef.current === started.tempId) {
        selectTreeItem(currentPageIdRef.current);
      }
      return;
    }

    if (selectedItemIdRef.current === started.tempId) {
      selectTreeItem(outcome.page.id);
    }
  };

  // ─── Delete ───────────────────────────────────────────────────────────
  const requestDelete = (id: string) => {
    if (readOnly || isTempPageId(id)) return;
    const target = usePagesStore.getState().pages.find((p) => p.id === id);
    if (!target || isHomepage(target)) return;
    setPendingDelete(target);
  };

  const executeDelete = async () => {
    if (!pendingDelete) return;
    const deletedId = pendingDelete.id;

    const outcome = await usePagesStore
      .getState()
      .deletePage(campaignId, deletedId);
    if (!outcome.success) {
      toast.error(outcome.error);
      return;
    }

    const { pages: latest, removePageLocal } = usePagesStore.getState();

    // Deleting a page that is NOT open: just drop it.
    if (useEditorStore.getState().currentPageId !== deletedId) {
      removePageLocal(deletedId);
      if (selectedItemIdRef.current === deletedId) {
        selectTreeItem(currentPageIdRef.current);
      }
      return;
    }

    // Deleting the OPEN page: move to its nearest neighbour first, through
    // the centralized helper, and only drop the page locally once the route
    // has left it (otherwise the builder would briefly resolve an unknown
    // page id and redirect on its own).
    const remaining = latest
      .filter((p) => p.id !== deletedId && !isTempPageId(p.id))
      .sort((a, b) => a.order - b.order);
    const before = remaining.filter((p) => p.order < pendingDelete.order);
    const fallback = before[before.length - 1] ?? remaining[0] ?? null;

    if (!fallback) {
      removePageLocal(deletedId);
      return;
    }

    selectTreeItem(fallback.id);
    pendingNavigationPageIdRef.current = fallback.id;
    startTransition(() => navigateToNextPage(fallback.id, DEFAULT_LAYER_ID));

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      unsubscribe();
      clearTimeout(failsafe);
      usePagesStore.getState().removePageLocal(deletedId);
    };
    const unsubscribe = useEditorStore.subscribe((state) => {
      if (state.currentPageId !== deletedId) finish();
    });
    const failsafe = setTimeout(finish, 3000);
  };

  const handleEditPage = async (page: PageData) => {
    // Same guard as selection: don't abandon unsaved settings silently.
    if (!(await checkBeforeSelectionChange())) return;

    selectTreeItem(page.id);
    setEditingPage(page);
    setShowPageSettings(true);
  };

  // Explicit "open": select the page, then let the parent switch tabs.
  const handlePageOpen = async (pageId: string) => {
    if (await handlePageSelect(pageId)) onPageOpened?.(pageId);
  };

  return (
    <>
      <header className="py-5 flex justify-between shrink-0 sticky top-0 bg-linear-to-b from-background to-transparent z-20">
        <span className="font-medium">Pages</span>
        {!readOnly && (
          <div className="-my-1">
            <DropdownMenu onOpenChange={setIsMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button size="xs" variant="secondary">
                  <Icon
                    name="plus"
                    className={`${isMenuOpen ? "rotate-45" : "rotate-0"} transition-transform duration-100`}
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                side="bottom"
                onCloseAutoFocus={(e) => e.preventDefault()}
                className="max-h-125 overflow-y-auto"
              >
                <DropdownMenuItem
                  onClick={() => handleAddPage({ pageType: "normal_page" })}
                >
                  <Icon name="page" className="size-3 opacity-60" />
                  Regular
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleAddPage({ pageType: "result_page" })}
                >
                  <Icon name="page" className="size-3 opacity-60" />
                  Result
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Icon name="dynamicPage" className="size-3 opacity-60" />
                    CMS
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {collections.length > 0 ? (
                      collections.map((collection) => (
                        <DropdownMenuItem
                          key={collection.id}
                          onClick={() =>
                            handleAddPage({ collectionId: collection.id })
                          }
                        >
                          <Icon name="database" className="size-3 opacity-60" />
                          {collection.name}
                        </DropdownMenuItem>
                      ))
                    ) : (
                      <DropdownMenuItem key="no-collections" disabled>
                        <Icon name="database" className="size-3 opacity-60" />
                        No collections yet
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                {/* Folders aren't part of this funnel's flat page model. */}
                <DropdownMenuItem disabled>
                  <Icon name="folder" className="size-3 opacity-60" />
                  Folder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </header>

      <div className="flex flex-col gap-3">
        <PagesTree
          pages={regularPages}
          selectedItemId={selectedItemId}
          currentPageId={currentPageId}
          onPageSelect={handlePageSelect}
          onPageOpen={handlePageOpen}
          onPageSettings={handleEditPage}
          onDuplicate={readOnly ? undefined : handleDuplicate}
          onDelete={readOnly ? undefined : requestDelete}
        />

        <div className="flex items-center gap-2 mt-2">
          <span className="text-xs text-muted-foreground font-medium">
            Result pages
          </span>
          <Separator className="flex-1" />
        </div>

        {/* Error pages tree */}
        {resultPages.length > 0 && (
          <PagesTree
            pages={resultPages}
            selectedItemId={selectedItemId}
            currentPageId={currentPageId}
            onPageSelect={handlePageSelect}
            onPageOpen={handlePageOpen}
            onPageSettings={handleEditPage}
          />
        )}
      </div>

      {/* Page settings panel (lazy loaded) — deferred; when it lands it
          implements `PageSettingsGuardHandle` and takes `pageSettingsPanelRef`. */}
      <Suspense fallback={null}>{null}</Suspense>

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete page"
        description={`Are you sure you want to delete "${pendingDelete?.name ?? "this page"}"? This action cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={executeDelete}
      />
    </>
  );
}
