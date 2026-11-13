"use client";

/**
 * Collection Item Sheet
 *
 * Reusable sheet for creating/editing collection items.
 * Can be used from CMS page or triggered from builder canvas.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useForm } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Icon from "@/components/ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetActions,
} from "@/components/ui/sheet";
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
import RichTextEditor from "../RichTextEditor";
import RichTextEditorSheet from "../RichTextEditorSheet";
import { useCollectionsStore } from "@/stores/editor/useCollectionsStore";
import { useCollectionLayerStore } from "@/stores/editor/useCollectionLayerStore";
import { useEditorStore } from "@/stores/editor/useEditorStore";
import { useAssetsStore } from "@/stores/editor/useAssetsStore";
import { collectionsReadApi } from "@/lib/editor/editor-read-api";
import {
  slugify,
  normalizeBooleanValue,
  parseMultiReferenceValue,
} from "@/lib/collection-utils";
import { sanitizeSlug } from "@/lib/page-utils";
import {
  isAssetFieldType,
  isMultipleAssetField,
  getFileManagerCategory,
  getAssetFieldLabel,
  getAssetFieldTypeLabel,
  isValidAssetForField,
} from "@/lib/collection-field-utils";
import {
  formatDateInTimezone,
  localDatetimeToUTC,
  clampDateInputValue,
} from "@/lib/date-format-utils";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/editor/useSettingsStore";
import { toast } from "sonner";
import ReferenceFieldCombobox from "../ReferenceFieldCombobox";
import CollectionLinkFieldInput from "./CollectionLinkFieldInput";
import ColorFieldInput from "../ColorFieldInput";
import AssetFieldCard, { SortableAssetFieldCard } from "../AssetFieldCard";
import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import type { Asset, CollectionItemWithValues } from "@/types/funnel";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

interface CollectionItemSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collectionId: string;
  /** null / undefined = create a new item; a string = edit that existing item. */
  itemId?: string | null;
  /** Called after the item has been persisted (the sheet should close). */
  onSuccess?: () => void;
  /** Ask the host to delete the item being edited (it owns the confirm dialog). */
  onDeleteItem?: (itemId: string) => void;
}

export default function CollectionItemSheet({
  open,
  onOpenChange,
  collectionId,
  itemId,
  onSuccess,
  onDeleteItem,
}: CollectionItemSheetProps) {
  const { collections, fields, items, updateItem, createItem } =
    useCollectionsStore();
  const {
    updateItemInLayerData,
    invalidateLayerData,
    refetchLayersForCollection,
  } = useCollectionLayerStore();
  const openFileManager = useEditorStore((state) => state.openFileManager);
  const getAsset = useAssetsStore((state) => state.getAsset);
  const timezone =
    useSettingsStore(
      (state) => state.settingsByKey.timezone as string | null,
    ) ?? "UTC";

  // The item being edited. Resolved ONCE per (sheet open, collection, item id):
  // from the already-loaded page of items when present, otherwise fetched by id
  // (deep links / items on another page). Deliberately not re-derived on every
  // store refresh so a background reload can't reset the user's in-flight edits.
  const [editingItem, setEditingItem] =
    useState<CollectionItemWithValues | null>(null);
  const [itemLoadState, setItemLoadState] = useState<
    "idle" | "loading" | "missing"
  >("idle");
  const [isSaving, setIsSaving] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [expandedRichTextField, setExpandedRichTextField] = useState<
    string | null
  >(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const collection = collections.find((c) => c.id === collectionId);
  const collectionFields = useMemo(
    () => (collectionId ? fields[collectionId] || [] : []),
    [collectionId, fields],
  );
  const collectionItems = useMemo(
    () => (collectionId ? items[collectionId] || [] : []),
    [collectionId, items],
  );
  const collectionItemsRef = useRef(collectionItems);
  useEffect(() => {
    collectionItemsRef.current = collectionItems;
  }, [collectionItems]);

  // Find name and slug fields for validation (only if editable in the form)
  const nameField = useMemo(
    () => collectionFields.find((f) => f.key === "name" && f.fillable),
    [collectionFields],
  );

  const slugField = useMemo(
    () => collectionFields.find((f) => f.key === "slug" && f.fillable),
    [collectionFields],
  );

  // Fast client-side slug check against the loaded page of items. The server
  // re-checks against the WHOLE collection and is authoritative.
  const validateSlugUniqueness = useCallback(
    (value: string, fieldId: string) => {
      if (!value) return true; // Allow empty (other validation can handle required)
      const existingItem = collectionItems.find(
        (item) => item.values[fieldId] === value && item.id !== editingItem?.id,
      );
      return !existingItem;
    },
    [collectionItems, editingItem?.id],
  );

  const form = useForm();
  // Subscribe to isDirty at render level so react-hook-form tracks it
  const { isDirty } = form.formState;

  const isCreateMode = !itemId;

  // Resolve the item for edit mode.
  useEffect(() => {
    if (!open) return;

    if (!itemId) {
      setEditingItem(null);
      setItemLoadState("idle");
      return;
    }

    const loaded = collectionItemsRef.current.find((i) => i.id === itemId);
    if (loaded) {
      setEditingItem(loaded);
      setItemLoadState("idle");
      return;
    }

    let cancelled = false;
    setEditingItem(null);
    setItemLoadState("loading");
    collectionsReadApi.getItemById(collectionId, itemId).then((response) => {
      if (cancelled) return;
      if (response.data) {
        setEditingItem(response.data);
        setItemLoadState("idle");
      } else {
        setItemLoadState("missing");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, itemId, collectionId]);

  // An id that doesn't exist in this collection (stale link, deleted item):
  // tell the user and hand control back to the host instead of showing a
  // blank "Edit" form that could never save.
  useEffect(() => {
    if (itemLoadState !== "missing") return;
    toast.error("Item not found", {
      description: "It may have been deleted.",
    });
    onOpenChange(false);
  }, [itemLoadState, onOpenChange]);

  // Reset form when the item (or the collection's fields) change.
  useEffect(() => {
    const editableFields = collectionFields.filter((f) => f.fillable);

    if (editingItem) {
      const values: Record<string, unknown> = {};
      editableFields.forEach((field) => {
        let value: unknown = editingItem.values[field.id] ?? "";
        if (field.type === "boolean") {
          value = normalizeBooleanValue(value as string);
        }
        values[field.id] = value;
      });
      form.reset(values);
    } else {
      const defaultValues: Record<string, unknown> = {};
      editableFields.forEach((field) => {
        let value: unknown = field.default || "";
        if (field.type === "boolean") {
          value = normalizeBooleanValue(value as string);
        }
        defaultValues[field.id] = value;
      });
      form.reset(defaultValues);
    }
  }, [editingItem, collectionFields, form]);

  // Handle auto-focus on sheet open
  const handleOpenAutoFocus = useCallback(
    (e: Event) => {
      // Only focus name field when creating a new item
      if (!itemId && nameInputRef.current) {
        e.preventDefault(); // Prevent default focus behavior
        nameInputRef.current.focus();
      }
    },
    [itemId],
  );

  // Auto-fill slug field based on name field (debounced to avoid race conditions)
  useEffect(() => {
    if (!editingItem) {
      const nameField = collectionFields.find((f) => f.key === "name");
      const localSlugField = collectionFields.find((f) => f.key === "slug");

      if (nameField && localSlugField) {
        let timeoutId: NodeJS.Timeout | null = null;

        const subscription = form.watch((value, { name }) => {
          if (name === nameField.id) {
            // Clear any pending timeout
            if (timeoutId) {
              clearTimeout(timeoutId);
            }

            // Debounce the slug update to ensure we have the latest value
            timeoutId = setTimeout(() => {
              const nameValue = form.getValues(nameField.id);
              if (nameValue && typeof nameValue === "string") {
                const slugValue = slugify(nameValue);
                form.setValue(localSlugField.id, slugValue);
              }
            }, 50);
          }
        });

        return () => {
          subscription.unsubscribe();
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
        };
      }
    }
  }, [form, editingItem, collectionFields]);

  const handleSubmit = async (values: Record<string, any>) => {
    if (!collectionId || isSaving) return;
    // Edit mode but the item hasn't loaded (or was lost): never fall through
    // to a create.
    if (itemId && !editingItem) return;

    // Normalize boolean values to strings before submitting
    collectionFields.forEach((field) => {
      if (field.type === "boolean" && field.id in values) {
        values[field.id] = normalizeBooleanValue(values[field.id]);
      }
    });

    // Normalize the slug to a valid URL segment before validation/save so a
    // pasted leading slash, spaces or invalid chars can't break routing.
    if (slugField && typeof values[slugField.id] === "string") {
      values[slugField.id] = slugify(values[slugField.id]);
    }

    let hasErrors = false;

    // Validate required fields
    if (nameField) {
      const nameValue = values[nameField.id]?.trim();
      if (!nameValue) {
        form.setError(nameField.id, {
          type: "manual",
          message: "Name is required",
        });
        hasErrors = true;
      }
    }

    if (slugField) {
      const slugValue = values[slugField.id]?.trim();
      if (!slugValue) {
        form.setError(slugField.id, {
          type: "manual",
          message: "Slug is required",
        });
        hasErrors = true;
      } else if (!validateSlugUniqueness(slugValue, slugField.id)) {
        form.setError(slugField.id, {
          type: "manual",
          message: "This slug already exists in this collection",
        });
        hasErrors = true;
      }
    }

    if (hasErrors) return;

    setIsSaving(true);
    try {
      if (editingItem) {
        const saved = await updateItem(collectionId, editingItem.id, values);
        // Keep collection layers (canvas) in step with the persisted values.
        updateItemInLayerData(saved.id, saved.values);
      } else {
        await createItem(collectionId, values);
      }

      invalidateLayerData(collectionId);
      refetchLayersForCollection(collectionId);

      // Persisted — close. The form stays open (with the user's input) on any
      // failure above, so nothing is lost.
      form.reset();
      if (onSuccess) {
        onSuccess();
      } else {
        onOpenChange(false);
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Please try again.";
      if (slugField && /slug/i.test(message)) {
        form.setError(slugField.id, { type: "server", message });
      }
      toast.error(
        editingItem ? "Failed to save item" : "Failed to create item",
        { description: message },
      );
    } finally {
      setIsSaving(false);
    }
  };

  // Handle sheet close - check for unsaved changes
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen && isDirty) {
        // Show unsaved changes dialog instead of closing
        setShowUnsavedDialog(true);
        return;
      }
      if (!isOpen) {
        form.clearErrors();
      }
      onOpenChange(isOpen);
    },
    [onOpenChange, form, isDirty],
  );

  // Discard unsaved changes and close sheet
  const handleConfirmDiscard = useCallback(() => {
    setShowUnsavedDialog(false);
    form.clearErrors();
    form.reset();
    onOpenChange(false);
  }, [form, onOpenChange]);

  // Cancel discard - keep sheet open
  const handleCancelDiscard = useCallback(() => {
    setShowUnsavedDialog(false);
  }, []);

  // Keep a stable ref to handleSubmit to avoid re-creating handleSaveFromDialog on every render
  const handleSubmitRef = useRef(handleSubmit);
  handleSubmitRef.current = handleSubmit;

  // Save changes from dialog, then close
  const handleSaveFromDialog = useCallback(async () => {
    setShowUnsavedDialog(false);
    // Trigger form submission programmatically
    form.handleSubmit(handleSubmitRef.current)();
  }, [form]);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        onOpenAutoFocus={handleOpenAutoFocus}
        aria-describedby={undefined}
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 flex-wrap">
            {`${isCreateMode ? "Create" : "Edit"} ${collection?.name ?? ""} Item`}
          </SheetTitle>
          <SheetActions>
            {editingItem && onDeleteItem && (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="secondary">
                    <Icon name="dotsHorizontal" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => onDeleteItem(editingItem.id)}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <Button
              size="sm"
              type="submit"
              form="collection-item-form"
              disabled={isSaving || (!!itemId && !editingItem)}
            >
              {isSaving
                ? "Saving..."
                : itemLoadState === "loading"
                  ? "Loading..."
                  : isCreateMode
                    ? "Create"
                    : "Save"}
            </Button>
          </SheetActions>
        </SheetHeader>

        <Form {...form}>
          <form
            id="collection-item-form"
            onSubmit={form.handleSubmit(handleSubmit)}
            className="flex flex-col gap-4 flex-1"
          >
            <div className="flex-1 flex flex-col gap-6">
              {collectionFields
                .filter((f) => f.fillable)
                .map((field) => {
                  return (
                    <FormField
                      key={field.id}
                      control={form.control}
                      name={field.id}
                      render={({ field: formField }) => (
                        <FormItem>
                          <div className="flex items-center gap-2">
                            <FormLabel>{field.name}</FormLabel>
                            {field.type === "multi_reference" &&
                              (() => {
                                const ids = parseMultiReferenceValue(
                                  formField.value,
                                );
                                return ids.length > 0 ? (
                                  <span className="text-[10px] text-muted-foreground leading-none">
                                    {ids.length} item
                                    {ids.length !== 1 ? "s" : ""} selected
                                  </span>
                                ) : null;
                              })()}
                          </div>
                          <FormControl>
                            <div className="min-w-0">
                              {field.type === "rich_text" ? (
                                <div>
                                  <RichTextEditor
                                    value={formField.value || ""}
                                    onChange={formField.onChange}
                                    placeholder={
                                      field.default ||
                                      `Enter ${field.name.toLowerCase()}...`
                                    }
                                    variant="full"
                                    withFormatting={true}
                                    excludedLinkTypes={["asset", "field"]}
                                    hidePageContextOptions={true}
                                    onExpandClick={() =>
                                      setExpandedRichTextField(field.id)
                                    }
                                  />
                                  <RichTextEditorSheet
                                    open={expandedRichTextField === field.id}
                                    onOpenChange={(open) => {
                                      if (!open) setExpandedRichTextField(null);
                                    }}
                                    description={`CMS item "${field.name}" field`}
                                    value={formField.value || ""}
                                    onChange={formField.onChange}
                                    placeholder={
                                      field.default ||
                                      `Enter ${field.name.toLowerCase()}...`
                                    }
                                    hidePageContextOptions={true}
                                  />
                                </div>
                              ) : field.type === "reference" &&
                                field.reference_collection_id ? (
                                <ReferenceFieldCombobox
                                  collectionId={field.reference_collection_id}
                                  value={formField.value || ""}
                                  onChange={formField.onChange}
                                  isMulti={false}
                                  placeholder={`Select ${field.name.toLowerCase()}...`}
                                />
                              ) : field.type === "multi_reference" &&
                                field.reference_collection_id ? (
                                <ReferenceFieldCombobox
                                  collectionId={field.reference_collection_id}
                                  value={formField.value || "[]"}
                                  onChange={formField.onChange}
                                  isMulti={true}
                                  placeholder={`Select ${field.name.toLowerCase()}...`}
                                />
                              ) : field.type === "link" ? (
                                <CollectionLinkFieldInput
                                  value={formField.value || ""}
                                  onChange={formField.onChange}
                                />
                              ) : field.type === "email" ? (
                                <Input
                                  type="email"
                                  placeholder={
                                    field.default ||
                                    `Enter ${field.name.toLowerCase()}...`
                                  }
                                  autoComplete="off"
                                  {...formField}
                                />
                              ) : field.type === "phone" ? (
                                <Input
                                  type="tel"
                                  placeholder={
                                    field.default ||
                                    `Enter ${field.name.toLowerCase()}...`
                                  }
                                  autoComplete="off"
                                  {...formField}
                                />
                              ) : field.type === "date" ? (
                                <Input
                                  type="datetime-local"
                                  autoComplete="off"
                                  value={formatDateInTimezone(
                                    formField.value,
                                    timezone,
                                    "datetime-local",
                                  )}
                                  onChange={(e) => {
                                    const clamped = clampDateInputValue(
                                      e.target.value,
                                    );
                                    const utcValue = localDatetimeToUTC(
                                      clamped,
                                      timezone,
                                    );
                                    formField.onChange(utcValue);
                                  }}
                                />
                              ) : field.type === "date_only" ? (
                                <Input
                                  type="date"
                                  autoComplete="off"
                                  value={formField.value?.slice(0, 10) || ""}
                                  onChange={(e) => {
                                    formField.onChange(
                                      clampDateInputValue(e.target.value) || "",
                                    );
                                  }}
                                />
                              ) : field.type === "color" ? (
                                <ColorFieldInput
                                  value={formField.value || ""}
                                  onChange={formField.onChange}
                                />
                              ) : isMultipleAssetField(field) ? (
                                /* Multiple Asset Field */
                                (() => {
                                  // Handle both array (from castValue) and JSON string formats
                                  let assetIds: string[] = [];
                                  const rawValue = formField.value;
                                  if (Array.isArray(rawValue)) {
                                    assetIds = rawValue;
                                  } else if (
                                    typeof rawValue === "string" &&
                                    rawValue
                                  ) {
                                    try {
                                      const parsed = JSON.parse(rawValue);
                                      assetIds = Array.isArray(parsed)
                                        ? parsed
                                        : [];
                                    } catch {
                                      assetIds = [];
                                    }
                                  }

                                  const fieldTypeLabel = getAssetFieldTypeLabel(
                                    field.type,
                                  );
                                  const addButtonLabel = getAssetFieldLabel(
                                    field.type,
                                  );

                                  const showInvalidTypeError = () => {
                                    const article =
                                      fieldTypeLabel === "audio" ? "an" : "a";
                                    toast.error("Invalid asset type", {
                                      description: `Please select ${article} ${fieldTypeLabel} file.`,
                                    });
                                  };

                                  const handleAddAsset = () => {
                                    openFileManager(
                                      (asset) => {
                                        if (
                                          !isValidAssetForField(
                                            asset,
                                            field.type,
                                          )
                                        ) {
                                          showInvalidTypeError();
                                          return false;
                                        }
                                        if (!assetIds.includes(asset.id)) {
                                          formField.onChange(
                                            JSON.stringify([
                                              ...assetIds,
                                              asset.id,
                                            ]),
                                          );
                                        }
                                      },
                                      undefined,
                                      getFileManagerCategory(field.type),
                                    );
                                  };

                                  const handleReplaceAsset = (
                                    oldAssetId: string,
                                  ) => {
                                    openFileManager(
                                      (asset) => {
                                        if (
                                          !isValidAssetForField(
                                            asset,
                                            field.type,
                                          )
                                        ) {
                                          showInvalidTypeError();
                                          return false;
                                        }
                                        formField.onChange(
                                          JSON.stringify(
                                            assetIds.map((id) =>
                                              id === oldAssetId ? asset.id : id,
                                            ),
                                          ),
                                        );
                                      },
                                      oldAssetId,
                                      getFileManagerCategory(field.type),
                                    );
                                  };

                                  const handleRemoveAsset = (
                                    assetId: string,
                                  ) => {
                                    formField.onChange(
                                      JSON.stringify(
                                        assetIds.filter((id) => id !== assetId),
                                      ),
                                    );
                                  };

                                  const handleAssetDragEnd = (
                                    event: DragEndEvent,
                                  ) => {
                                    const { active, over } = event;
                                    if (!over || active.id === over.id) return;
                                    const oldIndex = assetIds.indexOf(
                                      String(active.id),
                                    );
                                    const newIndex = assetIds.indexOf(
                                      String(over.id),
                                    );
                                    if (oldIndex === -1 || newIndex === -1)
                                      return;
                                    formField.onChange(
                                      JSON.stringify(
                                        arrayMove(assetIds, oldIndex, newIndex),
                                      ),
                                    );
                                  };

                                  return (
                                    <div className="space-y-2">
                                      {assetIds.length > 1 ? (
                                        <DndContext
                                          sensors={dndSensors}
                                          collisionDetection={closestCenter}
                                          onDragEnd={handleAssetDragEnd}
                                        >
                                          <SortableContext
                                            items={assetIds}
                                            strategy={rectSortingStrategy}
                                          >
                                            <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))]">
                                              {assetIds.map((assetId) => (
                                                <SortableAssetFieldCard
                                                  key={assetId}
                                                  id={assetId}
                                                  asset={getAsset(assetId)}
                                                  fieldType={field.type}
                                                  onChangeFile={() =>
                                                    handleReplaceAsset(assetId)
                                                  }
                                                  onRemove={() =>
                                                    handleRemoveAsset(assetId)
                                                  }
                                                />
                                              ))}
                                            </div>
                                          </SortableContext>
                                        </DndContext>
                                      ) : assetIds.length === 1 ? (
                                        <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))]">
                                          <AssetFieldCard
                                            asset={getAsset(assetIds[0])}
                                            fieldType={field.type}
                                            onChangeFile={() =>
                                              handleReplaceAsset(assetIds[0])
                                            }
                                            onRemove={() =>
                                              handleRemoveAsset(assetIds[0])
                                            }
                                          />
                                        </div>
                                      ) : null}
                                      <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleAddAsset();
                                        }}
                                      >
                                        <Icon name="plus" className="size-3" />
                                        Add {addButtonLabel}
                                      </Button>
                                    </div>
                                  );
                                })()
                              ) : isAssetFieldType(field.type) ? (
                                /* Single Asset Field */
                                (() => {
                                  const currentAssetId =
                                    formField.value || null;
                                  const currentAsset = currentAssetId
                                    ? getAsset(currentAssetId)
                                    : null;
                                  const fieldTypeLabel = getAssetFieldTypeLabel(
                                    field.type,
                                  );
                                  const addButtonLabel = getAssetFieldLabel(
                                    field.type,
                                  );

                                  const handleOpenFileManager = () => {
                                    openFileManager(
                                      (asset) => {
                                        if (
                                          !isValidAssetForField(
                                            asset,
                                            field.type,
                                          )
                                        ) {
                                          const article =
                                            fieldTypeLabel === "audio"
                                              ? "an"
                                              : "a";
                                          toast.error("Invalid asset type", {
                                            description: `Please select ${article} ${fieldTypeLabel} file.`,
                                          });
                                          return false;
                                        }
                                        formField.onChange(asset.id);
                                      },
                                      currentAssetId,
                                      getFileManagerCategory(field.type),
                                    );
                                  };

                                  if (!currentAsset) {
                                    return (
                                      <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        className="w-fit"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOpenFileManager();
                                        }}
                                      >
                                        <Icon name="plus" className="size-3" />
                                        Add {addButtonLabel}
                                      </Button>
                                    );
                                  }

                                  return (
                                    <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))]">
                                      <AssetFieldCard
                                        asset={currentAsset}
                                        fieldType={field.type}
                                        onChangeFile={handleOpenFileManager}
                                        onRemove={() => formField.onChange("")}
                                      />
                                    </div>
                                  );
                                })()
                              ) : field.type === "boolean" ? (
                                <div className="flex items-center gap-2">
                                  <Checkbox
                                    id={`${field.id}-boolean`}
                                    checked={formField.value === "true"}
                                    onCheckedChange={(checked) =>
                                      formField.onChange(
                                        checked ? "true" : "false",
                                      )
                                    }
                                  />
                                  <Label
                                    htmlFor={`${field.id}-boolean`}
                                    className="text-xs text-muted-foreground font-normal cursor-pointer gap-1"
                                  >
                                    Value is set to{" "}
                                    <span className="text-foreground">
                                      {formField.value === "true"
                                        ? "YES"
                                        : "NO"}
                                    </span>
                                  </Label>
                                </div>
                              ) : field.type === "option" ? (
                                (() => {
                                  const options = field.data?.options ?? [];
                                  const currentValue = formField.value || "";
                                  const hasMatchingOption = options.some(
                                    (o) => o.name.trim() === currentValue,
                                  );
                                  return (
                                    <Select
                                      value={currentValue || "__none__"}
                                      onValueChange={(value) => {
                                        // Radix Select renders a hidden native <select> for form
                                        // integration that dispatches a spurious change event with
                                        // an empty value when the controlled `value` prop changes
                                        // externally (e.g. via form.reset) before the SelectItem
                                        // for that value has registered (the items live in a
                                        // Portal that mounts only when the select is open).
                                        // Ignore that spurious empty change so it can't clobber
                                        // the loaded form value. SelectItem disallows value="",
                                        // so an empty string is never user-initiated.
                                        if (value === "") return;
                                        formField.onChange(
                                          value === "__none__" ? "" : value,
                                        );
                                      }}
                                      disabled={options.length === 0}
                                    >
                                      <SelectTrigger className="w-full">
                                        <SelectValue
                                          placeholder={
                                            options.length === 0
                                              ? "No options available"
                                              : `Select ${field.name.toLowerCase()}...`
                                          }
                                        />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectGroup>
                                          <SelectItem value="__none__">
                                            None
                                          </SelectItem>
                                          {options
                                            .filter(
                                              (o) => o.name.trim().length > 0,
                                            )
                                            .map((option) => (
                                              <SelectItem
                                                key={option.id}
                                                value={option.name.trim()}
                                              >
                                                {option.name.trim()}
                                              </SelectItem>
                                            ))}
                                          {currentValue &&
                                            !hasMatchingOption && (
                                              <SelectItem
                                                value={currentValue}
                                                disabled
                                              >
                                                {currentValue} (deleted)
                                              </SelectItem>
                                            )}
                                        </SelectGroup>
                                      </SelectContent>
                                    </Select>
                                  );
                                })()
                              ) : field.key === "name" ? (
                                <Input
                                  ref={nameInputRef}
                                  placeholder={
                                    field.default ||
                                    `Enter ${field.name.toLowerCase()}...`
                                  }
                                  autoComplete="off"
                                  name={formField.name}
                                  value={formField.value}
                                  onChange={formField.onChange}
                                  onBlur={formField.onBlur}
                                />
                              ) : field.key === "slug" ? (
                                <Input
                                  placeholder={
                                    field.default ||
                                    `Enter ${field.name.toLowerCase()}...`
                                  }
                                  autoComplete="off"
                                  name={formField.name}
                                  value={formField.value}
                                  onChange={(e) =>
                                    formField.onChange(
                                      sanitizeSlug(e.target.value, true),
                                    )
                                  }
                                  onBlur={(e) => {
                                    formField.onChange(
                                      sanitizeSlug(e.target.value, false),
                                    );
                                    formField.onBlur();
                                  }}
                                />
                              ) : (
                                <Input
                                  placeholder={
                                    field.default ||
                                    `Enter ${field.name.toLowerCase()}...`
                                  }
                                  autoComplete="off"
                                  {...formField}
                                />
                              )}
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  );
                })}
            </div>
          </form>
        </Form>
      </SheetContent>

      <ConfirmDialog
        open={showUnsavedDialog}
        onOpenChange={setShowUnsavedDialog}
        title="Unsaved Changes"
        description="You have unsaved changes. Are you sure you want to discard them?"
        confirmLabel="Discard changes"
        cancelLabel="Cancel"
        confirmVariant="destructive"
        onConfirm={handleConfirmDiscard}
        onCancel={handleCancelDiscard}
        saveLabel="Save changes"
        onSave={handleSaveFromDialog}
      />
    </Sheet>
  );
}
