"use client";

import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { parseMultiReferenceValue } from "@/lib/collection-utils";
import type { CollectionField, CollectionItemWithValues } from "@/types/funnel";
import CollectionItemContextMenu from "./CollectionItemContextMenu";

/**
 * Presentational pieces of the CMS items table, extracted from the content
 * editor so it can stay focused on data / navigation.
 */

interface ReferenceFieldCellProps {
  value: string;
  field: CollectionField;
  /** collectionId → { itemId → display name } */
  referenceItemsCache: Record<string, Record<string, string>>;
}

/** Renders a reference / multi-reference value in a table cell. */
export function ReferenceFieldCell({
  value,
  field,
  referenceItemsCache,
}: ReferenceFieldCellProps) {
  if (!value || !field.reference_collection_id) {
    return <span className="text-muted-foreground">-</span>;
  }

  if (field.type === "multi_reference") {
    const ids = parseMultiReferenceValue(value);
    if (ids.length === 0) {
      return <span className="text-muted-foreground">-</span>;
    }
    return (
      <Badge variant="secondary" className="font-normal">
        {ids.length} item{ids.length !== 1 ? "s" : ""}
      </Badge>
    );
  }

  const cache = referenceItemsCache[field.reference_collection_id] || {};
  const displayName = cache[value];
  if (displayName) return <span>{displayName}</span>;

  // Not resolved (yet): the referenced item may still be loading.
  return <span className="text-muted-foreground">Loading...</span>;
}

interface SortableRowProps {
  item: CollectionItemWithValues;
  isManualMode?: boolean;
  children: React.ReactNode;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/** A draggable table row (drag-reorder in manual mode) with a context menu. */
export function SortableRow({
  item,
  isManualMode,
  children,
  onEdit,
  onDuplicate,
  onDelete,
}: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: isDragging ? "grabbing" : isManualMode ? "grab" : "pointer",
  };

  return (
    <CollectionItemContextMenu
      onEdit={onEdit}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
    >
      {/* The ROW is the single click target for "open this item": one handler
          instead of one per cell type, so every cell kind behaves the same. The
          selection checkbox stops its own propagation. */}
      <tr
        ref={setNodeRef}
        style={style}
        onClick={onEdit}
        {...attributes}
        {...listeners}
        className={cn("group border-b hover:bg-secondary/50 transition-colors")}
      >
        {children}
        <td className="w-10 px-2 text-center" />
      </tr>
    </CollectionItemContextMenu>
  );
}
