"use client";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Adapted from Ycode's PagesTree.tsx + its inner PageRow component
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

import React, { Suspense, useRef, useState } from "react";
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
import type { PageRow } from "@/lib/editor/resolve-editor-bootstrap";
import { Separator } from "@/components/ui/separator";
import PagesTree from "./PagesTree";
// import PageSettingsPanel, {
//   PageSettingsPanelHandle,
// } from "./PageSettingsPanel";
import { Page } from "@/types/funnel";

export const PAGE_TYPE_LABEL: Record<PageRow["pageType"], string> = {
  landing_page: "Landing",
  normal_page: "Regular",
  result_page: "Result",
};

const PAGE_TYPE_ICON: Record<PageRow["pageType"], IconProps["name"]> = {
  landing_page: "homepage",
  normal_page: "page",
  result_page: "page",
};

export interface PagesContentHandle {
  checkAndCloseSettings: () => Promise<boolean>;
}

interface PagesTreeProps {
  //ref: React.RefObject<PagesTreeHandle | null>;
  /** Store data can be absent during the first client render. */
  pages?: PageRow[] | null;
  currentPageId: string | null;
  onPageSelect: (pageId: string) => void;
  // onPageSettings: (pageId: string) => void;
  // onDuplicate: (pageId: string) => void;
  // onDelete: (pageId: string) => void;
  // onReorder: (orderedPageIds: string[]) => void;
  setCurrentPageId: (pageId: string | null) => void;
  readOnly?: boolean;
}

interface PageRowProps {
  page: PageRow;
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

const PageRow = React.memo(function PageRow({
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
  //ref,
  pages,
  currentPageId,
  onPageSelect,
  setCurrentPageId,
  readOnly = false,
}: PagesTreeProps) {
  const [openMenuPageId, setOpenMenuPageId] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    currentPageId,
  );
  const selectedItemIdRef = React.useRef<string | null>(currentPageId);
  const [showPageSettings, setShowPageSettings] = useState(false);
  //const pageSettingsPanelRef = useRef<PageSettingsPanelHandle>(null);
  const [editingPage, setEditingPage] = useState<Page | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const safePages = React.useMemo(
    () => (Array.isArray(pages) ? pages : []),
    [pages],
  );
  const sorted = [...safePages].sort((a, b) => a.order - b.order);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sorted.findIndex((p) => p.id === active.id);
    const newIndex = sorted.findIndex((p) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    //onReorder(arrayMove(sorted, oldIndex, newIndex).map((p) => p.id));
  };

  // Separate regular pages from error pages
  const { regularPages, resultPages } = React.useMemo(() => {
    const regular = safePages.filter((page) => page.pageType !== "result_page");
    const result = safePages
      .filter((page) => page.pageType === "result_page")
      .sort((a, b) => 0 - 0);
    return { regularPages: regular, resultPages: result };
  }, [safePages]);

  // Handler to create a new page (if a collection ID is given this will be a dynamic page)
  const handleAddPage = async (collectionId?: string) => {};

  // Handle page selection with unsaved changes check
  const handlePageSelect = async (pageId: string) => {};

  const handleEditPage = async (page: Page) => {
    // Check for unsaved changes before switching
    //const canProceed = await checkBeforeSelectionChange();
    // if (!canProceed) {
    //   return;
    // }

    setSelectedItemId(page.id);
    setEditingPage(page);
    setShowPageSettings(true);
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
                <DropdownMenuItem onClick={() => handleAddPage()}>
                  <Icon name="page" className="size-3 opacity-60" />
                  Regular
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Icon name="dynamicPage" className="size-3 opacity-60" />
                    CMS
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {/* {collections.length > 0 ? (
                      collections.map(collection => (
                        <DropdownMenuItem key={collection.id} onClick={() => handleAddPage(collection.id)}>
                          <Icon name="database" className="size-3 opacity-60" />
                          {collection.name}
                        </DropdownMenuItem>
                      ))
                    ) : (
                      <DropdownMenuItem key={null} onClick={() => navigateToCollections()}>
                        <Icon name="database" className="size-3 opacity-60" />
                        Add a collection
                      </DropdownMenuItem>
                    )} */}
                    <DropdownMenuItem key={null}>
                      <Icon name="database" className="size-3 opacity-60" />
                      Add a collection
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
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
          onPageOpen={(pageId) => {
            onPageSelect(pageId);
            setCurrentPageId(pageId);
            handlePageSelect(pageId); // This will also navigate
          }}
          onReorder={readOnly ? undefined : undefined}
          onPageSettings={handleEditPage}
          onDuplicate={readOnly ? undefined : undefined}
          onDelete={readOnly ? undefined : undefined}
          onStatusChange={readOnly ? undefined : undefined}
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
            onPageOpen={(pageId) => {
              onPageSelect(pageId);
              setCurrentPageId(pageId);
              handlePageSelect(pageId); // This will also navigate
            }}
            onPageSettings={handleEditPage}
          />
        )}
      </div>

      {/* Page settings panel (lazy loaded) */}
      <Suspense fallback={null}>
        {/* <PageSettingsPanel
          ref={pageSettingsPanelRef}
          isOpen={showPageSettings}
          onClose={() => {
            setShowPageSettings(false);
            setEditingPage(null);
          }}
          page={editingPage}
          //onSave={handleSavePage}
        /> */}
      </Suspense>

      {/* Delete confirmation dialog */}
      {/* <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={`Delete ${pendingDelete?.type === "folder" ? "folder" : "page"}`}
        description={
          pendingDelete?.type === "folder"
            ? `Are you sure you want to delete this folder and all pages inside it? This action cannot be undone.`
            : `Are you sure you want to delete this page? This action cannot be undone.`
        }
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={async () => {
          if (pendingDelete) {
            await executeDelete(pendingDelete.id, pendingDelete.type);
          }
        }}
      /> */}
    </>
  );
}
