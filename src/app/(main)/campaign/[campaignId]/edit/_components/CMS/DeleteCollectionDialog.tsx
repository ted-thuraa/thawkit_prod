"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Spinner } from "@/components/ui/spinner";
import { collectionsWriteApi } from "@/lib/editor/editor-collection-write-api";
import type { CollectionUsageResult } from "@/lib/collection-usage-scan";
import { useCollectionsStore } from "@/stores/editor/useCollectionsStore";
import { CollectionUsageSections } from "./UsageSections";

interface DeleteCollectionDialogProps {
  /** The collection pending deletion; the dialog shows while `open`. */
  collectionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the collection was deleted on the server. */
  onDeleted?: (collectionId: string) => void;
}

/**
 * Single owner of the delete-collection flow (it used to be split across the
 * sidebar, which set the state, and the content editor, which rendered the
 * dialog — neither half worked on its own). Usage is checked on open; the
 * server re-checks on delete and is authoritative.
 */
export default function DeleteCollectionDialog({
  collectionId,
  open,
  onOpenChange,
  onDeleted,
}: DeleteCollectionDialogProps) {
  const collections = useCollectionsStore((s) => s.collections);
  const deleteCollection = useCollectionsStore((s) => s.deleteCollection);
  // Usage for ONE collection id. Keyed by id so a result that belongs to a
  // previously opened collection is never shown for the current one, and so no
  // state is set synchronously inside the effect (only in the async callback).
  const [usageResult, setUsageResult] = useState<{
    collectionId: string;
    usage: CollectionUsageResult | null;
  } | null>(null);

  const name = collections.find((c) => c.id === collectionId)?.name;
  const settled = !!collectionId && usageResult?.collectionId === collectionId;
  const loading = open && !!collectionId && !settled;
  const usage = settled ? usageResult.usage : null;

  useEffect(() => {
    if (!open || !collectionId) return;
    let cancelled = false;
    collectionsWriteApi.getUsage(collectionId).then((response) => {
      if (cancelled) return;
      setUsageResult({ collectionId, usage: response.data ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [open, collectionId]);

  const inUse = usage !== null && usage.total > 0;

  const handleConfirm = async () => {
    if (!collectionId || inUse) return;
    try {
      await deleteCollection(collectionId);
      onDeleted?.(collectionId);
    } catch (error) {
      toast.error("Failed to delete collection", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
      throw error; // keep the dialog open
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={inUse ? "Collection in use" : "Delete collection"}
      confirmLabel="Delete"
      confirmVariant="destructive"
      disableConfirm={loading || inUse}
      onConfirm={handleConfirm}
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <Spinner />
          Checking collection usage...
        </span>
      ) : inUse && usage ? (
        <div className="space-y-3">
          <p>
            <span className="text-foreground">{name ?? "This collection"}</span>{" "}
            cannot be deleted because it is still being used. Remove all
            references before deleting.
          </p>
          <CollectionUsageSections usage={usage} />
        </div>
      ) : (
        <p>
          Are you sure you want to delete &quot;{name ?? "this collection"}
          &quot; and all of its items? This action cannot be undone.
        </p>
      )}
    </ConfirmDialog>
  );
}
