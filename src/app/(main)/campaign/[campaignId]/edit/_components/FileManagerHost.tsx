"use client";

// path: src/app/(main)/campaign/[campaignId]/edit/_components/FileManagerHost.tsx

/**
 * Bridges the File Manager to the editor's picker contract.
 *
 * Every asset control (image, icon, background, poster, link, rich text…)
 * calls `useEditorStore.openFileManager(onSelect, currentAssetId, category)`.
 * This host renders `FileManagerDialog` from that request and owns closing:
 * after a selection the dialog closes unless the control's callback returned
 * `false` (its way of saying "wrong kind of file, keep the picker open").
 *
 * The dialog is mounted only while a request exists, so every open starts
 * from clean state (folder = All files, no stale selection or search).
 * Mounted once in `EditorLayoutClient`, so it is available in every editor
 * area and from the header's "File manager" item (browse mode: no callback).
 */

import { useEditorStore } from "@/stores/editor/useEditorStore";
import FileManagerDialog from "./FileManagerDialog";

export default function FileManagerHost() {
  const request = useEditorStore((state) => state.fileManager);
  const close = useEditorStore((state) => state.closeFileManager);

  if (!request) return null;

  return (
    <FileManagerDialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      assetId={request.assetId}
      category={request.category}
      onAssetSelect={
        request.onSelect
          ? (asset) => {
              const result = request.onSelect?.(asset);
              if (result !== false) close();
              return result;
            }
          : undefined
      }
    />
  );
}
