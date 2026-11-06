"use client";

// path: src/app/(main)/campaign/[campaignId]/edit/_components/AssetFolderDialog.tsx

/**
 * Create / edit a regular asset folder (name + parent).
 *
 * Adapted from Ycode's AssetFolderDialog with one behavioural fix: Ycode's
 * closes itself after `onConfirm` no matter what happened. Here `onConfirm`
 * reports success; on failure the dialog STAYS OPEN with the user's input so
 * they can correct it (the caller shows the reason).
 *
 * "All files" is the virtual root: choosing it as the parent yields
 * `parentFolderId === null` (no folder row exists for it).
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  buildAssetFolderPath,
  isDescendantAssetFolder,
} from "@/lib/assets/asset-folder-utils";
import { MAX_FOLDER_NAME_LENGTH } from "@/lib/assets/folder-name";
import type { AssetFolder } from "@/types/funnel";

interface AssetFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolve `true` on success (dialog closes); `false` keeps it open. */
  onConfirm: (folderName: string, parentFolderId: string | null) => Promise<boolean> | boolean;
  mode?: "create" | "rename";
  initialName?: string;
  initialParentFolderId?: string | null;
  folders?: AssetFolder[];
  /** The folder being edited: it and its descendants can't be chosen as parent. */
  currentFolderId?: string | null;
}

export default function AssetFolderDialog({
  open,
  onOpenChange,
  onConfirm,
  mode = "create",
  initialName = "",
  initialParentFolderId = null,
  folders = [],
  currentFolderId = null,
}: AssetFolderDialogProps) {
  const [folderName, setFolderName] = useState(initialName);
  const [parentFolderId, setParentFolderId] = useState<string | null>(initialParentFolderId);
  const [isProcessing, setIsProcessing] = useState(false);
  const prevOpenRef = useRef(false);

  // Sync the form only when the dialog OPENS (not on every prop change / close).
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setFolderName(initialName);
      setParentFolderId(initialParentFolderId);
    }
    prevOpenRef.current = open;
  }, [open, initialName, initialParentFolderId]);

  // A folder can't become its own parent, nor a child of its own subtree.
  const availableFolders = folders.filter((folder) => {
    if (!currentFolderId) return true;
    if (folder.id === currentFolderId) return false;
    return !isDescendantAssetFolder(folder.id, currentFolderId, folders);
  });

  const pathLabel = (folderId: string) =>
    `All files / ${buildAssetFolderPath(folderId, folders).join(" / ")}`;

  const trimmed = folderName.trim();

  const handleConfirm = async () => {
    if (!trimmed || isProcessing) return;
    setIsProcessing(true);
    try {
      const ok = await onConfirm(trimmed, parentFolderId);
      if (ok) onOpenChange(false);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="320px" aria-describedby={undefined} className="gap-0">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New folder" : "Edit folder"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4.5 pt-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="folder-name">Name</Label>
            <Input
              id="folder-name"
              placeholder="Folder name"
              value={folderName}
              maxLength={MAX_FOLDER_NAME_LENGTH}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleConfirm();
              }}
              autoFocus
              disabled={isProcessing}
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="parent-folder">Parent folder</Label>
            <Select
              value={parentFolderId || "root"}
              onValueChange={(value) => setParentFolderId(value === "root" ? null : value)}
              disabled={isProcessing}
            >
              <SelectTrigger id="parent-folder">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="root">All files</SelectItem>
                {availableFolders.map((folder) => (
                  <SelectItem key={folder.id} value={folder.id}>
                    {pathLabel(folder.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="grid grid-cols-2 mt-1">
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isProcessing}>
              Cancel
            </Button>
            <Button onClick={() => void handleConfirm()} disabled={!trimmed || isProcessing}>
              {isProcessing ? (
                <>
                  <Spinner />
                  {mode === "create" ? "Creating..." : "Saving..."}
                </>
              ) : mode === "create" ? (
                "Create"
              ) : (
                "Save"
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
