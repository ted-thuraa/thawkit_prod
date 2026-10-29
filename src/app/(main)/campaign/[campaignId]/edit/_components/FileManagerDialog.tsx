"use client";

// path: src/app/(main)/campaign/[campaignId]/edit/_components/FileManagerDialog.tsx

/**
 * The media library / asset picker.
 *
 * Opened by `useEditorStore.openFileManager(onSelect, currentAssetId, category)`
 * — the one contract every asset control (image, icon, background, poster,
 * link target, rich-text image) already uses, so none of them changed.
 * Mounted once in `builderMain.tsx`.
 *
 * Data flow
 *   list    useAssetsStore.fetchAssets → server action (org-scoped) → local page
 *           state here; the store's id-cache is filled as a side effect.
 *   upload  browser → UploadThing (direct) → router middleware (auth/tenant) →
 *           onUploadComplete (verify bytes, persist row) → `serverData.asset`
 *           → addAsset() + prepended to the grid. Nothing is shown that the
 *           server didn't confirm.
 *   select  onSelect(asset); the control writes `{type:"asset", asset_id}`
 *           through its own onLayerUpdate (undo/redo path unchanged).
 *   delete  useAssetsStore.deleteAsset → server refuses while referenced;
 *           the grid only drops the tile after confirmed success.
 *
 * Scope: images + SVG. Video/audio/document requests get an explanation
 * instead of an upload UI (videos are external YouTube/Loom links).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Icon from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  UPLOAD_ACCEPT,
  validateUploadCandidate,
} from "@/lib/assets/upload-policy";
import { useUploadThing } from "@/lib/assets/uploadthing-client";
import { buildSvgDataUrl, formatFileSize, matchesCategoryFilter } from "@/lib/asset-utils";
import { useAssetsStore } from "@/stores/editor/useAssetsStore";
import { useEditorBootstrapStore } from "@/stores/editor/useEditorBootstrapStore";
import { useEditorStore } from "@/stores/editor/useEditorStore";
import type { Asset } from "@/types/funnel";

const PAGE_SIZE = 40;

/** Preview source: stored file URL, else inline SVG as an (inert) data URL. */
function thumbnailSrc(asset: Asset): string | null {
  if (asset.public_url) return asset.public_url;
  if (asset.content) return buildSvgDataUrl(asset.content);
  return null;
}

export default function FileManagerDialog() {
  const request = useEditorStore((s) => s.fileManager);
  const close = useEditorStore((s) => s.closeFileManager);
  const open = request !== null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      {/* Keyed + conditionally mounted: every open starts from a clean state. */}
      {open && <LibraryContent key="library" />}
    </Dialog>
  );
}

function LibraryContent() {
  const request = useEditorStore((s) => s.fileManager)!;
  const close = useEditorStore((s) => s.closeFileManager);
  const campaignId = useEditorBootstrapStore((s) => s.campaignId);
  const folders = useAssetsStore((s) => s.folders);
  const fetchAssets = useAssetsStore((s) => s.fetchAssets);
  const addAsset = useAssetsStore((s) => s.addAsset);
  const deleteAsset = useAssetsStore((s) => s.deleteAsset);

  const category = request.category ?? "all";
  // Can this caller use anything we are able to upload (images / SVG)?
  const supportsUploads =
    matchesCategoryFilter("image/png", category) ||
    matchesCategoryFilter("image/svg+xml", category);

  const [items, setItems] = useState<Asset[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  // undefined = all files; null = library root; string = a folder
  const [folderId, setFolderId] = useState<string | null | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(request.assetId);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestSeq = useRef(0);

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(
    async (pageToLoad: number, mode: "replace" | "append") => {
      const seq = ++requestSeq.current;
      setLoading(true);
      setLoadError(null);
      try {
        const result = await fetchAssets({
          folderId,
          search: search || undefined,
          page: pageToLoad,
          limit: PAGE_SIZE,
        });
        if (seq !== requestSeq.current) return; // a newer request superseded this one
        setItems((prev) =>
          mode === "append"
            ? [...prev, ...result.assets.filter((a) => !prev.some((p) => p.id === a.id))]
            : result.assets,
        );
        setPage(result.page);
        setHasMore(result.hasMore);
      } catch (error) {
        if (seq !== requestSeq.current) return;
        setLoadError(error instanceof Error ? error.message : "Failed to load assets.");
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [fetchAssets, folderId, search],
  );

  useEffect(() => {
    if (supportsUploads) void load(1, "replace");
    else setLoading(false);
  }, [load, supportsUploads]);

  const visible = useMemo(
    () => items.filter((a) => matchesCategoryFilter(a.mime_type, category)),
    [items, category],
  );
  const selected = visible.find((a) => a.id === selectedId) ?? null;

  // ── Upload ────────────────────────────────────────────────────────────────
  const { startUpload, isUploading } = useUploadThing("assetLibrary", {
    onUploadProgress: (p) => setUploadProgress(p),
    onUploadError: (error) => {
      setUploadError(error.message);
      toast.error(error.message);
    },
  });

  const handleFiles = useCallback(
    async (fileList: FileList | File[] | null) => {
      const files = Array.from(fileList ?? []);
      if (files.length === 0 || !campaignId) return;
      setUploadError(null);

      // Fast, friendly pre-checks. The server re-verifies the real bytes.
      const accepted: File[] = [];
      for (const file of files) {
        const problem = validateUploadCandidate(file);
        if (problem) {
          setUploadError(problem);
          toast.error(problem);
        } else {
          accepted.push(file);
        }
      }
      if (accepted.length === 0) return;

      setUploadProgress(0);
      try {
        const results = await startUpload(accepted, {
          campaignId,
          folderId: typeof folderId === "string" ? folderId : null,
        });
        if (!results) return; // onUploadError already surfaced the reason

        const uploaded = results
          .map((r) => (r.serverData as { asset?: Asset } | null)?.asset)
          .filter((a): a is Asset => !!a);

        for (const asset of uploaded) addAsset(asset);
        if (uploaded.length > 0) {
          // Show new files immediately, from the server-confirmed rows.
          setItems((prev) => [
            ...uploaded.filter((u) => !prev.some((p) => p.id === u.id)),
            ...prev,
          ]);
          toast.success(
            uploaded.length === 1
              ? `Uploaded ${uploaded[0].filename}`
              : `Uploaded ${uploaded.length} files`,
          );
          const usable = uploaded.find((a) => matchesCategoryFilter(a.mime_type, category));
          if (usable) setSelectedId(usable.id);
          else toast.message("Uploaded, but this control needs a different file type.");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Upload failed.";
        setUploadError(message);
        toast.error(message);
      } finally {
        setUploadProgress(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [addAsset, campaignId, category, folderId, startUpload],
  );

  // ── Select / delete ───────────────────────────────────────────────────────
  const choose = useCallback(
    (asset: Asset) => {
      const result = request.onSelect?.(asset);
      if (result !== false) close();
    },
    [close, request],
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    const result = await deleteAsset(deleteTarget.id);
    setDeleting(false);
    if (result.ok) {
      setItems((prev) => prev.filter((a) => a.id !== deleteTarget.id));
      if (selectedId === deleteTarget.id) setSelectedId(null);
      toast.success(`Deleted ${deleteTarget.filename}`);
      setDeleteTarget(null);
    } else {
      // In use / storage failure / etc.: the file is still there — say why.
      setDeleteError(result.error);
    }
  }, [deleteAsset, deleteTarget, selectedId]);

  const busy = isUploading || uploadProgress !== null;

  return (
    <>
      <DialogContent
        className="flex h-[min(640px,85vh)] flex-col gap-3 sm:max-w-3xl"
        onDragOver={(e) => supportsUploads && e.preventDefault()}
        onDrop={(e) => {
          if (!supportsUploads) return;
          e.preventDefault();
          void handleFiles(e.dataTransfer.files);
        }}
      >
        <DialogHeader>
          <DialogTitle>Asset library</DialogTitle>
          <DialogDescription>
            {supportsUploads
              ? "Upload images and SVG icons, then choose one to use."
              : "This control can’t use uploaded files."}
          </DialogDescription>
        </DialogHeader>

        {!supportsUploads ? (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed p-6 text-center text-muted-foreground">
            Uploading videos, audio and documents isn’t supported. Videos can be
            added as a YouTube or Loom link in the video settings.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Icon
                  name="search"
                  className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search files"
                  className="pl-7"
                  aria-label="Search files"
                />
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={UPLOAD_ACCEPT}
                className="hidden"
                onChange={(e) => void handleFiles(e.target.files)}
              />
              <Button
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy || !campaignId}
              >
                {busy ? <Spinner className="size-3" /> : <Icon name="upload" className="size-3" />}
                {busy ? `Uploading${uploadProgress ? ` ${Math.round(uploadProgress)}%` : "…"}` : "Upload"}
              </Button>
            </div>

            {folders.length > 0 && (
              <div className="flex flex-wrap gap-1" role="tablist" aria-label="Folders">
                <FolderChip active={folderId === undefined} onClick={() => setFolderId(undefined)}>
                  All files
                </FolderChip>
                <FolderChip active={folderId === null} onClick={() => setFolderId(null)}>
                  Unfiled
                </FolderChip>
                {folders.map((f) => (
                  <FolderChip key={f.id} active={folderId === f.id} onClick={() => setFolderId(f.id)}>
                    {f.name}
                  </FolderChip>
                ))}
              </div>
            )}

            {uploadError && (
              <div role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">
                {uploadError}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border p-2">
              {loadError ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <p className="text-destructive">{loadError}</p>
                  <Button size="sm" variant="outline" onClick={() => void load(1, "replace")}>
                    Try again
                  </Button>
                </div>
              ) : loading && items.length === 0 ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {Array.from({ length: 8 }, (_, i) => (
                    <Skeleton key={i} className="aspect-square rounded-md" />
                  ))}
                </div>
              ) : visible.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-muted-foreground">
                  <Icon name="image" className="size-5" />
                  <p>{search ? "No files match your search." : "No files yet."}</p>
                  {!search && <p>Upload an image or SVG, or drop files here.</p>}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {visible.map((asset) => (
                      <AssetTile
                        key={asset.id}
                        asset={asset}
                        selected={asset.id === selectedId}
                        current={asset.id === request.assetId}
                        onSelect={() => setSelectedId(asset.id)}
                        onChoose={() => request.onSelect && choose(asset)}
                        onDelete={() => {
                          setDeleteError(null);
                          setDeleteTarget(asset);
                        }}
                      />
                    ))}
                  </div>
                  {hasMore && (
                    <div className="mt-3 flex justify-center">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={loading}
                        onClick={() => void load(page + 1, "append")}
                      >
                        {loading ? <Spinner className="size-3" /> : null}
                        Load more
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}

        <DialogFooter className="items-center sm:justify-between">
          <span className="truncate text-muted-foreground">
            {selected
              ? `${selected.filename} · ${formatFileSize(selected.file_size)}${
                  selected.width && selected.height ? ` · ${selected.width}×${selected.height}` : ""
                }`
              : ""}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={close}>
              {request.onSelect ? "Cancel" : "Close"}
            </Button>
            {request.onSelect && (
              <Button size="sm" disabled={!selected} onClick={() => selected && choose(selected)}>
                Use selected
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(next) => !next && !deleting && setDeleteTarget(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete file?</DialogTitle>
            <DialogDescription>
              “{deleteTarget?.filename}” will be permanently removed from the library and from
              storage. Files that are still used somewhere can’t be deleted.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <div role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">
              {deleteError}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" disabled={deleting} onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" disabled={deleting} onClick={() => void confirmDelete()}>
              {deleting ? <Spinner className="size-3" /> : null}
              {deleteError ? "Try again" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FolderChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      size="sm"
      variant={active ? "secondary" : "ghost"}
      role="tab"
      aria-selected={active}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function AssetTile({
  asset,
  selected,
  current,
  onSelect,
  onChoose,
  onDelete,
}: {
  asset: Asset;
  selected: boolean;
  current: boolean;
  onSelect: () => void;
  onChoose: () => void;
  onDelete: () => void;
}) {
  const src = thumbnailSrc(asset);
  const [broken, setBroken] = useState(false);

  return (
    <div
      className={`group relative aspect-square overflow-hidden rounded-md border bg-secondary/30 ${
        selected ? "ring-2 ring-primary" : ""
      }`}
    >
      <button
        type="button"
        className="absolute inset-0 flex items-center justify-center p-1"
        onClick={onSelect}
        onDoubleClick={onChoose}
        aria-pressed={selected}
        aria-label={asset.filename}
        title={asset.filename}
      >
        {src && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={asset.filename}
            loading="lazy"
            className="max-h-full max-w-full object-contain"
            onError={() => setBroken(true)}
          />
        ) : (
          <span className="text-center text-muted-foreground">
            <Icon name="image" className="mx-auto size-4" />
            <span className="block truncate">{broken ? "File unavailable" : asset.filename}</span>
          </span>
        )}
      </button>
      {current && (
        <span className="absolute top-1 left-1 rounded bg-primary px-1 text-[10px] text-primary-foreground">
          In use here
        </span>
      )}
      <Button
        size="icon-sm"
        variant="secondary"
        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label={`Delete ${asset.filename}`}
      >
        <Icon name="trash" className="size-3" />
      </Button>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-background/80 px-1 text-[10px]">
        {asset.filename}
      </div>
    </div>
  );
}
