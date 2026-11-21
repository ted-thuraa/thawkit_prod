import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import Icon from "@/components/ui/icon";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCampaignEditorUrl } from "@/hooks/use-editor-url";
import {
  getFieldIcon,
  findDisplayField,
  getItemDisplayName,
  isDateFieldType,
  isMultipleAssetField,
} from "@/lib/collection-field-utils";
import type { CollectionFieldUsageResult } from "@/lib/collection-usage-scan";
import { getSortParams, isTruthyBooleanValue } from "@/lib/collection-utils";
import { ASSET_CATEGORIES } from "@/lib/asset-constants";
import { getOptimizedImageUrl, isAssetOfType } from "@/lib/asset-utils";
import { formatDateInTimezone, formatDateOnly } from "@/lib/date-format-utils";
import { collectionsWriteApi } from "@/lib/editor/editor-collection-write-api";
import { collectionsReadApi } from "@/lib/editor/editor-read-api";
import {
  extractCrossCollectionItemIds,
  parseCollectionLinkValue,
  resolveCollectionLinkValue,
} from "@/lib/link-utils";
import { parseMultiAssetFieldValue } from "@/lib/multi-asset-utils";
import { extractPlainTextFromTiptap } from "@/lib/tiptap-utils";
import { cn } from "@/lib/utils";
import { useAssetsStore } from "@/stores/editor/useAssetsStore";
import { useCollectionLayerStore } from "@/stores/editor/useCollectionLayerStore";
import { useCollectionsStore } from "@/stores/editor/useCollectionsStore";
import { usePagesStore } from "@/stores/editor/usePagesStore";
import { useSettingsStore } from "@/stores/editor/useSettingsStore";
import { CollectionField, CollectionItemWithValues } from "@/types/funnel";
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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import FieldsDropdown from "../FieldsDropdown";
import CollectionItemSheet from "./CollectionItemSheet";
import { ReferenceFieldCell, SortableRow } from "./CmsTableParts";
import FieldFormDialog, { type FieldFormData } from "./FieldFormDialog";
import { FieldUsageSections } from "./UsageSections";
import {
  parseAnswerOptionsJson,
  resolveQuizSchema,
  toQuizRaw,
  validateQuizRaw,
  type QuizIssue,
} from "@/lib/quiz";

interface CmsContentEditorProps {
  campaignId: string;
}

const SEARCH_DEBOUNCE_MS = 300;

const CmsContentEditor = React.memo(
  function CmsContentEditor({ campaignId }: CmsContentEditorProps) {
    const {
      collections,
      fields,
      items,
      itemsTotalCount,
      isLoading,
      error: storeError,
      setSelectedCollectionId,
      loadFields,
      loadItems,
      deleteItem,
      deleteItems,
      duplicateItem,
      deleteField,
      updateField,
      createField,
      reorderFields,
      updateCollectionSorting,
      reorderItems,
      searchItems,
      reloadCurrentItems,
    } = useCollectionsStore();

    const {
      urlState,
      navigateToCollection,
      navigateToCollectionItem,
      navigateToNewCollectionItem,
    } = useCampaignEditorUrl(campaignId);

    const getAsset = useAssetsStore((state) => state.getAsset);
    // Page-link cells resolve against the funnel's pages. ThawKit has no page
    // folders (URLs are flat), hence the empty folder list.
    const pages = usePagesStore((state) => state.pages);
    const folders = useMemo(() => [], []);
    const timezone =
      useSettingsStore(
        (state) => state.settingsByKey.timezone as string | null,
      ) ?? "UTC";
    const refetchLayersForCollection = useCollectionLayerStore(
      (state) => state.refetchLayersForCollection,
    );
    const invalidateLayerData = useCollectionLayerStore(
      (state) => state.invalidateLayerData,
    );

    // ── Navigation state: the URL is the single source of truth ────────────
    // Which collection / item is open, the page, page size and the committed
    // search all come from the URL (lib/editor/cms-url.ts). Local state only
    // holds what the URL can't: the text box while typing, selections, dialogs.
    const cms = urlState.cms;
    const urlCollectionId = cms.collectionId;
    const currentPage = cms.page;
    const pageSize = cms.pageSize;
    const urlSearch = cms.search;

    // The URL may name a collection that doesn't exist (stale link, deleted in
    // another tab). Treat that as "nothing selected" and recover below.
    const selectedCollectionId =
      urlCollectionId && collections.some((c) => c.id === urlCollectionId)
        ? urlCollectionId
        : null;

    const [searchQuery, setSearchQuery] = useState(urlSearch);
    const lastPushedSearchRef = useRef(urlSearch);
    const [fieldSearchQuery, setFieldSearchQuery] = useState("");
    const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(
      new Set(),
    );
    const [fieldDialogOpen, setFieldDialogOpen] = useState(false);
    const [editingField, setEditingField] = useState<CollectionField | null>(
      null,
    );
    const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
    // Cache for reference item display names: { collectionId: { itemId: displayName } }
    const [referenceItemsCache, setReferenceItemsCache] = useState<
      Record<string, Record<string, string>>
    >({});

    // Confirm dialog state
    const [deleteItemDialogOpen, setDeleteItemDialogOpen] = useState(false);
    const [deleteItemId, setDeleteItemId] = useState<string | null>(null);
    const [deleteSelectedDialogOpen, setDeleteSelectedDialogOpen] =
      useState(false);
    const [deleteFieldDialogOpen, setDeleteFieldDialogOpen] = useState(false);
    const [deleteFieldId, setDeleteFieldId] = useState<string | null>(null);
    const [switchToManualDialogOpen, setSwitchToManualDialogOpen] =
      useState(false);
    const [pendingDragEvent, setPendingDragEvent] =
      useState<DragEndEvent | null>(null);

    // Usage check state for field-deletion protection
    const [fieldUsage, setFieldUsage] =
      useState<CollectionFieldUsageResult | null>(null);
    const [loadingFieldUsage, setLoadingFieldUsage] = useState(false);

    const selectedCollection = collections.find(
      (c) => c.id === selectedCollectionId,
    );
    const collectionFields = useMemo(
      () => (selectedCollectionId ? fields[selectedCollectionId] || [] : []),
      [selectedCollectionId, fields],
    );
    const collectionItems = useMemo(
      () => (selectedCollectionId ? items[selectedCollectionId] || [] : []),
      [selectedCollectionId, items],
    );
    const totalItems = selectedCollectionId
      ? itemsTotalCount[selectedCollectionId] || 0
      : 0;

    // Quiz collections: flag questions that don't satisfy the shared rules (e.g.
    // records created before a rule changed). Null schema ⇒ not a quiz ⇒ no work.
    const quizSchema = useMemo(
      () => resolveQuizSchema(collectionFields),
      [collectionFields],
    );
    const quizIssuesByItem = useMemo(() => {
      const map = new Map<string, QuizIssue[]>();
      if (!quizSchema) return map;
      for (const item of collectionItems) {
        const issues = validateQuizRaw(toQuizRaw(quizSchema, item.values), quizSchema);
        if (issues.length > 0) map.set(item.id, issues);
      }
      return map;
    }, [quizSchema, collectionItems]);

    // Items come pre-sorted from the API — no client-side sorting needed.
    // Manual order is the DB default; field sorting is handled server-side with global pagination.
    const sortedItems = collectionItems;

    // Check if we're in manual sort mode
    const isManualMode = selectedCollection?.sorting?.direction === "manual";
    const { sortBy: currentSortBy, sortOrder: currentSortOrder } =
      getSortParams(selectedCollection?.sorting);

    const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
    // Skeleton only while a collection's first page is loading — page / sort /
    // search reloads keep showing the current rows.
    const showSkeleton =
      isLoading && !!selectedCollectionId && collectionItems.length === 0 && !hasLoadedOnce;

    // ── URL helpers ─────────────────────────────────────────────────────────
    const setCurrentPage = useCallback(
      (page: number, replace = false) => {
        if (!selectedCollectionId) return;
        navigateToCollection(selectedCollectionId, { page, replace });
      },
      [selectedCollectionId, navigateToCollection],
    );

    const closeItemSheet = useCallback(() => {
      if (!selectedCollectionId) return;
      navigateToCollection(selectedCollectionId, { replace: true });
    }, [selectedCollectionId, navigateToCollection]);

    // ── Collection resolution ───────────────────────────────────────────────
    // Mirror the URL-derived selection into the store (other consumers, e.g.
    // reloadCurrentItems, read it there).
    useEffect(() => {
      setSelectedCollectionId(selectedCollectionId);
    }, [selectedCollectionId, setSelectedCollectionId]);

    // Bare /cms → open the first collection. /cms/<unknown> → say so, then fall
    // back to the first collection (or the bare route when there are none).
    useEffect(() => {
      if (selectedCollectionId) return;
      if (urlCollectionId) {
        toast.error("Collection not found", {
          description: "It may have been deleted.",
        });
      }
      if (collections.length > 0) {
        navigateToCollection(collections[0].id, { replace: true });
      }
    }, [selectedCollectionId, urlCollectionId, collections, navigateToCollection]);

    // Per-collection resets when the user switches collections.
    useEffect(() => {
      setSelectedItemIds(new Set());
      setFieldSearchQuery("");
      setReferenceItemsCache({});
      setHasLoadedOnce(false);
      setSearchQuery(urlSearch);
      lastPushedSearchRef.current = urlSearch;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCollectionId]);

    // Fields: load once per collection if the bootstrap didn't include them.
    useEffect(() => {
      if (!selectedCollectionId) return;
      if ((useCollectionsStore.getState().fields[selectedCollectionId] ?? []).length > 0) {
        return;
      }
      loadFields(selectedCollectionId).catch(() => {
        // surfaced through the store's `error` state below
      });
    }, [selectedCollectionId, loadFields]);

    // ── Search: local text box → URL (debounced) ────────────────────────────
    useEffect(() => {
      if (!selectedCollectionId) return;
      const next = searchQuery.trim();
      if (next === urlSearch) return;

      const timer = setTimeout(() => {
        lastPushedSearchRef.current = next;
        navigateToCollection(selectedCollectionId, {
          search: next,
          page: 1,
          replace: true,
        });
      }, SEARCH_DEBOUNCE_MS);
      return () => clearTimeout(timer);
    }, [searchQuery, urlSearch, selectedCollectionId, navigateToCollection]);

    // URL → local text box, for changes the user didn't type (back / forward).
    useEffect(() => {
      if (urlSearch === lastPushedSearchRef.current) return;
      lastPushedSearchRef.current = urlSearch;
      setSearchQuery(urlSearch);
    }, [urlSearch]);

    // ── Items: ONE effect loads whatever the URL + sort say should be shown ─
    const itemsHaveCountField = collectionFields.some((f) => f.type === "count");
    useEffect(() => {
      if (!selectedCollectionId) return;

      // Skip when the store already holds exactly this query (the editor's
      // bootstrap hydrates page 1 of every collection). `count` fields are
      // computed at fetch time and aren't invalidated by item changes elsewhere,
      // so they always re-fetch.
      const state = useCollectionsStore.getState();
      const last = state.lastItemsQuery[selectedCollectionId];
      const alreadyLoaded =
        !!state.items[selectedCollectionId] &&
        !!last &&
        (last.page ?? 1) === currentPage &&
        last.limit === pageSize &&
        (last.search ?? "") === urlSearch &&
        (last.sortBy ?? currentSortBy) === currentSortBy &&
        (last.sortOrder ?? currentSortOrder) === currentSortOrder &&
        !itemsHaveCountField;

      if (alreadyLoaded) {
        setHasLoadedOnce(true);
        return;
      }

      const request = urlSearch
        ? searchItems(
            selectedCollectionId,
            urlSearch,
            currentPage,
            pageSize,
            currentSortBy,
            currentSortOrder,
          )
        : loadItems(
            selectedCollectionId,
            currentPage,
            pageSize,
            currentSortBy,
            currentSortOrder,
          );
      request
        .catch(() => {
          // surfaced through the store's `error` state below
        })
        .finally(() => setHasLoadedOnce(true));
    }, [
      selectedCollectionId,
      currentPage,
      pageSize,
      urlSearch,
      currentSortBy,
      currentSortOrder,
      itemsHaveCountField,
      loadItems,
      searchItems,
    ]);

    // A page past the end (rows deleted, stale link): jump to the last valid page.
    useEffect(() => {
      if (!selectedCollectionId || isLoading || !hasLoadedOnce) return;
      if (collectionItems.length === 0 && totalItems > 0 && currentPage > 1) {
        const lastValidPage = Math.max(1, Math.ceil(totalItems / pageSize));
        if (currentPage > lastValidPage) setCurrentPage(lastValidPage, true);
      }
    }, [
      selectedCollectionId,
      isLoading,
      hasLoadedOnce,
      collectionItems.length,
      totalItems,
      currentPage,
      pageSize,
      setCurrentPage,
    ]);

    // Selection can only refer to rows that are on screen.
    useEffect(() => {
      setSelectedItemIds((prev) => {
        if (prev.size === 0) return prev;
        const visible = new Set(collectionItems.map((i) => i.id));
        const next = new Set([...prev].filter((id) => visible.has(id)));
        return next.size === prev.size ? prev : next;
      });
    }, [collectionItems]);

    // Debounced field search - queries backend (only when the user types)
    useEffect(() => {
      if (!selectedCollectionId || !fieldSearchQuery) return;
      const debounceTimer = setTimeout(() => {
        loadFields(selectedCollectionId, fieldSearchQuery).catch(() => {});
      }, 300);
      return () => clearTimeout(debounceTimer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fieldSearchQuery]);

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
    // currently displayed items but missing from `allCollectionItemSlugs`.
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

    // Fetch referenced item display names for reference fields in the list
    const fetchedReferenceCollections = useRef<Set<string>>(new Set());
    useEffect(() => {
      fetchedReferenceCollections.current.clear();
    }, [selectedCollectionId]);

    useEffect(() => {
      if (
        !selectedCollectionId ||
        !collectionItems.length ||
        !collectionFields.length
      )
        return;

      const collectionsToFetch = new Set<string>();
      collectionFields.forEach((field) => {
        if (
          (field.type === "reference" || field.type === "multi_reference") &&
          field.reference_collection_id &&
          !fetchedReferenceCollections.current.has(field.reference_collection_id)
        ) {
          collectionsToFetch.add(field.reference_collection_id);
        }
      });
      if (collectionsToFetch.size === 0) return;

      let cancelled = false;
      const fetchReferencedItems = async () => {
        const newCache: Record<string, Record<string, string>> = {};

        for (const collectionId of collectionsToFetch) {
          fetchedReferenceCollections.current.add(collectionId);
          const response = await collectionsReadApi.getItems(collectionId, {
            limit: 100,
          });
          if (response.error || !response.data?.items) continue;

          const displayField = findDisplayField(fields[collectionId] || []);
          newCache[collectionId] = {};
          response.data.items.forEach((item) => {
            newCache[collectionId][item.id] = getItemDisplayName(
              item,
              displayField,
            );
          });
        }

        if (!cancelled && Object.keys(newCache).length > 0) {
          setReferenceItemsCache((prev) => ({ ...prev, ...newCache }));
        }
      };

      fetchReferencedItems();
      return () => {
        cancelled = true;
      };
    }, [selectedCollectionId, collectionItems.length, collectionFields, fields]);

    // Drag and drop sensors
    const sensors = useSensors(
      useSensor(PointerSensor, {
        activationConstraint: {
          distance: 8, // Require 8px movement before drag starts
        },
      }),
    );

    // ── Item actions ────────────────────────────────────────────────────────
    const refreshAfterItemChange = useCallback(
      (collectionId: string) => {
        invalidateLayerData(collectionId);
        refetchLayersForCollection(collectionId);
      },
      [invalidateLayerData, refetchLayersForCollection],
    );

    const handleCreateItem = () => {
      if (selectedCollectionId) navigateToNewCollectionItem(selectedCollectionId);
    };

    const handleEditItem = (item: CollectionItemWithValues) => {
      if (selectedCollectionId) {
        navigateToCollectionItem(selectedCollectionId, item.id);
      }
    };

    const handleDeleteItem = (itemId: string) => {
      if (!selectedCollectionId) return;
      setDeleteItemId(itemId);
      setDeleteItemDialogOpen(true);
    };

    const handleConfirmDeleteItem = async () => {
      if (!selectedCollectionId || !deleteItemId) return;
      const collectionId = selectedCollectionId;
      const itemId = deleteItemId;
      try {
        await deleteItem(collectionId, itemId);
        // The open edit sheet belongs to the item that no longer exists.
        if (urlState.cms.itemId === itemId) closeItemSheet();
        // Reload the current page to sync pagination and pull remaining items forward.
        await reloadCurrentItems();
        refreshAfterItemChange(collectionId);
      } catch (error) {
        toast.error("Failed to delete item", {
          description:
            error instanceof Error ? error.message : "Please try again.",
        });
        throw error; // keep the dialog open
      }
    };

    const handleDuplicateItem = async (itemId: string) => {
      if (!selectedCollectionId) return;
      try {
        await duplicateItem(selectedCollectionId, itemId);
        refreshAfterItemChange(selectedCollectionId);
      } catch (error) {
        toast.error("Failed to duplicate item", {
          description:
            error instanceof Error ? error.message : "Please try again.",
        });
      }
    };

    const handleColumnClick = async (fieldId: string) => {
      if (!selectedCollectionId || !selectedCollection) return;

      const currentSorting = selectedCollection.sorting;
      let newSorting;

      // Cycle through: manual → asc → desc → manual
      if (!currentSorting || currentSorting.field !== fieldId) {
        newSorting = { field: fieldId, direction: "manual" as const };
      } else if (currentSorting.direction === "manual") {
        newSorting = { field: fieldId, direction: "asc" as const };
      } else if (currentSorting.direction === "asc") {
        newSorting = { field: fieldId, direction: "desc" as const };
      } else {
        newSorting = { field: fieldId, direction: "manual" as const };
      }

      try {
        await updateCollectionSorting(selectedCollectionId, newSorting);
        // A different sort invalidates the current page position.
        if (currentPage > 1) setCurrentPage(1, true);
      } catch (error) {
        toast.error("Failed to update sorting", {
          description:
            error instanceof Error ? error.message : "Please try again.",
        });
      }
    };

    /**
     * Moves `activeId` to `overId`'s position among the visible rows and
     * persists it. The rows keep the SAME set of manual_order slots they
     * occupied (re-assigned in the new sequence) so the page stays consistent
     * with the pages before / after it — assigning 0..n on page 2 would wedge
     * its rows into page 1.
     */
    const performReorder = async (activeId: string, overId: string) => {
      if (!selectedCollectionId) return;
      const current =
        useCollectionsStore.getState().items[selectedCollectionId] ?? [];

      const oldIndex = current.findIndex((item) => item.id === activeId);
      const newIndex = current.findIndex((item) => item.id === overId);
      if (oldIndex === -1 || newIndex === -1) {
        toast.error("Couldn't reorder", {
          description: "That item is no longer on this page.",
        });
        return;
      }

      const reordered = [...current];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);

      const slots = current.map((item) => item.manual_order).sort((a, b) => a - b);
      const slotsAreUnique = new Set(slots).size === slots.length;
      const base = slots[0] ?? 0;
      const updates = reordered.map((item, index) => ({
        id: item.id,
        manual_order: slotsAreUnique ? slots[index] : base + index,
      }));

      try {
        await reorderItems(selectedCollectionId, updates);
        refreshAfterItemChange(selectedCollectionId);
      } catch (error) {
        toast.error("Failed to reorder items", {
          description:
            error instanceof Error ? error.message : "Please try again.",
        });
      }
    };

    const handleDragEnd = async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !selectedCollectionId) return;

      // Reordering only makes sense in manual order over the full list.
      if (!isManualMode || searchQuery) {
        setPendingDragEvent(event);
        setSwitchToManualDialogOpen(true);
        return;
      }

      await performReorder(String(active.id), String(over.id));
    };

    const handleConfirmSwitchToManual = async () => {
      const event = pendingDragEvent;
      setPendingDragEvent(null);
      if (!event?.over || !selectedCollectionId || !selectedCollection) return;

      try {
        await updateCollectionSorting(selectedCollectionId, {
          field: selectedCollection.sorting?.field ?? "manual_order",
          direction: "manual",
        });
        if (searchQuery || urlSearch) {
          setSearchQuery("");
          navigateToCollection(selectedCollectionId, {
            search: "",
            page: 1,
            replace: true,
          });
        }
        // The rows re-order / re-filter after the switch: wait for them, then
        // apply the move by item id against what is now on screen.
        await reloadCurrentItems();
        await performReorder(String(event.active.id), String(event.over.id));
      } catch (error) {
        toast.error("Failed to switch to manual order", {
          description:
            error instanceof Error ? error.message : "Please try again.",
        });
      }
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
        setSelectedItemIds(new Set());
      } else {
        setSelectedItemIds(new Set(sortedItems.map((item) => item.id)));
      }
    };

    const handleDeleteSelected = () => {
      if (!selectedCollectionId || selectedItemIds.size === 0) return;
      setDeleteSelectedDialogOpen(true);
    };

    const handleConfirmDeleteSelected = async () => {
      if (!selectedCollectionId || selectedItemIds.size === 0) return;
      const collectionId = selectedCollectionId;
      const ids = Array.from(selectedItemIds);

      try {
        await deleteItems(collectionId, ids);
        setSelectedItemIds(new Set());
        if (urlState.cms.itemId && ids.includes(urlState.cms.itemId)) {
          closeItemSheet();
        }
        await reloadCurrentItems();
        refreshAfterItemChange(collectionId);
      } catch (error) {
        toast.error("Failed to delete items", {
          description:
            error instanceof Error ? error.message : "Please try again.",
        });
        throw error; // keep the dialog open
      }
    };

    // ── Field actions ───────────────────────────────────────────────────────
    const handleEditFieldClick = (field: CollectionField) => {
      setEditingField(field);
      setFieldDialogOpen(true);
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

      const response = await collectionsWriteApi.getFieldUsage(fieldId);
      if (response.data) setFieldUsage(response.data);
      setLoadingFieldUsage(false);
    };

    const handleConfirmDeleteField = async () => {
      if (!selectedCollectionId || !deleteFieldId) return;

      // Block deletion if field is in use (the server re-checks)
      if (fieldUsage && fieldUsage.total > 0) return;

      try {
        await deleteField(selectedCollectionId, deleteFieldId);
      } catch (error) {
        toast.error("Failed to delete field", {
          description:
            error instanceof Error ? error.message : "Please try again.",
        });
        throw error; // keep the dialog open
      }
    };

    const handleToggleFieldVisibility = async (fieldId: string) => {
      if (!selectedCollectionId) return;

      const field = collectionFields.find((f) => f.id === fieldId);
      if (!field) return;

      try {
        await updateField(selectedCollectionId, fieldId, {
          hidden: !field.hidden,
        });
      } catch (error) {
        toast.error("Failed to update field", {
          description:
            error instanceof Error ? error.message : "Please try again.",
        });
      }
    };
    const handleHideField = handleToggleFieldVisibility;

    const handleDuplicateField = async (fieldId: string) => {
      if (!selectedCollectionId) return;

      const field = collectionFields.find((f) => f.id === fieldId);
      if (!field) return;

      try {
        await createField(selectedCollectionId, {
          name: `${field.name} (Copy)`,
          type: field.type,
          default: field.default,
          fillable: true,
          order: collectionFields.length,
          reference_collection_id: field.reference_collection_id,
          hidden: field.hidden,
          data: field.data,
        });
      } catch (error) {
        toast.error("Failed to duplicate field", {
          description:
            error instanceof Error ? error.message : "Please try again.",
        });
      }
    };

    const handleReorderFields = async (reorderedFields: CollectionField[]) => {
      if (!selectedCollectionId) return;

      try {
        await reorderFields(
          selectedCollectionId,
          reorderedFields.map((f) => f.id),
        );
      } catch (error) {
        toast.error("Failed to reorder fields", {
          description:
            error instanceof Error ? error.message : "Please try again.",
        });
      }
    };

    const handleFieldDialogSubmit = async (data: FieldFormData) => {
      if (!selectedCollectionId) return;

      try {
        if (editingField) {
          const mergedData = data.data
            ? { ...editingField.data, ...data.data }
            : editingField.data;

          // Detect option renames / removals and count re-targeting so the
          // item list is refreshed after the server propagates them.
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

          if (data.type === "count") {
            await reloadCurrentItems();
          }
        }

        setFieldDialogOpen(false);
        setEditingField(null);
      } catch (error) {
        // Keep the dialog open so the input isn't lost, and say what happened.
        toast.error("Failed to save field", {
          description:
            error instanceof Error ? error.message : "Please try again.",
        });
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
                              
                            </div>
                          </th>
                        );
                      })}
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
                                  className="h-4 bg-secondary/50 rounded-[6px] animate-pulse w-1/3"
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
                        isManualMode={isManualMode}
                        onEdit={() => handleEditItem(item)}
                        onDuplicate={() => handleDuplicateItem(item.id)}
                        onDelete={() => handleDeleteItem(item.id)}
                      >
                        <td
                          className="pl-5 pr-3 py-3 w-12"
                        >
                          <div className="flex">
                            <Checkbox
                              checked={selectedItemIds.has(item.id)}
                              onCheckedChange={() =>
                                handleToggleItemSelection(item.id)
                              }
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                        </td>
                        {collectionFields
                          .filter((f) => !f.hidden)
                          .map((field) => {
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
                                  >
                                    -
                                  </td>
                                );
                              }

                              return (
                                <td
                                  key={field.id}
                                  className="px-4"
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
                                  >
                                    -
                                  </td>
                                );
                              }

                              return (
                                <td
                                  key={field.id}
                                  className="px-4"
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
                                >
                                  <ReferenceFieldCell
                                    value={value}
                                    field={field}
                                    referenceItemsCache={referenceItemsCache}
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

                            // Quiz answer options - a count, never the raw JSON
                            if (field.type === "answer_options") {
                              const parsed = parseAnswerOptionsJson(value);
                              const count =
                                parsed.kind === "ok" ? parsed.items.length : 0;
                              return (
                                <td
                                  key={field.id}
                                  className="px-4 py-5 text-muted-foreground"
                                >
                                  <span className="line-clamp-1 truncate">
                                    {count > 0
                                      ? `${count} option${count !== 1 ? "s" : ""}`
                                      : "-"}
                                  </span>
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

                            const rowIssues =
                              field.key === "name"
                                ? quizIssuesByItem.get(item.id)
                                : undefined;

                            return (
                              <td
                                key={field.id}
                                className="px-4 py-5 text-muted-foreground"
                              >
                                {rowIssues ? (
                                  <span className="flex items-center gap-2 min-w-0">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span
                                          role="img"
                                          aria-label="This question has problems"
                                          data-testid="quiz-issue-marker"
                                          className="shrink-0 text-destructive"
                                        >
                                          <Icon name="info" className="size-3.5" />
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {rowIssues
                                          .slice(0, 3)
                                          .map((i) => i.message)
                                          .join(" ")}
                                      </TooltipContent>
                                    </Tooltip>
                                    <span className="line-clamp-1 truncate">
                                      {displayValue || "-"}
                                    </span>
                                  </span>
                                ) : (
                                  <span className="line-clamp-1 truncate">
                                    {displayValue || "-"}
                                  </span>
                                )}
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
      quizIssuesByItem,
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
                reloadCurrentItems().catch(() => {});
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

            <FieldsDropdown
              fields={collectionFields}
              searchQuery={fieldSearchQuery}
              onSearchChange={setFieldSearchQuery}
              onToggleVisibility={handleToggleFieldVisibility}
              onReorder={handleReorderFields}
            />

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
          {!selectedCollectionId ? (
            <div className="flex flex-col items-center justify-center gap-4 p-8 flex-1">
              {collections.length === 0 ? (
                <Empty>
                  <EmptyTitle>No collections</EmptyTitle>
                  <EmptyDescription>
                    Create a collection from the sidebar to start managing
                    content.
                  </EmptyDescription>
                </Empty>
              ) : (
                <Spinner />
              )}
            </div>
          ) : storeError &&
            !isLoading &&
            collectionItems.length === 0 &&
            collectionFields.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 p-8 flex-1">
              <Empty>
                <EmptyTitle>Couldn&apos;t load this collection</EmptyTitle>
                <EmptyDescription>{storeError}</EmptyDescription>
              </Empty>
              <Button
                variant="secondary"
                onClick={() => {
                  loadFields(selectedCollectionId).catch(() => {});
                  reloadCurrentItems().catch(() => {});
                }}
              >
                Try again
              </Button>
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

        {/* Sheet for Create/Edit Item — driven by the URL (?edit=<id> | ?new).
            Keyed by collection + item so switching items / collections always
            starts from fresh form state. Only mounted when open to avoid
            animation issues. */}
        {selectedCollectionId && (cms.itemId || cms.isCreatingItem) && (
          <CollectionItemSheet
            key={`${selectedCollectionId}:${cms.itemId ?? "new"}`}
            open={true}
            onOpenChange={(open) => {
              if (!open) closeItemSheet();
            }}
            collectionId={selectedCollectionId}
            itemId={cms.itemId}
            onSuccess={closeItemSheet}
            onDeleteItem={handleDeleteItem}
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
                    onValueChange={(value) => {
                      if (selectedCollectionId) {
                        navigateToCollection(selectedCollectionId, {
                          pageSize: Number(value),
                          page: 1,
                        });
                      }
                    }}
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
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1 || showSkeleton}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setCurrentPage(currentPage + 1)}
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
              <FieldUsageSections usage={fieldUsage} />
            </div>
          ) : (
            "Are you sure you want to delete this field? This will remove it from all items."
          )}
        </ConfirmDialog>
        <ConfirmDialog
          open={switchToManualDialogOpen}
          onOpenChange={(open) => {
            setSwitchToManualDialogOpen(open);
            if (!open) setPendingDragEvent(null);
          }}
          title="Switch to manual order?"
          description="Reordering items switches this collection to manual order and clears the search."
          confirmLabel="Switch and reorder"
          onConfirm={handleConfirmSwitchToManual}
        />
      </div>
    );
  },
);

export default CmsContentEditor;
