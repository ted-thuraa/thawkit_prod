import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { useInlineRename } from "@/hooks/use-inline-rename";
import { collectionsApi } from "@/lib/api";
import {
  CollectionFieldUsageResult,
  CollectionUsageResult,
} from "@/lib/collection-usage-utils";
import { getSampleCollectionOptions } from "@/lib/sample-collections";
import { cn } from "@/lib/utils";
import { useAssetsStore } from "@/stores/editor/useAssetsStore";
import { useCollectionsStore } from "@/stores/editor/useCollectionsStore";
import { useEditorStore } from "@/stores/editor/useEditorStore";
import { usePagesStore } from "@/stores/editor/usePagesStore";
import {
  Collection,
  CollectionField,
  CollectionItemWithValues,
} from "@/types/funnel";
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
import { Badge } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import FieldsDropdown from "../FieldsDropdown";
import {
  findDisplayField,
  findStatusFieldId,
  getItemDisplayName,
} from "@/lib/collection-field-utils";
import { extractCrossCollectionItemIds } from "@/lib/link-utils";
import { toast } from "sonner";
import { useCollectionLayerStore } from "@/stores/editor/useCollectionLayerStore";
import { Checkbox } from "@/components/ui/checkbox";
import CollectionItemSheet from "./CollectionItemSheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import FieldFormDialog from "./FieldFormDialog";

interface CmsContentEditorProps {}

const CmsContentEditor = React.memo(
  function CmsContentEditor({}: CmsContentEditorProps) {
    const {
      selectedCollectionId,
      setSelectedCollectionId,
      collections,
      fields,
      items,
      itemsTotalCount,
      isLoading,
      loadFields,
      loadItems,
      createItem,
      updateItem,
      deleteItem,
      duplicateItem,
      deleteField,
      updateField,
      createField,
      updateCollectionSorting,
      reorderItems,
      searchItems,
      createCollection,
      createSampleCollection,
      updateCollection,
      deleteCollection,
      reorderCollections,
      setItemPublishable,
      setItemStatus,
      reloadCurrentItems,
    } = useCollectionsStore();

    const getAsset = useAssetsStore((state) => state.getAsset);
    const pages = usePagesStore((state) => state.pages);
    const refetchLayersForCollection = useCollectionLayerStore(
      (state) => state.refetchLayersForCollection,
    );

    const invalidateLayerData = useCollectionLayerStore(
      (state) => state.invalidateLayerData,
    );

    // Track previous collection ID to prevent unnecessary reloads
    const prevCollectionIdRef = React.useRef<string | null>(null);

    const [searchQuery, setSearchQuery] = useState("");
    const [fieldSearchQuery, setFieldSearchQuery] = useState("");
    // Initialize from URL state to prevent overwriting URL params

    const [showItemSheet, setShowItemSheet] = useState(false);
    const [editingItem, setEditingItem] =
      useState<CollectionItemWithValues | null>(null);
    const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(
      new Set(),
    );
    const [fieldDialogOpen, setFieldDialogOpen] = useState(false);
    const [editingField, setEditingField] = useState<CollectionField | null>(
      null,
    );
    const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
    const [showSkeleton, setShowSkeleton] = useState(false);
    // Cache for reference item display names: { collectionId: { itemId: displayName } }
    const [referenceItemsCache, setReferenceItemsCache] = useState<
      Record<string, Record<string, string>>
    >({});

    const [hoveredCollectionId, setHoveredCollectionId] = useState<
      string | null
    >(null);
    const [collectionDropdownId, setCollectionDropdownId] = useState<
      string | null
    >(null);
    const [loadingSampleCollectionId, setLoadingSampleCollectionId] = useState<
      string | null
    >(null);

    // Confirm dialog state
    const [deleteItemDialogOpen, setDeleteItemDialogOpen] = useState(false);
    const [deleteItemId, setDeleteItemId] = useState<string | null>(null);
    const [deleteSelectedDialogOpen, setDeleteSelectedDialogOpen] =
      useState(false);
    const [deleteFieldDialogOpen, setDeleteFieldDialogOpen] = useState(false);
    const [deleteFieldId, setDeleteFieldId] = useState<string | null>(null);
    const [deleteCollectionDialogOpen, setDeleteCollectionDialogOpen] =
      useState(false);
    const [deleteCollectionId, setDeleteCollectionId] = useState<string | null>(
      null,
    );

    // Usage check state for deletion protection

    const selectedCollection = collections.find(
      (c) => c.id === selectedCollectionId,
    );
    const collectionFields = useMemo(
      () => (selectedCollectionId ? fields[selectedCollectionId] || [] : []),
      [selectedCollectionId, fields],
    );
    const statusFieldId = useMemo(
      () => findStatusFieldId(collectionFields),
      [collectionFields],
    );

    // Auto-select first collection when none is selected and collections are available
    useEffect(() => {
      if (!selectedCollectionId && collections.length > 0 && !isLoading) {
        setSelectedCollectionId(collections[0].id);
      }
    }, [selectedCollectionId, collections, isLoading, setSelectedCollectionId]);
    const collectionItems = useMemo(
      () => (selectedCollectionId ? items[selectedCollectionId] || [] : []),
      [selectedCollectionId, items],
    );
    const totalItems = selectedCollectionId
      ? itemsTotalCount[selectedCollectionId] || 0
      : 0;

    // Build slug map across ALL loaded collections for cross-collection link resolution
    const crossCollectionSlugs = useCollectionsStore(
      (state) => state.crossCollectionSlugs,
    );
    const loadMissingItemSlugs = useCollectionsStore(
      (state) => state.loadMissingItemSlugs,
    );

    const allCollectionItemSlugs = useMemo(() => {
      const slugs: Record<string, string> = {};
      for (const collectionId of Object.keys(items)) {
        const colFields = fields[collectionId] || [];
        const slugField = colFields.find((f) => f.key === "slug");
        if (!slugField) continue;
        for (const item of items[collectionId]) {
          const slugValue = item.values[slugField.id];
          if (slugValue) {
            slugs[item.id] = slugValue;
          }
        }
      }
      // Merge in slugs resolved for items not loaded in any collection
      // (cross-collection refs, or items on a different page of the current one).
      for (const [itemId, slug] of Object.entries(crossCollectionSlugs)) {
        if (slug && !slugs[itemId]) {
          slugs[itemId] = slug;
        }
      }
      return slugs;
    }, [items, fields, crossCollectionSlugs]);

    // Resolve slug values for collection items referenced by link fields in the
    // currently displayed items but missing from `allCollectionItemSlugs`. Without
    // this the Page-link column would render `/{slug}` placeholders until the
    // referenced collection happens to be loaded.
    useEffect(() => {
      if (!selectedCollectionId) return;
      const currentItems = items[selectedCollectionId];
      const currentFields = fields[selectedCollectionId];
      if (!currentItems?.length || !currentFields?.length) return;

      const linkFieldIds = currentFields
        .filter((f) => f.type === "link")
        .map((f) => f.id);
      if (linkFieldIds.length === 0) return;

      const missingIds = extractCrossCollectionItemIds(
        currentItems,
        linkFieldIds,
        allCollectionItemSlugs,
      ).filter((id) => !(id in crossCollectionSlugs));
      if (missingIds.length === 0) return;

      loadMissingItemSlugs(missingIds);
    }, [
      selectedCollectionId,
      items,
      fields,
      allCollectionItemSlugs,
      crossCollectionSlugs,
      loadMissingItemSlugs,
    ]);

    // Drag and drop sensors
    const sensors = useSensors(
      useSensor(PointerSensor, {
        activationConstraint: {
          distance: 8, // Require 8px movement before drag starts
        },
      }),
    );

    // Check if we're in manual sort mode
    const isManualMode = selectedCollection?.sorting?.direction === "manual";

    const { sortBy: currentSortBy, sortOrder: currentSortOrder } =
      getSortParams(selectedCollection?.sorting);

    // Only show skeleton on initial load when no items are cached for the collection.
    // For subsequent reloads (page change, sort, search), keep showing current data.
    useEffect(() => {
      const hasExistingItems = selectedCollectionId
        ? (items[selectedCollectionId]?.length ?? 0) > 0
        : false;

      if (isLoading && !hasExistingItems) {
        setShowSkeleton(true);
      } else {
        setShowSkeleton(false);
      }
    }, [isLoading, selectedCollectionId, items]);

    // Sync search and page from URL on collection change or URL change
    useEffect(() => {
      if (selectedCollectionId) {
        // Only update if collection changed or URL search/page/pageSize changed
        const urlSearch = urlState.search || "";
        const urlPage = urlState.page || 1;
        const urlPageSize = urlState.pageSize || 25;

        if (prevCollectionIdRef.current !== selectedCollectionId) {
          // Collection changed - use URL state or reset
          setSearchQuery(urlSearch);
          setCurrentPage(urlPage);
          setPageSize(urlPageSize);
        } else {
          // Same collection - sync with URL if different
          if (urlSearch !== searchQuery) {
            setSearchQuery(urlSearch);
          }
          if (urlPage !== currentPage) {
            setCurrentPage(urlPage);
          }
          if (urlPageSize !== pageSize) {
            setPageSize(urlPageSize);
          }
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      selectedCollectionId,
      urlState.search,
      urlState.page,
      urlState.pageSize,
    ]);

    // Update URL when search or page changes locally (debounced to prevent loops)
    const updateUrlTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
    useEffect(() => {
      if (!selectedCollectionId) return;

      // Clear any pending updates
      if (updateUrlTimeoutRef.current) {
        clearTimeout(updateUrlTimeoutRef.current);
      }

      // Debounce URL updates to prevent race conditions with URL sync
      updateUrlTimeoutRef.current = setTimeout(() => {
        const urlSearch = urlState.search || "";
        const urlPage = urlState.page || 1;
        const urlPageSize = urlState.pageSize || 25;

        // Only update URL if local state is different from URL state
        if (
          searchQuery !== urlSearch ||
          currentPage !== urlPage ||
          pageSize !== urlPageSize
        ) {
          navigateToCollection(
            selectedCollectionId,
            currentPage,
            searchQuery || undefined,
            pageSize,
          );
        }
      }, 100); // 100ms debounce

      return () => {
        if (updateUrlTimeoutRef.current) {
          clearTimeout(updateUrlTimeoutRef.current);
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchQuery, currentPage, pageSize, selectedCollectionId]);

    // Load fields and items when collection changes (not when just navigating within same collection)
    useEffect(() => {
      if (selectedCollectionId && !selectedCollectionId.startsWith("temp-")) {
        // Only reload if the collection actually changed
        if (prevCollectionIdRef.current !== selectedCollectionId) {
          // Check if items are already preloaded (from YCodeBuilderMain) using store.getState()
          const storeState = useCollectionsStore.getState();
          const existingItems = storeState.items[selectedCollectionId];
          const existingFields = storeState.fields[selectedCollectionId];
          const totalCount =
            storeState.itemsTotalCount[selectedCollectionId] || 0;

          // Only load fields if not already in store
          if (!existingFields || existingFields.length === 0) {
            loadFields(selectedCollectionId);
          }

          // Only load items if:
          // 1. No items in store, OR
          // 2. We're on page > 1 (need different page), OR
          // 3. We have fewer items than total AND fewer than what we're requesting, OR
          // 4. The collection has computed `count` fields — they read from another
          //    collection's references and aren't invalidated when the source items
          //    change, so we always re-fetch on switch to keep counts fresh.
          const initialPage = urlState.page || 1;
          const initialPageSize = urlState.pageSize || 25;
          const hasCountField = (existingFields || []).some(
            (f) => f.type === "count",
          );
          const needsLoad =
            !existingItems ||
            existingItems.length === 0 ||
            initialPage > 1 ||
            (existingItems.length < totalCount &&
              existingItems.length < initialPageSize) ||
            hasCountField;

          if (needsLoad) {
            loadItems(
              selectedCollectionId,
              initialPage,
              initialPageSize,
              currentSortBy,
              currentSortOrder,
            );
          }

          // Mark initial load as complete
          initialLoadCompleteRef.current = true;

          // Clear selections when switching collections
          setSelectedItemIds(new Set());
          setFieldSearchQuery("");

          // Update the ref to track current collection
          prevCollectionIdRef.current = selectedCollectionId;
        }
      } else {
        // Reset ref when no collection selected
        prevCollectionIdRef.current = null;
      }
    }, [
      selectedCollectionId,
      urlState.page,
      urlState.pageSize,
      loadFields,
      loadItems,
      currentSortBy,
      currentSortOrder,
    ]);

    // Debounced field search - queries backend (only when user types, not on collection change)
    useEffect(() => {
      if (!selectedCollectionId || !fieldSearchQuery) return;

      const debounceTimer = setTimeout(() => {
        loadFields(selectedCollectionId, fieldSearchQuery);
      }, 300); // 300ms debounce

      return () => clearTimeout(debounceTimer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fieldSearchQuery]); // Only trigger on search query change, not collection change

    // Track if initial load has completed for this collection
    const initialLoadCompleteRef = React.useRef(false);

    // Reset initial load flag when collection changes
    useEffect(() => {
      initialLoadCompleteRef.current = false;
    }, [selectedCollectionId]);

    // Mark initial load as complete after a short delay (after first effect runs)
    useEffect(() => {
      if (
        selectedCollectionId &&
        prevCollectionIdRef.current === selectedCollectionId
      ) {
        // Collection load effect has run, mark initial load complete after a tick
        const timer = setTimeout(() => {
          initialLoadCompleteRef.current = true;
        }, 50);
        return () => clearTimeout(timer);
      }
    }, [selectedCollectionId]);

    // Debounced search - queries backend with pagination (only when user types or changes page, not on collection change)
    useEffect(() => {
      if (!selectedCollectionId || selectedCollectionId.startsWith("temp-"))
        return;
      // Skip if initial load hasn't completed (first effect handles initial load)
      if (!initialLoadCompleteRef.current) return;

      const debounceTimer = setTimeout(() => {
        if (searchQuery.trim()) {
          searchItems(
            selectedCollectionId,
            searchQuery,
            currentPage,
            pageSize,
            currentSortBy,
            currentSortOrder,
          );
        } else {
          // If search is empty, reload all items
          loadItems(
            selectedCollectionId,
            currentPage,
            pageSize,
            currentSortBy,
            currentSortOrder,
          );
        }
      }, 300); // 300ms debounce

      return () => clearTimeout(debounceTimer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchQuery, currentPage, pageSize, currentSortBy, currentSortOrder]); // Trigger on search/pagination/sorting changes

    // Reset to page 1 when search query changes (only if user typed, not from URL sync)
    const prevSearchRef = React.useRef<string>("");
    useEffect(() => {
      // Only reset page if search changed from user input (not initial URL load)
      if (
        prevSearchRef.current !== searchQuery &&
        prevSearchRef.current !== ""
      ) {
        setCurrentPage(1);
      }
      prevSearchRef.current = searchQuery;
    }, [searchQuery]);

    // Reset to page 1 when sorting changes (only if user changed it, not on initial collection load)
    const prevSortingRef = React.useRef<
      { field?: string; direction?: string } | null | undefined
    >(undefined);
    useEffect(() => {
      // Only reset page if sorting changed from user input (not initial collection load)
      // Skip reset on first mount or when collection first loads (when prevSortingRef is undefined)
      if (
        prevSortingRef.current !== undefined &&
        prevSortingRef.current !== selectedCollection?.sorting
      ) {
        setCurrentPage(1);
      }
      prevSortingRef.current = selectedCollection?.sorting;
    }, [selectedCollection?.sorting]);

    // Reset to page 1 when page size changes (only if user changed it, not from URL sync)
    const prevPageSizeRef = React.useRef<number | null>(null);
    useEffect(() => {
      // Only reset page if pageSize changed from user input (not initial URL load)
      // Skip reset on first mount (when prevPageSizeRef is null)
      if (
        prevPageSizeRef.current !== null &&
        prevPageSizeRef.current !== pageSize
      ) {
        setCurrentPage(1);
      }
      prevPageSizeRef.current = pageSize;
    }, [pageSize]);

    // Auto-navigate to a valid page when current page becomes empty but items exist elsewhere
    useEffect(() => {
      // Only check after initial load completes and we're not loading
      if (!initialLoadCompleteRef.current || showSkeleton) return;
      if (!selectedCollectionId) return;

      // If current page is empty but there are items in the collection, go to last valid page
      if (collectionItems.length === 0 && totalItems > 0 && currentPage > 1) {
        const lastValidPage = Math.max(1, Math.ceil(totalItems / pageSize));
        if (currentPage > lastValidPage) {
          setCurrentPage(lastValidPage);
        }
      }
    }, [
      collectionItems.length,
      totalItems,
      currentPage,
      pageSize,
      selectedCollectionId,
      showSkeleton,
    ]);

    // Track fetched reference collections to prevent duplicate calls
    const fetchedReferenceCollections = React.useRef<Set<string>>(new Set());

    // Reset fetched collections when the selected collection changes
    useEffect(() => {
      fetchedReferenceCollections.current.clear();
      setReferenceItemsCache({});
    }, [selectedCollectionId]);

    // Fetch referenced item display names for reference fields in the list
    useEffect(() => {
      if (
        !selectedCollectionId ||
        !collectionItems.length ||
        !collectionFields.length
      )
        return;

      // Find reference/multi_reference fields that need data
      const refFields = collectionFields.filter(
        (f) =>
          (f.type === "reference" || f.type === "multi_reference") &&
          f.reference_collection_id,
      );

      if (refFields.length === 0) return;

      // Collect all referenced collection IDs that we haven't fetched yet
      const collectionsToFetch = new Set<string>();

      refFields.forEach((field) => {
        if (
          field.reference_collection_id &&
          !fetchedReferenceCollections.current.has(
            field.reference_collection_id,
          )
        ) {
          collectionsToFetch.add(field.reference_collection_id);
        }
      });

      if (collectionsToFetch.size === 0) return;

      // Fetch display names for each collection
      const fetchReferencedItems = async () => {
        const newCache: Record<string, Record<string, string>> = {};

        for (const collectionId of collectionsToFetch) {
          // Mark as fetched to prevent duplicate calls
          fetchedReferenceCollections.current.add(collectionId);

          try {
            // Fetch items from this collection
            const response = await collectionsApi.getItems(collectionId, {
              limit: 100,
            });
            if (response.error || !response.data?.items) continue;

            // Get the display field for this collection
            const refCollectionFields = fields[collectionId] || [];
            const displayField = findDisplayField(refCollectionFields);

            // Build cache entries for all items in the collection
            newCache[collectionId] = {};
            response.data.items.forEach((item) => {
              newCache[collectionId][item.id] = getItemDisplayName(
                item,
                displayField,
              );
            });
          } catch (error) {
            console.error(
              `Failed to fetch referenced items for collection ${collectionId}:`,
              error,
            );
          }
        }

        if (Object.keys(newCache).length > 0) {
          setReferenceItemsCache((prev) => ({ ...prev, ...newCache }));
        }
      };

      fetchReferencedItems();
    }, [
      selectedCollectionId,
      collectionItems.length,
      collectionFields,
      fields,
    ]);

    // Handle deep linking: open sheet from URL only on initial mount
    const initialUrlHandledRef = React.useRef(false);

    useEffect(() => {
      // Only run once on initial mount
      if (initialUrlHandledRef.current) return;
      if (!selectedCollectionId || collectionItems.length === 0) return;

      initialUrlHandledRef.current = true;

      if (urlState.itemId === "new") {
        setEditingItem(null);
        setShowItemSheet(true);
      } else if (urlState.itemId) {
        const item = collectionItems.find((i) => i.id === urlState.itemId);
        if (item) {
          setEditingItem(item);
          setShowItemSheet(true);
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCollectionId, collectionItems.length]);

    // Items come pre-sorted from the API — no client-side sorting needed.
    // Manual order is the DB default; field sorting is handled server-side with global pagination.
    const sortedItems = collectionItems;

    const handleCreateItem = () => {
      if (selectedCollectionId) {
        setEditingItem(null);
        setShowItemSheet(true);
        navigateToNewCollectionItem(selectedCollectionId);
      }
    };

    // Helper to detect temporary IDs (from optimistic creates)
    const isTempId = (id: string): boolean => {
      return id.startsWith("temp-") || id.startsWith("temp-dup-");
    };

    const handleEditItem = (item: CollectionItemWithValues) => {
      if (selectedCollectionId) {
        // Don't open items with temp IDs - they're still being saved
        if (isTempId(item.id)) {
          return;
        }

        setEditingItem(item);
        setShowItemSheet(true);
        navigateToCollectionItem(selectedCollectionId, item.id);
      }
    };

    const handleDeleteItem = (itemId: string) => {
      if (!selectedCollectionId) return;
      setDeleteItemId(itemId);
      setDeleteItemDialogOpen(true);
    };

    const handleConfirmDeleteItem = () => {
      if (!selectedCollectionId || !deleteItemId) return;

      // Fire and forget - store handles optimistic update & rollback
      deleteItem(selectedCollectionId, deleteItemId)
        .then(() => {
          // Reload current page to sync pagination and pull remaining items forward
          loadItems(
            selectedCollectionId,
            currentPage,
            pageSize,
            currentSortBy,
            currentSortOrder,
          );
          invalidateLayerData(selectedCollectionId);
        })
        .catch((error) => {
          console.error("Failed to delete item:", error);
          toast.error("Failed to delete item", {
            description: "The item has been restored.",
          });
        });
    };

    const handleSetItemStatus = useCallback(
      (itemId: string, action: "draft" | "stage" | "publish") => {
        if (!selectedCollectionId) return;

        setItemStatus(selectedCollectionId, itemId, action).catch((error) => {
          console.error("Failed to update item status:", error);
          toast.error("Failed to update item status", {
            description: "Please try again.",
          });
        });
      },
      [selectedCollectionId, setItemStatus],
    );

    const handleDuplicateItem = (itemId: string) => {
      if (!selectedCollectionId) return;

      // Fire and forget - store handles optimistic update & rollback
      duplicateItem(selectedCollectionId, itemId).catch((error) => {
        console.error("Failed to duplicate item:", error);
        toast.error("Failed to duplicate item", {
          description: "Please try again.",
        });
      });
    };

    const handleColumnClick = async (fieldId: string) => {
      if (!selectedCollectionId || !selectedCollection) return;

      const currentSorting = selectedCollection.sorting;
      let newSorting;

      // Cycle through: manual → asc → desc → manual
      if (!currentSorting || currentSorting.field !== fieldId) {
        // First click on this field - set to manual mode
        newSorting = { field: fieldId, direction: "manual" as const };
      } else if (currentSorting.direction === "manual") {
        // Second click - set to ASC
        newSorting = { field: fieldId, direction: "asc" as const };
      } else if (currentSorting.direction === "asc") {
        // Third click - set to DESC
        newSorting = { field: fieldId, direction: "desc" as const };
      } else {
        // Fourth click - back to manual mode
        newSorting = { field: fieldId, direction: "manual" as const };
      }

      try {
        await updateCollectionSorting(selectedCollectionId, newSorting);
      } catch (error) {
        console.error("Failed to update sorting:", error);
      }
    };

    // Extracted reorder logic for use in both direct reorder and after dialog confirmation
    const performReorder = async (event: DragEndEvent) => {
      const { active, over } = event;

      if (!over || !selectedCollectionId) return;

      const oldIndex = sortedItems.findIndex((item) => item.id === active.id);
      const newIndex = sortedItems.findIndex((item) => item.id === over.id);

      if (oldIndex === -1 || newIndex === -1) return;

      // Reorder the items array
      const reorderedItems = [...sortedItems];
      const [movedItem] = reorderedItems.splice(oldIndex, 1);
      reorderedItems.splice(newIndex, 0, movedItem);

      // Calculate new manual_order values for all affected items
      const updates = reorderedItems.map((item, index) => ({
        id: item.id,
        manual_order: index,
      }));

      try {
        await reorderItems(selectedCollectionId, updates);
        // Reset to page 1 after reordering to show the new order
        setCurrentPage(1);
        // Invalidate + refetch collection layers on the canvas to reflect new order
        invalidateLayerData(selectedCollectionId);
        refetchLayersForCollection(selectedCollectionId);
      } catch (error) {
        console.error("Failed to reorder items:", error);
      }
    };

    const handleDragEnd = async (event: DragEndEvent) => {
      const { active, over } = event;

      if (!over || active.id === over.id || !selectedCollectionId) {
        return;
      }

      // If not in manual mode OR search is active, show confirmation dialog
      if (searchQuery) {
        setPendingDragEvent(event);
        setSwitchToManualDialogOpen(true);
        return;
      }

      // Already in manual mode with no search - proceed with reorder
      await performReorder(event);
    };

    const handleToggleItemSelection = (itemId: string) => {
      const newSelected = new Set(selectedItemIds);
      if (newSelected.has(itemId)) {
        newSelected.delete(itemId);
      } else {
        newSelected.add(itemId);
      }
      setSelectedItemIds(newSelected);
    };

    const handleSelectAll = () => {
      if (selectedItemIds.size === sortedItems.length) {
        // Deselect all
        setSelectedItemIds(new Set());
      } else {
        // Select all
        setSelectedItemIds(new Set(sortedItems.map((item) => item.id)));
      }
    };

    const handleDeleteSelected = () => {
      if (!selectedCollectionId || selectedItemIds.size === 0) return;
      setDeleteSelectedDialogOpen(true);
    };

    const handleConfirmDeleteSelected = () => {
      if (!selectedCollectionId || selectedItemIds.size === 0) return;

      const count = selectedItemIds.size;
      const itemText = count === 1 ? "item" : "items";
      const itemIdsToDelete = Array.from(selectedItemIds);

      // Store items for potential rollback
      const storeState = useCollectionsStore.getState();
      const previousItems = storeState.items[selectedCollectionId] || [];
      const previousCount =
        storeState.itemsTotalCount[selectedCollectionId] || 0;
      const deletedItems = previousItems.filter((item) =>
        selectedItemIds.has(item.id),
      );

      // Optimistically remove items from store
      useCollectionsStore.setState((state) => ({
        items: {
          ...state.items,
          [selectedCollectionId]: (
            state.items[selectedCollectionId] || []
          ).filter((item) => !selectedItemIds.has(item.id)),
        },
        itemsTotalCount: {
          ...state.itemsTotalCount,
          [selectedCollectionId]: Math.max(
            0,
            (state.itemsTotalCount[selectedCollectionId] || 0) - count,
          ),
        },
      }));

      // Clear selections immediately
      setSelectedItemIds(new Set());

      // Fire and forget - handle errors with rollback
      collectionsApi
        .bulkDeleteItems(itemIdsToDelete)
        .then((response) => {
          if (response.error) {
            throw new Error(response.error);
          }

          // Show warning if some items failed
          if (response.data?.errors && response.data.errors.length > 0) {
            console.warn("Some items failed to delete:", response.data.errors);
            toast.error(
              `Deleted ${response.data.deleted} of ${count} ${itemText}`,
              {
                description: "Some items failed to delete.",
              },
            );
          }

          // Reload current page to sync pagination and pull remaining items forward
          loadItems(
            selectedCollectionId,
            currentPage,
            pageSize,
            currentSortBy,
            currentSortOrder,
          );
          invalidateLayerData(selectedCollectionId);
        })
        .catch((error) => {
          console.error("Failed to delete items:", error);
          // Rollback optimistic delete
          useCollectionsStore.setState((state) => ({
            items: {
              ...state.items,
              [selectedCollectionId]: [
                ...(state.items[selectedCollectionId] || []),
                ...deletedItems,
              ],
            },
            itemsTotalCount: {
              ...state.itemsTotalCount,
              [selectedCollectionId]: previousCount,
            },
          }));
          toast.error("Failed to delete items", {
            description: "The items have been restored.",
          });
        });
    };

    const handleDeleteField = async (fieldId: string) => {
      if (!selectedCollectionId) return;

      const field = collectionFields.find((f) => f.id === fieldId);
      if (field?.key) {
        toast.error("Cannot delete built-in fields");
        return;
      }

      setDeleteFieldId(fieldId);
      setFieldUsage(null);
      setLoadingFieldUsage(true);
      setDeleteFieldDialogOpen(true);

      try {
        const response = await collectionsApi.getFieldUsage(
          selectedCollectionId,
          fieldId,
        );
        if (response.data && !response.error) {
          setFieldUsage(response.data as CollectionFieldUsageResult);
        }
      } catch (error) {
        console.error("Failed to fetch field usage:", error);
      } finally {
        setLoadingFieldUsage(false);
      }
    };

    const handleConfirmDeleteField = async () => {
      if (!selectedCollectionId || !deleteFieldId) return;

      // Block deletion if field is in use
      if (fieldUsage && fieldUsage.total > 0) return;

      try {
        await deleteField(selectedCollectionId, deleteFieldId);
      } catch (error) {
        console.error("Failed to delete field:", error);
        throw error; // Re-throw so ConfirmDialog stays open
      }
    };

    const handleHideField = async (fieldId: string) => {
      if (!selectedCollectionId) return;

      const field = collectionFields.find((f) => f.id === fieldId);
      if (!field) return;

      try {
        await updateField(selectedCollectionId, fieldId, {
          hidden: !field.hidden,
        });
        // Reload fields to show updated state
        await loadFields(selectedCollectionId);
      } catch (error) {
        console.error("Failed to toggle field visibility:", error);
      }
    };

    const handleDuplicateField = async (fieldId: string) => {
      if (!selectedCollectionId) return;

      const field = collectionFields.find((f) => f.id === fieldId);
      if (!field) return;

      try {
        const newOrder = collectionFields.length;
        // Store adds field to local state optimistically
        await createField(selectedCollectionId, {
          name: `${field.name} (Copy)`,
          type: field.type,
          default: field.default,
          fillable: field.fillable,
          order: newOrder,
          reference_collection_id: field.reference_collection_id,
          hidden: field.hidden,
          data: field.data,
        });
        // No reload needed - store already updated local state optimistically
      } catch (error) {
        console.error("Failed to duplicate field:", error);
      }
    };

    const handleToggleFieldVisibility = async (fieldId: string) => {
      if (!selectedCollectionId) return;

      const field = collectionFields.find((f) => f.id === fieldId);
      if (!field) return;

      try {
        // Store updates field visibility optimistically
        await updateField(selectedCollectionId, fieldId, {
          hidden: !field.hidden,
        });
        // No reload needed - store already updated local state optimistically
      } catch (error) {
        console.error("Failed to toggle field visibility:", error);
      }
    };

    const handleReorderFields = async (reorderedFields: CollectionField[]) => {
      if (!selectedCollectionId) return;

      try {
        const fieldIds = reorderedFields.map((f) => f.id);
        await collectionsApi.reorderFields(selectedCollectionId, fieldIds);
        // Reload fields to show new order (reorder API doesn't return updated fields)
        await loadFields(selectedCollectionId);
      } catch (error) {
        console.error("Failed to reorder fields:", error);
      }
    };

    const handleFieldDialogSubmit = async (data: FieldFormData) => {
      if (!selectedCollectionId) return;

      try {
        if (editingField) {
          // Update existing field
          const mergedData = data.data
            ? { ...editingField.data, ...data.data }
            : editingField.data;

          // Detect option renames or removals so we refresh the item list
          // after the server propagates renames / clears removed values.
          const previousOptions = Array.isArray(editingField.data?.options)
            ? editingField.data.options
            : [];
          const nextOptions = Array.isArray(data.data?.options)
            ? data.data.options
            : [];
          const previousById = new Map(
            previousOptions.map((o) => [o.id, o.name]),
          );
          const nextIds = new Set(nextOptions.map((o) => o.id));
          const isOptionField = editingField.type === "option";
          const hasOptionRename =
            isOptionField &&
            nextOptions.some((next) => {
              const previousName = previousById.get(next.id);
              return (
                typeof previousName === "string" &&
                previousName.trim() !== next.name.trim()
              );
            });
          const hasOptionRemoval =
            isOptionField &&
            previousOptions.some((prev) => !nextIds.has(prev.id));

          const previousCountCfg = editingField.data?.count;
          const nextCountCfg = data.data?.count;
          const countConfigChanged =
            editingField.type === "count" &&
            (!!previousCountCfg !== !!nextCountCfg ||
              previousCountCfg?.collectionId !== nextCountCfg?.collectionId ||
              previousCountCfg?.fieldId !== nextCountCfg?.fieldId);

          await updateField(selectedCollectionId, editingField.id, {
            name: data.name,
            default: data.default || null,
            reference_collection_id: data.reference_collection_id,
            data: mergedData,
          });

          if (hasOptionRename || hasOptionRemoval || countConfigChanged) {
            await reloadCurrentItems();
          }
        } else {
          // Create new field
          await createField(selectedCollectionId, {
            name: data.name,
            type: data.type,
            default: data.default || null,
            order: collectionFields.length,
            fillable: true,
            key: null,
            hidden: false,
            reference_collection_id: data.reference_collection_id || null,
            data: data.data,
          });

          // Count fields are computed at fetch time. Reload so the column shows
          // real values immediately instead of the default 0 placeholder.
          if (data.type === "count") {
            await reloadCurrentItems();
          }
        }

        // Close dialog and reset
        setFieldDialogOpen(false);
        setEditingField(null);
      } catch (error) {
        console.error("Failed to save field:", error);
      }
    };

    // Memoize table to prevent unnecessary re-renders during navigation
    const tableContent = React.useMemo(() => {
      return (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sortedItems.map((item) => item.id)}
            strategy={verticalListSortingStrategy}
          >
            <div
              className={cn(
                "flex flex-col",
                sortedItems.length === 0 && "flex-1",
              )}
            >
              <table
                className={cn(
                  "border-0 whitespace-nowrap text-xs min-w-full align-top border-separate border-spacing-0 [&>tbody>tr>td]:border-b [&>tbody>tr>td]:max-w-56",
                  sortedItems.length === 0 && "flex-1",
                )}
              >
                <thead className="">
                  <tr className="">
                    <th className="pl-5 pr-3 py-5 text-left font-normal w-12 sticky top-0 z-10 bg-background border-b border-border">
                      <div className="flex">
                        <Checkbox
                          checked={
                            sortedItems.length > 0 &&
                            selectedItemIds.size === sortedItems.length
                          }
                          onCheckedChange={handleSelectAll}
                          disabled={showSkeleton}
                        />
                      </div>
                    </th>

                    {collectionFields
                      .filter((f) => !f.hidden)
                      .map((field) => {
                        const sorting = selectedCollection?.sorting;
                        const isActiveSort = sorting?.field === field.id;
                        const sortIcon =
                          isActiveSort && sorting
                            ? sorting.direction === "manual"
                              ? "M"
                              : sorting.direction === "asc"
                                ? "↑"
                                : "↓"
                            : null;

                        return (
                          <th
                            key={field.id}
                            className="px-4 py-5 text-left font-normal sticky top-0 z-20 bg-background border-b border-border"
                          >
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() =>
                                  !showSkeleton && handleColumnClick(field.id)
                                }
                                className="flex items-center gap-1 hover:opacity-50 cursor-pointer max-w-40"
                                style={{
                                  pointerEvents: showSkeleton ? "none" : "auto",
                                }}
                              >
                                <span className="truncate">{field.name}</span>
                                {sortIcon && (
                                  <span className="text-xs font-mono">
                                    {sortIcon}
                                  </span>
                                )}
                              </button>
                              {canManageSchema && (
                                <DropdownMenu
                                  open={openDropdownId === field.id}
                                  onOpenChange={(open) =>
                                    !showSkeleton &&
                                    setOpenDropdownId(open ? field.id : null)
                                  }
                                >
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      size="xs"
                                      variant="ghost"
                                      className="-my-2"
                                      disabled={showSkeleton}
                                    >
                                      <Icon name="more" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="start">
                                    <DropdownMenuItem
                                      onSelect={() =>
                                        handleEditFieldClick(field)
                                      }
                                      disabled={!!field.key}
                                    >
                                      Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() =>
                                        handleDuplicateField(field.id)
                                      }
                                      disabled={!!field.key}
                                    >
                                      Duplicate
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => handleHideField(field.id)}
                                      disabled={
                                        field.name.toLowerCase() === "name"
                                      }
                                    >
                                      {field.hidden ? "Show" : "Hide"}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() =>
                                        handleDeleteField(field.id)
                                      }
                                      disabled={!!field.key}
                                    >
                                      Delete
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                          </th>
                        );
                      })}
                    {canManageSchema && (
                      <th className="px-4 py-3 text-left font-medium text-sm w-24 sticky right-0 top-0 z-20 bg-background border-b border-border">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={showSkeleton}
                          onClick={() => {
                            setEditingField(null);
                            setFieldDialogOpen(true);
                          }}
                        >
                          <Icon name="plus" />
                          Add field
                        </Button>
                      </th>
                    )}
                    <th className="sticky top-0 z-10 bg-background border-b border-border" />
                  </tr>
                </thead>
                <tbody>
                  {showSkeleton && totalItems > 0 ? (
                    // Skeleton loading rows - show exact expected number
                    Array.from({ length: Math.min(pageSize, totalItems) }).map(
                      (_, index) => (
                        <tr key={`skeleton-${index}`}>
                          <td className="pl-5 pr-3 py-5 w-12">
                            <div className="w-4 h-4 bg-secondary rounded animate-pulse" />
                          </td>
                          {collectionFields
                            .filter((f) => !f.hidden)
                            .map((field) => (
                              <td key={field.id} className="px-4 py-5">
                                <div
                                  className={`h-4 bg-secondary/50 rounded-[6px] animate-pulse ${field.type === "status" ? "w-12" : "w-1/3"}`}
                                />
                              </td>
                            ))}
                          <td className="px-4 py-3"></td>
                        </tr>
                      ),
                    )
                  ) : showSkeleton ? null : sortedItems.length > 0 ? ( // No skeleton rows when totalItems is 0
                    sortedItems.map((item) => (
                      <SortableRow
                        key={item.id}
                        item={item}
                        isSaving={isTempId(item.id)}
                        isAiActive={aiActiveItemIds.includes(item.id)}
                        isManualMode={isManualMode}
                        isCollectionPublished={
                          selectedCollection?.has_published_version ?? false
                        }
                        statusValue={
                          statusFieldId
                            ? parseStatusValue(item.values[statusFieldId])
                            : null
                        }
                        onEdit={() => handleEditItem(item)}
                        onSetAsDraft={() =>
                          handleSetItemStatus(item.id, "draft")
                        }
                        onStageForPublish={() =>
                          handleSetItemStatus(item.id, "stage")
                        }
                        onSetAsPublished={() =>
                          handleSetItemStatus(item.id, "publish")
                        }
                        onDuplicate={() => handleDuplicateItem(item.id)}
                        onDelete={() => handleDeleteItem(item.id)}
                        lockInfo={getItemLockInfo(item.id)}
                      >
                        <td
                          className="pl-5 pr-3 py-3 w-12"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditItem(item);
                          }}
                        >
                          <div className="flex">
                            {isTempId(item.id) ? (
                              <Spinner className="size-4 opacity-50" />
                            ) : (
                              <Checkbox
                                checked={selectedItemIds.has(item.id)}
                                onCheckedChange={() =>
                                  handleToggleItemSelection(item.id)
                                }
                                onClick={(e) => e.stopPropagation()}
                              />
                            )}
                          </div>
                        </td>
                        {collectionFields
                          .filter((f) => !f.hidden)
                          .map((field) => {
                            if (field.type === "status") {
                              return (
                                <td
                                  key={field.id}
                                  className="px-4 py-5"
                                  onClick={() => handleEditItem(item)}
                                >
                                  <CollectionStatusPill
                                    statusValue={
                                      statusFieldId
                                        ? parseStatusValue(
                                            item.values[statusFieldId],
                                          )
                                        : null
                                    }
                                  />
                                </td>
                              );
                            }

                            const value = item.values[field.id];

                            // Format date fields in user's timezone
                            if (isDateFieldType(field.type) && value) {
                              const displayValue =
                                field.type === "date_only"
                                  ? formatDateOnly(value)
                                  : formatDateInTimezone(
                                      value,
                                      timezone,
                                      "display",
                                    );
                              return (
                                <td
                                  key={field.id}
                                  className="px-4 py-5 text-muted-foreground"
                                  onClick={() => handleEditItem(item)}
                                >
                                  <span className="line-clamp-1 truncate">
                                    {displayValue}
                                  </span>
                                </td>
                              );
                            }

                            // Image fields - show thumbnail (match file manager: SVG inline, raster via img + checkerboard)
                            if (field.type === "image" && value) {
                              const assetIds: string[] = isMultipleAssetField(
                                field,
                              )
                                ? parseMultiAssetFieldValue(value)
                                : [value as string];

                              if (assetIds.length === 0) {
                                return (
                                  <td
                                    key={field.id}
                                    className="px-4 py-5 text-muted-foreground"
                                    onClick={() => handleEditItem(item)}
                                  >
                                    -
                                  </td>
                                );
                              }

                              return (
                                <td
                                  key={field.id}
                                  className="px-4"
                                  onClick={() => handleEditItem(item)}
                                >
                                  <div className="flex items-center gap-1 -my-1.5">
                                    {assetIds
                                      .slice(0, 3)
                                      .map((assetId, idx) => {
                                        const asset = getAsset(assetId);
                                        const isSvgIcon =
                                          asset &&
                                          (!!asset.content ||
                                            (asset.mime_type &&
                                              isAssetOfType(
                                                asset.mime_type,
                                                ASSET_CATEGORIES.ICONS,
                                              )));
                                        const imageUrl =
                                          asset?.public_url ?? null;
                                        const showCheckerboard =
                                          asset && (isSvgIcon || !!imageUrl);

                                        return asset ? (
                                          <Tooltip
                                            key={assetId}
                                            disableHoverableContent
                                          >
                                            <TooltipTrigger asChild>
                                              <div className="relative size-8 rounded-[6px] overflow-hidden bg-secondary/30 inline-block">
                                                {showCheckerboard && (
                                                  <div className="absolute inset-0 opacity-10 bg-checkerboard" />
                                                )}
                                                {isSvgIcon && asset.content ? (
                                                  <div
                                                    data-icon
                                                    className="relative w-full h-full flex items-center justify-center p-1 pointer-events-none text-foreground z-10"
                                                    dangerouslySetInnerHTML={{
                                                      __html: asset.content,
                                                    }}
                                                  />
                                                ) : imageUrl ? (
                                                  <img
                                                    src={getOptimizedImageUrl(
                                                      imageUrl,
                                                    )}
                                                    alt={
                                                      asset.filename || "Image"
                                                    }
                                                    className="relative w-full h-full object-contain pointer-events-none z-10"
                                                    loading="lazy"
                                                  />
                                                ) : (
                                                  <div className="absolute inset-0 flex items-center justify-center z-10">
                                                    <Icon
                                                      name="image"
                                                      className="size-3.5 text-muted-foreground"
                                                    />
                                                  </div>
                                                )}
                                              </div>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                              <p>{asset.filename}</p>
                                            </TooltipContent>
                                          </Tooltip>
                                        ) : (
                                          <div
                                            key={idx}
                                            className="relative size-8 rounded-[6px] overflow-hidden bg-secondary/30 inline-block"
                                          >
                                            <div className="absolute inset-0 flex items-center justify-center z-10">
                                              <Icon
                                                name="image"
                                                className="size-3.5 text-muted-foreground"
                                              />
                                            </div>
                                          </div>
                                        );
                                      })}
                                    {assetIds.length > 3 && (
                                      <span className="text-xs text-muted-foreground line-clamp-1 truncate">
                                        +{assetIds.length - 3}
                                      </span>
                                    )}
                                  </div>
                                </td>
                              );
                            }

                            // Audio/Video/Document fields - show icon with filename in tooltip
                            if (
                              (field.type === "audio" ||
                                field.type === "video" ||
                                field.type === "document") &&
                              value
                            ) {
                              const assetIds: string[] = isMultipleAssetField(
                                field,
                              )
                                ? parseMultiAssetFieldValue(value)
                                : [value as string];

                              if (assetIds.length === 0) {
                                return (
                                  <td
                                    key={field.id}
                                    className="px-4 py-5 text-muted-foreground"
                                    onClick={() => handleEditItem(item)}
                                  >
                                    -
                                  </td>
                                );
                              }

                              return (
                                <td
                                  key={field.id}
                                  className="px-4"
                                  onClick={() => handleEditItem(item)}
                                >
                                  <div className="flex items-center gap-1 -my-1.5">
                                    {assetIds
                                      .slice(0, 3)
                                      .map((assetId, idx) => {
                                        const asset = getAsset(assetId);
                                        return asset ? (
                                          <Tooltip
                                            key={assetId}
                                            disableHoverableContent
                                          >
                                            <TooltipTrigger asChild>
                                              <div className="relative size-8 rounded-[6px] overflow-hidden bg-secondary/30 flex items-center justify-center">
                                                <Icon
                                                  name={getFieldIcon(
                                                    field.type,
                                                  )}
                                                  className="size-3.5 text-muted-foreground"
                                                />
                                              </div>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                              <p>{asset.filename}</p>
                                            </TooltipContent>
                                          </Tooltip>
                                        ) : (
                                          <div
                                            key={idx}
                                            className="relative size-8 rounded-[6px] overflow-hidden bg-secondary/30 flex items-center justify-center"
                                          >
                                            <Icon
                                              name={getFieldIcon(field.type)}
                                              className="size-3.5 text-muted-foreground"
                                            />
                                          </div>
                                        );
                                      })}
                                    {assetIds.length > 3 && (
                                      <span className="text-xs text-muted-foreground line-clamp-1 truncate">
                                        +{assetIds.length - 3}
                                      </span>
                                    )}
                                  </div>
                                </td>
                              );
                            }

                            // Reference and multi-reference fields
                            if (
                              (field.type === "reference" ||
                                field.type === "multi_reference") &&
                              field.reference_collection_id
                            ) {
                              return (
                                <td
                                  key={field.id}
                                  className="px-4 py-5 text-muted-foreground"
                                  onClick={() => handleEditItem(item)}
                                >
                                  <ReferenceFieldCell
                                    value={value}
                                    field={field}
                                    referenceItemsCache={referenceItemsCache}
                                    fields={fields}
                                  />
                                </td>
                              );
                            }

                            // Rich text fields - extract plain text and truncate
                            if (field.type === "rich_text") {
                              const plainText =
                                extractPlainTextFromTiptap(value);
                              return (
                                <td
                                  key={field.id}
                                  className="px-4 py-5 text-muted-foreground max-w-50"
                                  onClick={() => handleEditItem(item)}
                                >
                                  <span className="block truncate">
                                    {plainText || "-"}
                                  </span>
                                </td>
                              );
                            }

                            // Link fields - format for display
                            if (field.type === "link") {
                              let displayValue = "-";
                              let isAssetLink = false;
                              if (value) {
                                try {
                                  const linkValue =
                                    typeof value === "string"
                                      ? parseCollectionLinkValue(value)
                                      : value;
                                  if (linkValue) {
                                    if (
                                      linkValue.type === "asset" &&
                                      linkValue.asset?.id
                                    ) {
                                      const asset = getAsset(
                                        linkValue.asset.id,
                                      );
                                      displayValue =
                                        asset?.filename || linkValue.asset.id;
                                      isAssetLink = true;
                                    } else {
                                      const resolvedUrl =
                                        resolveCollectionLinkValue(linkValue, {
                                          pages,
                                          folders,
                                          collectionItemSlugs:
                                            allCollectionItemSlugs,
                                          isPreview: false,
                                          locale: undefined,
                                        });

                                      displayValue = resolvedUrl || "-";
                                    }
                                  }
                                } catch {
                                  displayValue = String(value);
                                }
                              }
                              return (
                                <td
                                  key={field.id}
                                  className="px-4 py-5 text-muted-foreground max-w-50"
                                  onClick={() => handleEditItem(item)}
                                >
                                  <span className="flex items-center gap-1.5 truncate">
                                    {isAssetLink && (
                                      <Icon
                                        name="paperclip"
                                        className="size-3 shrink-0"
                                      />
                                    )}
                                    <span className="truncate">
                                      {displayValue}
                                    </span>
                                  </span>
                                </td>
                              );
                            }

                            // Color fields - display as color swatch
                            if (field.type === "color" && value) {
                              return (
                                <td
                                  key={field.id}
                                  className="px-4 py-5 text-muted-foreground"
                                  onClick={() => handleEditItem(item)}
                                >
                                  <div className="flex items-center gap-2">
                                    <div
                                      className="size-5 rounded border border-white/10 shrink-0"
                                      style={{
                                        backgroundColor: value as string,
                                      }}
                                    />
                                    <span className="text-xs">{value}</span>
                                  </div>
                                </td>
                              );
                            }

                            // Boolean fields - display as readonly switch
                            if (field.type === "boolean") {
                              const isTrue = isTruthyBooleanValue(value);
                              return (
                                <td
                                  key={field.id}
                                  className="px-4 py-5"
                                  onClick={() => handleEditItem(item)}
                                >
                                  <div className="pointer-events-none">
                                    <Checkbox
                                      checked={isTrue}
                                      tabIndex={-1}
                                      aria-hidden="true"
                                    />
                                  </div>
                                </td>
                              );
                            }

                            // Option fields - display as Badge with the option name
                            if (field.type === "option") {
                              return (
                                <td
                                  key={field.id}
                                  className="px-4 py-5"
                                  onClick={() => handleEditItem(item)}
                                >
                                  {value ? (
                                    <Badge
                                      variant="secondary"
                                      className="font-normal"
                                    >
                                      <span className="line-clamp-1 truncate max-w-50">
                                        {value}
                                      </span>
                                    </Badge>
                                  ) : (
                                    <span className="text-muted-foreground">
                                      -
                                    </span>
                                  )}
                                </td>
                              );
                            }

                            // Count fields - computed numeric value, defaults to 0
                            if (field.type === "count") {
                              const numeric =
                                value != null && value !== "" ? value : "0";
                              return (
                                <td
                                  key={field.id}
                                  className="px-4 py-5 text-muted-foreground tabular-nums"
                                  onClick={() => handleEditItem(item)}
                                >
                                  <span className="line-clamp-1 truncate">
                                    {numeric}
                                  </span>
                                </td>
                              );
                            }

                            // Guard against non-primitive values (e.g. rich-text objects
                            // paired with a text field during a collection switch) that
                            // would crash React if rendered directly.
                            const displayValue =
                              typeof value === "object" && value !== null
                                ? extractPlainTextFromTiptap(value)
                                : value;

                            return (
                              <td
                                key={field.id}
                                className="px-4 py-5 text-muted-foreground"
                                onClick={() => handleEditItem(item)}
                              >
                                <span className="line-clamp-1 truncate">
                                  {displayValue || "-"}
                                </span>
                              </td>
                            );
                          })}
                        <td className="px-4 py-3"></td>
                      </SortableRow>
                    ))
                  ) : (
                    <tr className="group">
                      <td
                        colSpan={
                          collectionFields.filter((f) => !f.hidden).length + 3
                        }
                        className="px-4"
                      >
                        {searchQuery ? (
                          <div className="text-muted-foreground py-32 text-center">
                            No items found matching &quot;{searchQuery}&quot;
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center gap-4 py-32">
                            <Empty className="max-w-sm">
                              <EmptyTitle>No Items</EmptyTitle>
                              <EmptyDescription>
                                This collection has no items yet. Add your first
                                item to get started.
                              </EmptyDescription>
                            </Empty>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </SortableContext>
        </DndContext>
      );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      sortedItems,
      collectionFields,
      isManualMode,
      selectedItemIds,
      selectedCollection?.sorting,
      openDropdownId,
      fieldDialogOpen,
      searchQuery,
      statusFieldId,
      collectionItems.length,
      showSkeleton,
      totalItems,
      pageSize,
      handleSelectAll,
      handleColumnClick,
      handleEditFieldClick,
      handleDuplicateField,
      handleHideField,
      handleDeleteField,
      handleFieldDialogSubmit,
      handleDragEnd,
      handleSetItemStatus,
      handleDuplicateItem,
      handleDeleteItem,
      handleEditItem,
      handleToggleItemSelection,
      sensors,
    ]);

    return (
      <div className="flex-1 flex flex-col min-w-0">
        <div className="p-4 flex items-center justify-between border-b">
          <div className="flex items-center gap-1.5">
            <InputGroup className="w-full max-w-72">
              <InputGroupInput
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                disabled={showSkeleton}
              />
              <InputGroupAddon>
                <Icon name="search" className="size-3" />
              </InputGroupAddon>
            </InputGroup>
            <Button
              size="sm"
              variant="ghost"
              disabled={isLoading || showSkeleton}
              aria-label="Refresh items"
              onClick={() => {
                if (!selectedCollectionId) return;
                if (searchQuery.trim()) {
                  searchItems(
                    selectedCollectionId,
                    searchQuery,
                    currentPage,
                    pageSize,
                    currentSortBy,
                    currentSortOrder,
                  );
                } else {
                  loadItems(
                    selectedCollectionId,
                    currentPage,
                    pageSize,
                    currentSortBy,
                    currentSortOrder,
                  );
                }
              }}
            >
              <Icon
                name="refresh"
                className={cn(
                  "size-3",
                  isLoading && !showSkeleton && "animate-spin",
                )}
              />
            </Button>
          </div>

          <div className="flex gap-2">
            {selectedItemIds.size > 0 && (
              <Button
                size="sm"
                variant="destructive"
                onClick={handleDeleteSelected}
                disabled={showSkeleton}
              >
                Delete
                <Badge variant="secondary" className="text-[10px] px-1.5">
                  {selectedItemIds.size}
                </Badge>
              </Button>
            )}

            {/* {selectedCollectionId && (
            <AirtableSyncButton
              collectionId={selectedCollectionId}
              onSyncComplete={() => loadItems(selectedCollectionId, currentPage, pageSize, currentSortBy, currentSortOrder)}
            />
          )} */}

            <FieldsDropdown
              fields={collectionFields}
              searchQuery={fieldSearchQuery}
              onSearchChange={setFieldSearchQuery}
              onToggleVisibility={handleToggleFieldVisibility}
              onReorder={handleReorderFields}
            />

            {/* <Button
            size="sm"
            variant="ghost"
            onClick={() => setImportDialogOpen(true)}
            disabled={!selectedCollectionId || collectionFields.length === 0}
          >
            <Icon name="upload" />
            Import
          </Button> */}

            <Button
              size="sm"
              variant="secondary"
              onClick={handleCreateItem}
              disabled={collectionFields.length === 0 || showSkeleton}
            >
              <Icon name="plus" />
              New Item
            </Button>
          </div>
        </div>

        {/* Items Content */}
        <div className="flex-1 overflow-auto flex flex-col min-w-0">
          {loadingSampleCollectionId === selectedCollectionId ||
          selectedCollectionId?.startsWith("temp-") ? (
            <div className="flex flex-col items-center justify-center gap-4 p-8 flex-1">
              <Spinner />
              <span className="text-sm text-muted-foreground">
                Creating collection...
              </span>
            </div>
          ) : collectionFields.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 p-8">
              <Empty>
                <EmptyTitle>No Fields Defined</EmptyTitle>
                <EmptyDescription>
                  This collection has no fields. Add fields to start managing
                  items.
                </EmptyDescription>
              </Empty>

              <Button
                onClick={() => {
                  setEditingField(null);
                  setFieldDialogOpen(true);
                }}
              >
                <Icon name="plus" />
                Add Field
              </Button>
            </div>
          ) : (
            <>{tableContent}</>
          )}
        </div>

        {/* Add Item Button - outside scroll container so it's always visible */}
        {!showSkeleton &&
          collectionFields.length > 0 &&
          sortedItems.length > 1 && (
            <div
              className="group cursor-pointer border-t"
              onClick={handleCreateItem}
            >
              <div className="grid grid-flow-col text-muted-foreground group-hover:bg-secondary/50">
                <div className="px-4 py-4">
                  <Button size="xs" variant="ghost">
                    <Icon name="plus" />
                  </Button>
                </div>
              </div>
            </div>
          )}

        {/* Sheet for Create/Edit Item - only render when open to avoid animation issues */}
        {showItemSheet && (
          <CollectionItemSheet
            open={true}
            onOpenChange={(open) => {
              if (!open) {
                setShowItemSheet(false);
                setEditingItem(null);
                if (selectedCollectionId) {
                  navigateToCollection(
                    selectedCollectionId,
                    currentPage,
                    searchQuery || undefined,
                    pageSize,
                  );
                }
              }
            }}
            collectionId={selectedCollectionId!}
            itemId={editingItem?.id || null}
            onSuccess={() => {
              setShowItemSheet(false);
              setEditingItem(null);
              if (selectedCollectionId) {
                navigateToCollection(
                  selectedCollectionId,
                  currentPage,
                  searchQuery || undefined,
                  pageSize,
                );
              }
            }}
          />
        )}

        {/* Pagination Controls - outside scroll container so it's always visible at bottom */}
        {selectedCollectionId &&
          (showSkeleton ||
            sortedItems.length > 0 ||
            totalItems > 0 ||
            currentPage > 1) && (
            <div className="flex items-center justify-between px-4 py-4 border-t">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Show:</span>
                {showSkeleton ? (
                  <div className="w-20 h-8 bg-secondary/50 rounded-lg animate-pulse" />
                ) : (
                  <Select
                    value={pageSize.toString()}
                    onValueChange={(value) => setPageSize(Number(value))}
                    disabled={showSkeleton}
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="flex items-center gap-4">
                {showSkeleton ? (
                  <div className="h-4 w-48 bg-secondary/50 rounded-[6px] animate-pulse" />
                ) : totalItems === 0 ? (
                  <p className="text-xs text-muted-foreground">No results</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Showing {(currentPage - 1) * pageSize + 1} to{" "}
                    {Math.min(currentPage * pageSize, totalItems)} of{" "}
                    {totalItems} results
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1 || showSkeleton}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setCurrentPage((p) => p + 1)}
                  disabled={
                    currentPage * pageSize >= totalItems || showSkeleton
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          )}

        {/* Field Create/Edit Dialog */}
        <FieldFormDialog
          field={editingField}
          currentCollectionId={selectedCollectionId || undefined}
          onSubmit={handleFieldDialogSubmit}
          open={fieldDialogOpen}
          onOpenChange={(open) => {
            setFieldDialogOpen(open);
            if (!open) {
              setEditingField(null);
            }
          }}
        />

        {/* Confirm Dialogs */}
        <ConfirmDialog
          open={deleteItemDialogOpen}
          onOpenChange={(open) => {
            setDeleteItemDialogOpen(open);
            if (!open) setDeleteItemId(null);
          }}
          title="Delete item"
          description="Are you sure you want to delete this item?"
          confirmLabel="Delete"
          onConfirm={handleConfirmDeleteItem}
        />
        <ConfirmDialog
          open={deleteSelectedDialogOpen}
          onOpenChange={(open) => {
            setDeleteSelectedDialogOpen(open);
          }}
          title={`Delete ${selectedItemIds.size} item${selectedItemIds.size === 1 ? "" : "s"}`}
          description={`Are you sure you want to delete ${selectedItemIds.size} item${selectedItemIds.size === 1 ? "" : "s"}?`}
          confirmLabel="Delete"
          onConfirm={handleConfirmDeleteSelected}
        />
        <ConfirmDialog
          open={deleteFieldDialogOpen}
          onOpenChange={(open) => {
            setDeleteFieldDialogOpen(open);
            if (!open) {
              setTimeout(() => {
                setDeleteFieldId(null);
                setFieldUsage(null);
                setLoadingFieldUsage(false);
              }, 200);
            }
          }}
          title={
            fieldUsage && fieldUsage.total > 0 ? "Field in use" : "Delete field"
          }
          confirmLabel="Delete"
          confirmVariant="destructive"
          disableConfirm={
            loadingFieldUsage || (fieldUsage !== null && fieldUsage.total > 0)
          }
          onConfirm={handleConfirmDeleteField}
        >
          {loadingFieldUsage ? (
            <span className="flex items-center gap-2">
              <Spinner />
              Checking field usage...
            </span>
          ) : fieldUsage && fieldUsage.total > 0 ? (
            <div className="space-y-3">
              <p>
                This field cannot be deleted because it is still being used.
                Remove all references before deleting.
              </p>
              <div className="space-y-2 text-muted-foreground">
                {fieldUsage.pages.length > 0 && (
                  <div>
                    <div className="flex gap-1.5 font-medium text-muted-foreground mb-1">
                      <span className="text-foreground">
                        Page collection layers
                      </span>
                      <span>&mdash;</span>
                      <span>
                        {fieldUsage.pages.length} item
                        {fieldUsage.pages.length > 1 ? "s" : ""}
                      </span>
                    </div>
                    <ul className="list-disc list-inside space-y-0.5 ml-1">
                      {fieldUsage.pages.map((p) => (
                        <li key={p.id}>{p.name}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {fieldUsage.components.length > 0 && (
                  <div>
                    <div className="flex gap-1.5 font-medium text-muted-foreground mb-1">
                      <span className="text-foreground">Components</span>
                      <span>&mdash;</span>
                      <span>
                        {fieldUsage.components.length} item
                        {fieldUsage.components.length > 1 ? "s" : ""}
                      </span>
                    </div>
                    <ul className="list-disc list-inside space-y-0.5 ml-1">
                      {fieldUsage.components.map((c) => (
                        <li key={c.id}>{c.name}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ) : (
            "Are you sure you want to delete this field? This will remove it from all items."
          )}
        </ConfirmDialog>
        <ConfirmDialog
          open={deleteCollectionDialogOpen}
          onOpenChange={(open) => {
            setDeleteCollectionDialogOpen(open);
            if (!open) {
              setTimeout(() => {
                setDeleteCollectionId(null);
                setCollectionUsage(null);
                setLoadingCollectionUsage(false);
              }, 200);
            }
          }}
          title={
            collectionUsage && collectionUsage.total > 0
              ? "Collection in use"
              : "Delete collection"
          }
          confirmLabel="Delete"
          confirmVariant="destructive"
          disableConfirm={
            loadingCollectionUsage ||
            (collectionUsage !== null && collectionUsage.total > 0)
          }
          onConfirm={handleConfirmDeleteCollection}
        >
          {loadingCollectionUsage ? (
            <span className="flex items-center gap-2">
              <Spinner />
              Checking collection usage...
            </span>
          ) : collectionUsage && collectionUsage.total > 0 ? (
            <div className="space-y-3">
              <p>
                <span className="text-foreground">
                  {collections.find((c) => c.id === deleteCollectionId)?.name ??
                    "This collection"}
                </span>{" "}
                cannot be deleted because it is still being used. Remove all
                references before deleting.
              </p>
              <div className="space-y-2 text-muted-foreground">
                {collectionUsage.pages.length > 0 && (
                  <div>
                    <div className="flex gap-1.5 font-medium text-muted-foreground mb-1">
                      <span className="text-foreground">
                        Page collection layers
                      </span>
                      <span>&mdash;</span>
                      <span>
                        {collectionUsage.pages.length} item
                        {collectionUsage.pages.length > 1 ? "s" : ""}
                      </span>
                    </div>
                    <ul className="list-disc list-inside space-y-0.5 ml-1">
                      {collectionUsage.pages.map((p) => (
                        <li key={p.id}>{p.name}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {collectionUsage.components.length > 0 && (
                  <div>
                    <div className="flex gap-1.5 font-medium text-muted-foreground mb-1">
                      <span className="text-foreground">Components</span>
                      <span>&mdash;</span>
                      <span>
                        {collectionUsage.components.length} item
                        {collectionUsage.components.length > 1 ? "s" : ""}
                      </span>
                    </div>
                    <ul className="list-disc list-inside space-y-0.5 ml-1">
                      {collectionUsage.components.map((c) => (
                        <li key={c.id}>{c.name}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {collectionUsage.referenceFields.length > 0 && (
                  <div>
                    <div className="flex gap-1.5 font-medium text-muted-foreground mb-1">
                      <span className="text-foreground">Reference fields</span>
                      <span>&mdash;</span>
                      <span>
                        {collectionUsage.referenceFields.length} field
                        {collectionUsage.referenceFields.length > 1 ? "s" : ""}
                      </span>
                    </div>
                    <ul className="list-disc list-inside space-y-0.5 ml-1">
                      {collectionUsage.referenceFields.map((f) => (
                        <li key={f.id}>
                          Field &quot;{f.name}&quot; in &quot;{f.collectionName}
                          &quot;
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {collectionUsage.airtableConnections.length > 0 && (
                  <div>
                    <div className="flex gap-1.5 font-medium text-muted-foreground mb-1">
                      <span className="text-foreground">Airtable sync</span>
                      <span>&mdash;</span>
                      <span>
                        {collectionUsage.airtableConnections.length} connection
                        {collectionUsage.airtableConnections.length > 1
                          ? "s"
                          : ""}
                      </span>
                    </div>
                    <ul className="list-disc list-inside space-y-0.5 ml-1">
                      {collectionUsage.airtableConnections.map((c) => (
                        <li key={c.id}>{c.name}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p>
              Are you sure you want to delete &quot;
              {collections.find((c) => c.id === deleteCollectionId)?.name ??
                "this collection"}
              &quot;? This action cannot be undone.
            </p>
          )}
        </ConfirmDialog>
      </div>
    );
  },
);

export default CmsContentEditor;
