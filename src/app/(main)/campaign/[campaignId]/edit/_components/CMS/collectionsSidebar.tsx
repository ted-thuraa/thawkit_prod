import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
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
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import Icon from "@/components/ui/icon";
import { InlineRenameInput } from "@/components/ui/inline-rename-input";
import { Spinner } from "@/components/ui/spinner";
import { useInlineRename } from "@/hooks/use-inline-rename";
import { useCampaignEditorUrl } from "@/hooks/use-editor-url";
import { getSampleCollectionOptions } from "@/lib/sample-collections";
import { cn } from "@/lib/utils";
import { useCollectionsStore } from "@/stores/editor/useCollectionsStore";
import { Collection } from "@/types/funnel";
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import React, { useState } from "react";
import { toast } from "sonner";
import DeleteCollectionDialog from "./DeleteCollectionDialog";

interface CollectionsSidebarProps {
  campaignId: string;
}

// Sortable collection item component for sidebar drag-and-drop reordering
interface SortableCollectionItemProps {
  collection: Collection;
  isSelected: boolean;
  isHovered: boolean;
  openDropdownId: string | null;
  isRenaming: boolean;
  renameValue: string;
  itemCount?: number;
  onRenameValueChange: (value: string) => void;
  onSelect: () => void;
  onDoubleClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onDropdownOpenChange: (open: boolean) => void;
  onRename: () => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onDelete: () => void;
}

function SortableCollectionItem({
  collection,
  isSelected,
  isHovered,
  openDropdownId,
  isRenaming,
  renameValue,
  itemCount,
  onRenameValueChange,
  onSelect,
  onDoubleClick,
  onMouseEnter,
  onMouseLeave,
  onDropdownOpenChange,
  onRename,
  onRenameSubmit,
  onRenameCancel,
  onDelete,
}: SortableCollectionItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: collection.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  if (isRenaming) {
    return (
      <div
        className={cn(
          "pl-3 pr-1.5 h-8 rounded-lg flex gap-2 items-center",
          isSelected ? "bg-primary text-primary-foreground" : "bg-secondary/50",
        )}
      >
        <Icon name="database" className="size-3 shrink-0" />
        <InlineRenameInput
          variant={isSelected ? "rename-selected" : "rename"}
          value={renameValue}
          onChange={onRenameValueChange}
          onSubmit={onRenameSubmit}
          onCancel={onRenameCancel}
        />
      </div>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          {...attributes}
          {...listeners}
          className={cn(
            "px-3 h-8 rounded-lg flex gap-2 items-center justify-between text-left w-full group cursor-grab active:cursor-grabbing",
            isSelected
              ? "bg-primary text-primary-foreground"
              : "hover:bg-secondary/50 text-secondary-foreground/80 dark:text-muted-foreground",
          )}
          onClick={onSelect}
          onDoubleClick={onDoubleClick}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        >
          <div className="flex gap-2 items-center min-w-0">
            <Icon name="database" className="size-3 shrink-0" />
            <span className="truncate">{collection.name}</span>
          </div>

          <div className="group-hover:opacity-100 opacity-0">
              <DropdownMenu
                open={openDropdownId === collection.id}
                onOpenChange={onDropdownOpenChange}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    size="xs"
                    variant={isSelected ? "default" : "ghost"}
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                    className="-mr-2"
                  >
                    <Icon name="more" className="size-3" />
                  </Button>
                </DropdownMenuTrigger>

                <DropdownMenuContent>
                  <DropdownMenuItem onClick={onRename}>Rename</DropdownMenuItem>
                  <DropdownMenuItem onClick={onDelete}>Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
          </div>

          <span className="block text-xs opacity-50 group-hover:hidden">
            {itemCount ?? collection.draft_items_count}
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onRename}>Rename</ContextMenuItem>
        <ContextMenuItem onClick={onDelete}>Delete</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

const CollectionsSidebar = React.memo(
  function CollectionsSidebar({ campaignId }: CollectionsSidebarProps) {
    const {
      cmsSection,
      collections,
      itemsTotalCount,
      setCmsSection,
      updateCollection,
      reorderCollections,
      createCollection,
      createSampleCollection,
    } = useCollectionsStore();
    const { urlState, navigateToCollection, navigateToCollections } =
      useCampaignEditorUrl(campaignId);

    // The URL is the single source of truth for the open collection.
    const activeCollectionId = urlState.cms.collectionId;

    const [hoveredCollectionId, setHoveredCollectionId] = useState<
      string | null
    >(null);
    const [collectionDropdownId, setCollectionDropdownId] = useState<
      string | null
    >(null);
    const [loadingSampleCollectionId, setLoadingSampleCollectionId] = useState<
      string | null
    >(null);
    const [isCreating, setIsCreating] = useState(false);

    // Delete-collection dialog (single owner: DeleteCollectionDialog)
    const [deleteCollectionDialogOpen, setDeleteCollectionDialogOpen] =
      useState(false);
    const [deleteCollectionId, setDeleteCollectionId] = useState<string | null>(
      null,
    );

    // Collection sidebar rename state
    const collectionRename = useInlineRename({
      onSubmit: async (id, name) => {
        try {
          await updateCollection(id, { name });
        } catch (error) {
          toast.error("Failed to rename collection", {
            description:
              error instanceof Error ? error.message : "Please try again.",
          });
        }
      },
    });
    // Collection drag and drop sensors
    const collectionSensors = useSensors(
      useSensor(PointerSensor, {
        activationConstraint: {
          distance: 5,
        },
      }),
    );

    const handleCollectionDragEnd = (event: DragEndEvent) => {
      const { active, over } = event;

      if (!over || active.id === over.id) {
        return;
      }

      const oldIndex = collections.findIndex((c) => c.id === active.id);
      const newIndex = collections.findIndex((c) => c.id === over.id);

      if (oldIndex === -1 || newIndex === -1) {
        return;
      }

      const newOrder = [...collections];
      const [movedItem] = newOrder.splice(oldIndex, 1);
      newOrder.splice(newIndex, 0, movedItem);

      reorderCollections(newOrder.map((c) => c.id)).catch((error) => {
        toast.error("Failed to reorder collections", {
          description:
            error instanceof Error ? error.message : "Please try again.",
        });
      });
    };

    const handleCollectionSelect = (collectionId: string) => {
      setCmsSection("collections");
      // Navigation only: the content editor derives the selected collection
      // from the URL and loads its data.
      navigateToCollection(collectionId);
    };

    const handleCollectionDoubleClick = (collection: {
      id: string;
      name: string;
    }) => {
      collectionRename.startRename(collection.id, collection.name);
    };

    const handleCollectionDelete = (collectionId: string) => {
      setDeleteCollectionId(collectionId);
      setDeleteCollectionDialogOpen(true);
    };

    const handleCreateCollection = async () => {
      if (isCreating) return;
      setIsCreating(true);
      try {
        const baseName = "Collection";
        let name = baseName;
        let counter = 1;
        while (collections.some((c) => c.name === name)) {
          name = `${baseName} ${counter}`;
          counter++;
        }
        const created = await createCollection({ name });
        setCmsSection("collections");
        navigateToCollection(created.id);
        collectionRename.startRename(created.id, created.name);
      } catch (error) {
        toast.error("Failed to create collection", {
          description:
            error instanceof Error ? error.message : "Please try again.",
        });
      } finally {
        setIsCreating(false);
      }
    };

    const handleCreateSampleCollection = async (sampleId: string) => {
      if (loadingSampleCollectionId) return;
      setLoadingSampleCollectionId(sampleId);
      try {
        const created = await createSampleCollection(sampleId);
        setCmsSection("collections");
        navigateToCollection(created.id);
      } catch (error) {
        toast.error("Failed to create sample collection", {
          description:
            error instanceof Error ? error.message : "Please try again.",
        });
      } finally {
        setLoadingSampleCollectionId(null);
      }
    };

    return (
      <div className="w-64 shrink-0 bg-background border-r flex flex-col overflow-hidden px-4">
        {/* Global variables - distinct site-wide section, set apart from collections */}
        <div className="py-4 shrink-0">
          <button
            type="button"
            //onClick={() => setCmsSection('globals')}
            className={cn(
              "px-3 h-8 rounded-lg flex gap-2 items-center text-left w-full",
              cmsSection === "globals"
                ? "bg-primary text-primary-foreground"
                : "hover:bg-secondary/50 text-secondary-foreground/80 dark:text-muted-foreground",
            )}
          >
            <Icon name="globe" className="size-3.5 shrink-0" />
            <span className="font-medium">Global variables</span>
          </button>
        </div>
        <div className="border-t -mx-4 shrink-0" />
        <header className="py-5 flex items-center justify-between shrink-0">
          <span className="font-medium">Collections</span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="xs"
                variant="secondary"
                disabled={isCreating || loadingSampleCollectionId !== null}
              >
                {isCreating || loadingSampleCollectionId !== null ? (
                  <Spinner className="size-3" />
                ) : (
                  <Icon name="plus" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleCreateCollection}>
                New collection
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Samples</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {getSampleCollectionOptions().map((option) => (
                    <DropdownMenuItem
                      key={option.id}
                      onClick={() => handleCreateSampleCollection(option.id)}
                    >
                      <Icon name="database" className="size-3 shrink-0" />
                      {option.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <div className="flex-1 overflow-y-auto no-scrollbar">
          <DndContext
            sensors={collectionSensors}
            collisionDetection={closestCenter}
            onDragEnd={handleCollectionDragEnd}
          >
            <SortableContext
              items={collections.map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col">
                {collections.map((collection) => (
                  <SortableCollectionItem
                    key={collection.id}
                    collection={collection}
                    isSelected={
                      cmsSection === "collections" &&
                      activeCollectionId === collection.id
                    }
                    isHovered={hoveredCollectionId === collection.id}
                    openDropdownId={collectionDropdownId}
                    isRenaming={collectionRename.renamingId === collection.id}
                    renameValue={collectionRename.renameValue}
                    itemCount={itemsTotalCount[collection.id]}
                    onRenameValueChange={collectionRename.setRenameValue}
                    onSelect={() => handleCollectionSelect(collection.id)}
                    onDoubleClick={() =>
                      handleCollectionDoubleClick(collection)
                    }
                    onMouseEnter={() => setHoveredCollectionId(collection.id)}
                    onMouseLeave={() => setHoveredCollectionId(null)}
                    onDropdownOpenChange={(open) =>
                      setCollectionDropdownId(open ? collection.id : null)
                    }
                    onRename={() => handleCollectionDoubleClick(collection)}
                    onRenameSubmit={collectionRename.submitRename}
                    onRenameCancel={collectionRename.cancelRename}
                    onDelete={() => handleCollectionDelete(collection.id)}
                  />
                ))}

                {collections.length === 0 && (
                  <Empty>
                    <EmptyTitle>Collections</EmptyTitle>
                    <EmptyDescription>
                      No collections yet. Click + to create new.
                    </EmptyDescription>
                  </Empty>
                )}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        <DeleteCollectionDialog
          collectionId={deleteCollectionId}
          open={deleteCollectionDialogOpen}
          onOpenChange={(open) => {
            setDeleteCollectionDialogOpen(open);
            if (!open) setTimeout(() => setDeleteCollectionId(null), 200);
          }}
          onDeleted={(id) => {
            if (activeCollectionId === id) {
              // Fall back to the bare CMS route; the content editor then
              // selects the first remaining collection.
              navigateToCollections({ replace: true });
            }
          }}
        />
      </div>
    );
  },
);

export default CollectionsSidebar;
