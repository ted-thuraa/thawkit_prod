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

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import Icon, { type IconProps } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  UPLOAD_ACCEPT,
  validateUploadCandidate,
} from "@/lib/assets/upload-policy";
import { useUploadThing } from "@/lib/assets/uploadthing-client";
import {
  ASSET_CATEGORIES,
  buildSvgDataUrl,
  formatFileSize,
  getAssetIcon,
  getAssetProxyUrl,
  getOptimizedImageUrl,
  isAssetOfType,
  matchesCategoryFilter,
  normalizeCategoryFilter,
} from "@/lib/asset-utils";
import {
  flattenAssetFolderTree,
  hasChildFolders,
  type FlattenedAssetFolderNode,
} from "@/lib/assets/asset-folder-utils";
import type { AssetUsageSummary } from "@/lib/assets/asset-usage-summary";
import { describeUsages } from "@/lib/assets/delete-asset";
import {
  fetchRemixIcons,
  type RemixIcon,
  type RemixIconCategory,
} from "@/lib/assets/remix-icons";
import { sanitizeSvgForInline } from "@/lib/assets/svg-sanitizer";
import { assetFoldersApi, assetsApi } from "@/lib/editor/editor-asset-write-api";
import AssetFolderDialog from "./AssetFolderDialog";
import { useAssetsStore } from "@/stores/editor/useAssetsStore";
import { useEditorBootstrapStore } from "@/stores/editor/useEditorBootstrapStore";
import type { Asset, AssetCategory, AssetCategoryFilter } from "@/types/funnel";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";

const FILE_MANAGER_CATEGORY_OPTIONS: ReadonlyArray<{
  id: AssetCategory;
  label: string;
  icon: "icon" | "image";
}> = [
  { id: ASSET_CATEGORIES.ICONS, label: "Icons", icon: "icon" },
  { id: ASSET_CATEGORIES.IMAGES, label: "Images", icon: "image" },
  // Videos, audio and documents are intentionally not offered: the library only
  // accepts images and SVG (videos are external YouTube/Loom links, not files).
];

const PAGE_SIZE = 40;

/** Virtual folder IDs for the icon library tree */
const VIRTUAL_LIBRARIES_ID = "__libraries__";
const VIRTUAL_ICONS_ID = "__libraries-icons__";
const VIRTUAL_REMIX_ID = "__libraries-icons-remix__";
const REMIX_ICONS_PER_PAGE = 100;

/** All virtual folder IDs */
const VIRTUAL_FOLDER_IDS = new Set([
  VIRTUAL_LIBRARIES_ID,
  VIRTUAL_ICONS_ID,
  VIRTUAL_REMIX_ID,
]);
const isVirtualFolder = (id: string | null): boolean =>
  id !== null && VIRTUAL_FOLDER_IDS.has(id);

interface FileManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssetSelect?: (asset: Asset) => void | false;
  assetId?: string | null;
  category?: AssetCategoryFilter;
}

interface FolderRowProps {
  node: FlattenedAssetFolderNode;
  isSelected: boolean;
  hasChildren: boolean;
  isCollapsed: boolean;
  assetCount: number;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
}

function FolderRow({
  node,
  isSelected,
  hasChildren,
  isCollapsed,
  assetCount,
  onSelect,
  onToggle,
  onDelete,
  onEdit,
}: FolderRowProps) {
  return (
    <div className="relative">
      {/* Vertical connector lines */}
      {node.depth > 0 && (
        <>
          {Array.from({ length: node.depth }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "absolute z-10 top-0 bottom-0 w-px",
                isSelected ? "bg-white/30" : "bg-white/10",
              )}
              style={{
                left: `${i * 14 + 16}px`,
              }}
            />
          ))}
        </>
      )}

      {/* Main Row */}
      <div
        data-node-id={node.id}
        className={cn(
          "group relative flex items-center h-8 outline-none focus:outline-none rounded-lg cursor-pointer select-none",
          "hover:bg-secondary/50",
          isSelected && "bg-primary text-primary-foreground hover:bg-primary",
          !isSelected &&
            "text-secondary-foreground/80 dark:text-muted-foreground",
        )}
        style={{ paddingLeft: `${node.depth * 14 + 8}px` }}
        onClick={() => onSelect(node.id)}
      >
        {/* Expand/Collapse Button */}
        {hasChildren ? (
          <div
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
            className={cn(
              "w-4 h-4 flex items-center justify-center shrink-0 cursor-pointer",
              isCollapsed ? "" : "rotate-90",
            )}
          >
            <Icon
              name="chevronRight"
              className={cn("size-2.5 opacity-50", isSelected && "opacity-80")}
            />
          </div>
        ) : (
          <div className="w-4 h-4 shrink-0 flex items-center justify-center">
            <div
              className={cn(
                "ml-px w-1.5 h-px bg-white opacity-0",
                isSelected && "opacity-0",
              )}
            />
          </div>
        )}

        {/* Folder Icon */}
        <Icon
          name="folder"
          className={`size-3 ml-1 mr-2 ${isSelected ? "opacity-90" : "opacity-50"}`}
        />

        {/* Label */}
        <span className="grow text-xs font-medium overflow-hidden text-ellipsis whitespace-nowrap pointer-events-none">
          {node.data.name}
        </span>

        {/* Asset Count - shown when not hovering */}
        {assetCount > 0 && (
          <span
            className={cn(
              "text-xs mr-3 pointer-events-none shrink-0 group-hover:opacity-0",
              isSelected ? "opacity-80" : "opacity-60",
            )}
          >
            {assetCount}
          </span>
        )}

        {/* Options Menu - shown when hovering */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div
              className={cn(
                "size-5.75 opacity-0 group-hover:opacity-100 mr-1 p-0.5 rounded-sm backdrop-blur-sm hover:bg-secondary/80 cursor-pointer flex items-center justify-center",
                isSelected && "hover:bg-primary-foreground/20",
                assetCount > 0 ? "absolute right-0" : "",
              )}
            >
              <Icon name="dotsHorizontal" className="size-3" />
            </div>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="start" side="right" className="min-w-24">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onEdit(node.id);
              }}
            >
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onDelete(node.id);
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

interface FileGridItemProps {
  id: string;
  name: string;
  type: "folder" | "asset" | "uploading";
  onClick?: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
  onPreview?: () => void;
  // For bulk selection
  isSelected?: boolean;
  onSelectChange?: (selected: boolean) => void;
  // For assets
  mimeType?: string | null;
  imageUrl?: string | null;
  content?: string | null; // For inline SVG content
  // For uploading assets
  file?: File;
}

function FileGridItem({
  id,
  name,
  type,
  onClick,
  onDelete,
  onEdit,
  onPreview,
  isSelected = false,
  onSelectChange,
  mimeType,
  imageUrl,
  content,
  file,
}: FileGridItemProps) {
  const showMenu =
    (type === "folder" || type === "asset") &&
    (onDelete || onEdit || onPreview);
  const isUploading = type === "uploading";
  const isImage =
    type === "asset" && mimeType?.startsWith("image/") && (imageUrl || content);
  const showCheckbox = type === "asset" && onSelectChange !== undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", !isUploading && "group")}>
      <div
        className={cn(
          "relative aspect-square bg-secondary/30 rounded-md flex items-center justify-center overflow-hidden",
          !isUploading && "hover:bg-secondary/60 cursor-pointer",
          isSelected && "ring-2 ring-primary/75",
        )}
        onClick={!isUploading ? onClick : undefined}
      >
        {/* Checkbox - top left corner (only for assets) */}
        {showCheckbox && (
          <div
            className="absolute top-1.5 left-1.5 z-20"
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox
              checked={isSelected}
              onCheckedChange={(checked) => onSelectChange?.(checked === true)}
              className={cn(
                "bg-background/90 backdrop-blur border",
                isSelected ? "border-primary" : "border-foreground/10",
              )}
            />
          </div>
        )}

        {/* Folder Icon */}
        {type === "folder" && (
          <Icon name="folder" className="size-10 opacity-50" />
        )}

        {/* Asset Content */}
        {type === "asset" && (
          <>
            {(() => {
              const isIcon =
                content ||
                (mimeType && isAssetOfType(mimeType, ASSET_CATEGORIES.ICONS));
              const isImage =
                mimeType?.startsWith("image/") && !isIcon && imageUrl;
              const showCheckerboard = isIcon || isImage;

              if (isIcon || (mimeType?.startsWith("image/") && imageUrl)) {
                return (
                  <>
                    {/* Checkerboard pattern for transparency - only for images and icons */}
                    {showCheckerboard && (
                      <div className="absolute inset-0 opacity-10 bg-checkerboard" />
                    )}
                    {content ? (
                      // Inline SVG content (icon)
                      <div
                        data-icon
                        className="relative w-full h-full flex items-center justify-center p-5 pointer-events-none text-foreground z-10"
                        dangerouslySetInnerHTML={{ __html: content }}
                      />
                    ) : imageUrl ? (
                      // Image URL — small images stay at natural size and are centered;
                      // larger ones are constrained to fit the container.
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          className="relative max-w-full max-h-full object-contain pointer-events-none rounded-md z-10"
                          src={getOptimizedImageUrl(imageUrl)}
                          alt={name}
                          loading="lazy"
                        />
                      </>
                    ) : null}
                  </>
                );
              }
              return (
                <Icon
                  name={getAssetIcon(mimeType) as IconProps["name"]}
                  className="size-10 opacity-50"
                />
              );
            })()}
          </>
        )}

        {/* Uploading Asset Content */}
        {isUploading && file && (
          <>
            {(() => {
              const isIcon = isAssetOfType(file.type, ASSET_CATEGORIES.ICONS);
              const isImage = file.type.startsWith("image/") && !isIcon;
              const showCheckerboard = isIcon || isImage;

              return (
                <>
                  {/* Checkerboard pattern for transparency - only for images and icons */}
                  {showCheckerboard && (
                    <div className="absolute inset-0 opacity-10 bg-checkerboard" />
                  )}
                  {isIcon ? (
                    <>
                      <div className="relative w-full h-full flex items-center justify-center p-5 pointer-events-none text-foreground opacity-30 z-10">
                        <div className="w-full h-full flex items-center justify-center">
                          <Icon name="icon" className="size-15" />
                        </div>
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center bg-background/20 z-20">
                        <Spinner className="size-10 opacity-60" />
                      </div>
                    </>
                  ) : isImage ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        className="relative max-w-full max-h-full object-contain pointer-events-none opacity-40 z-10"
                        src={URL.createObjectURL(file)}
                        alt={name}
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-background/20 z-20">
                        <Spinner className="size-10 opacity-60" />
                      </div>
                    </>
                  ) : (
                    <>
                      <Icon
                        name={getAssetIcon(file.type) as IconProps["name"]}
                        className="size-10 opacity-30"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-background/20">
                        <Spinner className="size-10 opacity-60" />
                      </div>
                    </>
                  )}
                </>
              );
            })()}
          </>
        )}

        {/* Options Menu */}
        {showMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Options for ${name}`}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "absolute top-1.5 right-1.5 size-5.75 opacity-0 group-hover:opacity-80 focus-visible:opacity-100 p-0.5 rounded-sm bg-secondary/80 backdrop-blur-sm hover:bg-secondary cursor-pointer flex items-center justify-center z-20",
                )}
              >
                <Icon name="dotsHorizontal" className="size-3" />
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              align="start"
              side="bottom"
              className="min-w-24"
            >
              {onPreview && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onPreview();
                  }}
                >
                  Preview
                </DropdownMenuItem>
              )}
              {onEdit && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit();
                  }}
                >
                  Edit
                </DropdownMenuItem>
              )}
              {onDelete && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                >
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <span
        className="truncate max-w-full text-xs opacity-60 text-center"
        title={name}
      >
        {name}
      </span>
    </div>
  );
}

function FileGridHeader({
  children,
  isSticky = false,
}: {
  children: React.ReactNode;
  isSticky?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 min-h-14 shrink-0",
        isSticky &&
          "sticky top-0 z-30 bg-background before:absolute before:-top-px before:left-0 before:right-0 before:h-px before:bg-background",
      )}
    >
      {children}
    </div>
  );
}

const LoadMoreSentinel = React.forwardRef<HTMLDivElement>((_, ref) => (
  <div
    ref={ref}
    className="col-span-full flex items-center justify-center gap-1.5 py-8"
  >
    <Spinner className="size-3" />
    <span className="text-xs text-muted-foreground">
      Loading more results...
    </span>
  </div>
));
LoadMoreSentinel.displayName = "LoadMoreSentinel";

/** Preview source: stored file URL, else inline SVG as an (inert) data URL. */
function thumbnailSrc(asset: Asset): string | null {
  if (asset.public_url) return asset.public_url;
  if (asset.content) return buildSvgDataUrl(asset.content);
  return null;
}

export default function FileManagerDialog({
  open,
  onOpenChange,
  onAssetSelect,
  assetId,
  category,
}: FileManagerDialogProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [showCreateFolderDialog, setShowCreateFolderDialog] = useState(false);
  const [showEditFolderDialog, setShowEditFolderDialog] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState("");
  const [editFolderParentId, setEditFolderParentId] = useState<string | null>(
    null,
  );
  const [showDeleteConfirmDialog, setShowDeleteConfirmDialog] = useState(false);
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null);
  const [showDeleteAssetConfirmDialog, setShowDeleteAssetConfirmDialog] =
    useState(false);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const [assetUsage, setAssetUsage] = useState<AssetUsageSummary | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [showEditAssetDialog, setShowEditAssetDialog] = useState(false);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [editAssetName, setEditAssetName] = useState("");
  const [editAssetFolderId, setEditAssetFolderId] = useState<string | null>(
    null,
  );
  const [editAssetContent, setEditAssetContent] = useState<string | null>(null);
  const [isCreateSvgMode, setIsCreateSvgMode] = useState(false);
  const [isSavingAsset, setIsSavingAsset] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [uploadingAssets, setUploadingAssets] = useState<
    Array<{ id: string; filename: string; file: File }>
  >([]);
  const [searchQuery, setSearchQuery] = useState("");
  // Selected categories as array (null means 'all')
  const [selectedCategories, setSelectedCategories] = useState<
    AssetCategory[] | null
  >(() => normalizeCategoryFilter(category ?? null));

  // Update selectedCategories when category prop changes
  useEffect(() => {
    if (category !== undefined) {
      setSelectedCategories(normalizeCategoryFilter(category ?? null));
    }
  }, [category]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(
    new Set(),
  );
  const [showBulkMoveDialog, setShowBulkMoveDialog] = useState(false);
  const [bulkMoveTargetFolderId, setBulkMoveTargetFolderId] = useState<
    string | null
  >(null);
  const [showBulkDeleteConfirmDialog, setShowBulkDeleteConfirmDialog] =
    useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Remix Icons state
  const [remixIcons, setRemixIcons] = useState<RemixIcon[]>([]);
  const [remixCategories, setRemixCategories] = useState<RemixIconCategory[]>(
    [],
  );
  const [remixTotalIcons, setRemixTotalIcons] = useState(0);
  const [remixTotal, setRemixTotal] = useState(0);
  const [isLoadingRemixIcons, setIsLoadingRemixIcons] = useState(false);
  const [hasMoreRemixIcons, setHasMoreRemixIcons] = useState(true);
  const [remixCategory, setRemixCategory] = useState<string | undefined>(
    undefined,
  );
  const [remixStyle, setRemixStyle] = useState<"fill" | "line" | undefined>(
    undefined,
  );
  const remixLoadMoreRef = useRef<HTMLDivElement>(null);

  const isRemixIconsView = selectedFolderId === VIRTUAL_REMIX_ID;

  // Get folders and store actions
  const folders = useAssetsStore((state) => state.folders);
  const setFolders = useAssetsStore((state) => state.setFolders);
  const fetchAssets = useAssetsStore((state) => state.fetchAssets);
  const getAsset = useAssetsStore((state) => state.getAsset);
  const assetsById = useAssetsStore((state) => state.assetsById);
  const addFolder = useAssetsStore((state) => state.addFolder);
  const updateFolder = useAssetsStore((state) => state.updateFolder);
  const deleteFolder = useAssetsStore((state) => state.deleteFolder);
  const addAsset = useAssetsStore((state) => state.addAsset);
  const deleteAssetFromLibrary = useAssetsStore((state) => state.deleteAsset);
  const campaignId = useEditorBootstrapStore((state) => state.campaignId);
  // Direct-to-UploadThing upload (see src/app/api/uploadthing). The server
  // authenticates, verifies the real bytes and persists the asset row.
  const { startUpload } = useUploadThing("assetLibrary", {
    onUploadError: (error) => {
      toast.error("Upload failed", { description: error.message });
    },
  });
  const updateAsset = useAssetsStore((state) => state.updateAsset);
  const removeAsset = useAssetsStore((state) => state.removeAsset);

  // Pagination state
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [hasMoreAssets, setHasMoreAssets] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalAssets, setTotalAssets] = useState(0);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const ASSETS_PER_PAGE = 50;

  // Refs for stable IntersectionObserver callback (avoids recreating observer on every state change)
  const isLoadingAssetsRef = useRef(false);
  const hasMoreAssetsRef = useRef(true);
  const currentPageRef = useRef(1);

  // Get all descendant folder IDs for a folder (including the folder itself)
  const getAllDescendantFolderIds = useCallback(
    (folderId: string | null): string[] => {
      if (folderId === null) {
        // Root: return all folder IDs plus null for root assets
        return ["root", ...folders.map((f) => f.id)];
      }

      const descendants: string[] = [folderId];
      const children = folders.filter((f) => f.asset_folder_id === folderId);

      for (const child of children) {
        descendants.push(...getAllDescendantFolderIds(child.id));
      }

      return descendants;
    },
    [folders],
  );

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // --- Remix Icons fetching ---
  const isLoadingRemixRef = useRef(false);
  const hasMoreRemixRef = useRef(true);
  const remixIconsLengthRef = useRef(0);

  const loadRemixIcons = useCallback(
    async (offset: number, reset: boolean = false) => {
      if (isLoadingRemixRef.current && !reset) return;
      setIsLoadingRemixIcons(true);
      isLoadingRemixRef.current = true;

      try {
        const result = await fetchRemixIcons({
          search: debouncedSearch.trim() || undefined,
          category: remixCategory,
          style: remixStyle,
          limit: REMIX_ICONS_PER_PAGE,
          offset,
        });

        if (reset || offset === 0) {
          setRemixIcons(result.icons);
          remixIconsLengthRef.current = result.icons.length;
        } else {
          setRemixIcons((prev) => {
            const updated = [...prev, ...result.icons];
            remixIconsLengthRef.current = updated.length;
            return updated;
          });
        }

        setRemixTotal(result.total);
        setRemixCategories(result.categories);
        setRemixTotalIcons(result.totalIcons);
        const more = offset + result.icons.length < result.total;
        setHasMoreRemixIcons(more);
        hasMoreRemixRef.current = more;
      } catch (error) {
        toast.error("Couldn't load icons", {
          description: error instanceof Error ? error.message : undefined,
        });
      } finally {
        setIsLoadingRemixIcons(false);
        isLoadingRemixRef.current = false;
      }
    },
    [debouncedSearch, remixCategory, remixStyle],
  );

  // Reset and reload remix icons when search/filters change
  useEffect(() => {
    if (!isRemixIconsView) return;
    setRemixIcons([]);
    remixIconsLengthRef.current = 0;
    setHasMoreRemixIcons(true);
    hasMoreRemixRef.current = true;
    loadRemixIcons(0, true);
  }, [isRemixIconsView, debouncedSearch, remixCategory, remixStyle]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable ref to loadRemixIcons
  const loadRemixIconsRef = useRef(loadRemixIcons);
  loadRemixIconsRef.current = loadRemixIcons;

  // Infinite scroll for remix icons — recreated when icon count changes
  const remixObserverRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (!isRemixIconsView) return;

    remixObserverRef.current = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          hasMoreRemixRef.current &&
          !isLoadingRemixRef.current
        ) {
          loadRemixIconsRef.current(remixIconsLengthRef.current);
        }
      },
      { rootMargin: "0px 0px 500px 0px" },
    );

    if (remixLoadMoreRef.current) {
      remixObserverRef.current.observe(remixLoadMoreRef.current);
    }

    return () => {
      remixObserverRef.current?.disconnect();
      remixObserverRef.current = null;
    };
  }, [isRemixIconsView, remixIcons.length]);

  // Callback ref for remix sentinel
  const setRemixLoadMoreRef = useCallback((node: HTMLDivElement | null) => {
    if (remixLoadMoreRef.current && remixObserverRef.current) {
      remixObserverRef.current.unobserve(remixLoadMoreRef.current);
    }
    remixLoadMoreRef.current = node;
    if (node && remixObserverRef.current) {
      remixObserverRef.current.observe(node);
    }
  }, []);

  /** Open the Create SVG dialog pre-filled with a Remix Icon */
  const handleRemixIconClick = useCallback((icon: RemixIcon) => {
    setIsCreateSvgMode(true);
    setEditingAssetId(null);
    setEditAssetName(icon.name);
    setEditAssetFolderId(null);
    setEditAssetContent(icon.svg);
    setShowEditAssetDialog(true);
  }, []);

  // Load assets when folder, search, or category changes
  const loadAssets = useCallback(
    async (page: number, reset: boolean = false) => {
      if (isLoadingAssetsRef.current && !reset) return;

      setIsLoadingAssets(true);
      isLoadingAssetsRef.current = true;

      try {
        // Build folder IDs for search (include descendants)
        let folderIds: string[] | undefined;
        let folderId: string | null | undefined;

        if (debouncedSearch.trim()) {
          // Search mode: include current folder and all descendants
          folderIds = getAllDescendantFolderIds(selectedFolderId);
        } else {
          // Normal mode: only current folder
          folderId = selectedFolderId;
        }

        let currentFetchPage = page;
        let hasMore = true;

        // When category filtering is active, pages may yield zero matching results.
        // Keep fetching subsequent pages until we find matches or the server is exhausted.
        let isFirstPage = reset || page === 1;

        while (hasMore) {
          const result = await fetchAssets({
            folderId,
            folderIds,
            search: debouncedSearch.trim() || undefined,
            page: currentFetchPage,
            limit: ASSETS_PER_PAGE,
          });

          hasMore = result.hasMore;

          // Filter by category client-side (since category is UI-specific)
          let filteredAssets = result.assets;
          if (selectedCategories !== null) {
            filteredAssets = result.assets.filter((asset) =>
              matchesCategoryFilter(asset.mime_type, selectedCategories),
            );
          }

          if (isFirstPage) {
            setAssets(filteredAssets);
            isFirstPage = false;
          } else if (filteredAssets.length > 0) {
            setAssets((prev) => {
              const existingIds = new Set(prev.map((a) => a.id));
              const newAssets = filteredAssets.filter(
                (a) => !existingIds.has(a.id),
              );
              return [...prev, ...newAssets];
            });
          }

          setTotalAssets(result.total);
          setHasMoreAssets(hasMore);
          hasMoreAssetsRef.current = hasMore;
          setCurrentPage(currentFetchPage);
          currentPageRef.current = currentFetchPage;

          // Stop if we found matching results or the server has no more
          if (filteredAssets.length > 0 || !hasMore) break;

          currentFetchPage++;
        }
      } catch (error) {
        toast.error("Couldn't load assets", {
          description: error instanceof Error ? error.message : undefined,
        });
      } finally {
        setIsLoadingAssets(false);
        isLoadingAssetsRef.current = false;
      }
    },
    [
      fetchAssets,
      selectedFolderId,
      debouncedSearch,
      selectedCategories,
      getAllDescendantFolderIds,
    ],
  );

  // Reset and reload when folder, search, or category changes (skip for virtual folders)
  useEffect(() => {
    if (isVirtualFolder(selectedFolderId)) return;
    setAssets([]);
    setCurrentPage(1);
    currentPageRef.current = 1;
    setHasMoreAssets(true);
    hasMoreAssetsRef.current = true;
    loadAssets(1, true);
  }, [selectedFolderId, debouncedSearch, selectedCategories]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable ref to loadAssets so the observer callback never goes stale
  const loadAssetsRef = useRef(loadAssets);
  loadAssetsRef.current = loadAssets;

  // Infinite scroll observer — recreated when currentPage changes so it re-evaluates
  // sentinel visibility after each load. Ref-based guards prevent double-firing.
  const assetsObserverRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (isVirtualFolder(selectedFolderId)) return;

    assetsObserverRef.current = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          hasMoreAssetsRef.current &&
          !isLoadingAssetsRef.current
        ) {
          loadAssetsRef.current(currentPageRef.current + 1);
        }
      },
      { rootMargin: "0px 0px 300px 0px" },
    );

    if (loadMoreRef.current) {
      assetsObserverRef.current.observe(loadMoreRef.current);
    }

    return () => {
      assetsObserverRef.current?.disconnect();
      assetsObserverRef.current = null;
    };
  }, [selectedFolderId, currentPage]);

  // Callback ref for the sentinel: observe/unobserve as it mounts/unmounts
  const setLoadMoreRef = useCallback((node: HTMLDivElement | null) => {
    // Unobserve the previous node
    if (loadMoreRef.current && assetsObserverRef.current) {
      assetsObserverRef.current.unobserve(loadMoreRef.current);
    }
    loadMoreRef.current = node;
    // Observe the new node
    if (node && assetsObserverRef.current) {
      assetsObserverRef.current.observe(node);
    }
  }, []);

  // Get uploading assets for the current folder
  const currentUploadingAssets = useMemo(() => {
    return uploadingAssets;
  }, [uploadingAssets]);

  // Get child folders for the selected folder
  const childFolders = useMemo(() => {
    return folders.filter(
      (folder) => folder.asset_folder_id === selectedFolderId,
    );
  }, [folders, selectedFolderId]);

  // Per-folder file counts for the sidebar badges. These come from the server
  // (a count over ALL files, `"root"` = unassigned) rather than from whichever
  // assets happen to be loaded in the cache, and are refreshed after every
  // mutation that can change them.
  const [folderAssetCounts, setFolderAssetCounts] = useState<Record<string, number>>({});
  const refreshFolderCounts = useCallback(async () => {
    const response = await assetsApi.getFolderCounts();
    if (response.error === undefined) setFolderAssetCounts(response.data);
  }, []);
  useEffect(() => {
    if (open) void refreshFolderCounts();
  }, [open, refreshFolderCounts]);

  // Build flattened folder tree with virtual "All Files" root
  const flattenedFolders = useMemo(() => {
    const virtualRoot: FlattenedAssetFolderNode = {
      id: "root",
      data: {
        id: "root",
        asset_folder_id: null,
        name: "All files",
        depth: 0,
        order: 0,
        is_published: false,
        created_at: "",
        updated_at: "",
        deleted_at: null,
      },
      depth: 0,
      parentId: null,
      index: 0,
    };

    // If root is collapsed, only show the root
    if (collapsedIds.has("root")) {
      return [virtualRoot];
    }

    // Flatten actual folders starting at depth 1
    const actualFolders = flattenAssetFolderTree(
      folders,
      null,
      collapsedIds,
      1,
    );

    return [virtualRoot, ...actualFolders];
  }, [folders, collapsedIds]);

  const handleToggle = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // A selected folder that no longer exists (deleted elsewhere / stale
  // reference) must not leave the view pointing at nothing: fall back to the
  // "All files" root.
  useEffect(() => {
    if (
      selectedFolderId &&
      !isVirtualFolder(selectedFolderId) &&
      !folders.some((f) => f.id === selectedFolderId)
    ) {
      setSelectedFolderId(null);
    }
  }, [selectedFolderId, folders]);

  // Clear selection when folder changes or dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedAssetIds(new Set());
    }
  }, [open]);

  useEffect(() => {
    setSelectedAssetIds(new Set());
  }, [selectedFolderId]);

  // Navigate to the asset's folder only once per open session, so manual
  // folder navigation isn't reset when the asset cache (assetsById) updates
  const hasNavigatedToAssetRef = useRef(false);

  useEffect(() => {
    if (!open) {
      hasNavigatedToAssetRef.current = false;
    }
  }, [open]);

  // When dialog opens with an assetId, navigate to that asset's folder
  useEffect(() => {
    if (open && assetId && !hasNavigatedToAssetRef.current) {
      const asset = assetsById[assetId] || getAsset(assetId);
      if (asset) {
        hasNavigatedToAssetRef.current = true;
        const assetFolderId = asset.asset_folder_id || null;

        // Set the folder as selected
        setSelectedFolderId(assetFolderId);

        // Expand all parent folders to show the asset's folder
        if (assetFolderId) {
          const expandParentFolders = (folderId: string | null) => {
            if (!folderId) return;

            const folder = folders.find((f) => f.id === folderId);
            if (folder) {
              // Expand this folder
              setCollapsedIds((prev) => {
                const next = new Set(prev);
                next.delete(folderId);
                return next;
              });

              // Recursively expand parent folders
              if (folder.asset_folder_id) {
                expandParentFolders(folder.asset_folder_id);
              }
            }
          };

          expandParentFolders(assetFolderId);
        }
      }
    }
  }, [open, assetId, assetsById, getAsset, folders]);

  // Build breadcrumb path from root to selected folder
  const breadcrumbPath = useMemo(() => {
    const path: Array<{ id: string | null; name: string }> = [
      { id: null, name: "All files" },
    ];

    if (selectedFolderId) {
      const buildPath = (folderId: string): void => {
        const folder = folders.find((f) => f.id === folderId);
        if (folder) {
          if (folder.asset_folder_id) {
            buildPath(folder.asset_folder_id);
          }
          path.push({ id: folder.id, name: folder.name });
        }
      };

      buildPath(selectedFolderId);
    }

    return path;
  }, [selectedFolderId, folders]);

  // Build full path for a folder (for select dropdown)
  const buildFolderPath = useCallback(
    (folderId: string | null): string => {
      if (!folderId) return "All files";

      const pathParts: string[] = [];
      let currentId: string | null = folderId;

      while (currentId) {
        const folder = folders.find((f) => f.id === currentId);
        if (!folder) break;
        pathParts.unshift(folder.name);
        currentId = folder.asset_folder_id;
      }

      return `All files / ${pathParts.join(" / ")}`;
    },
    [folders],
  );

  // Create a regular folder. It is persisted server-side first; the sidebar
  // updates from the server's response (no reload), and a failure is reported
  // instead of closing the dialog as if it had worked.
  const handleCreateFolder = async (
    folderName: string,
    parentFolderId: string | null,
  ): Promise<boolean> => {
    const response = await assetFoldersApi.create({
      name: folderName,
      parentId: parentFolderId,
    });
    if (response.error !== undefined) {
      toast.error("Unable to create folder", { description: response.error });
      return false;
    }
    addFolder(response.data);
    // Auto-expand the parent (or the virtual "All files" root) so it is visible
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      next.delete(parentFolderId ?? "root");
      return next;
    });
    return true;
  };

  // Show delete confirmation
  const handleDeleteFolder = (id: string) => {
    setDeletingFolderId(id);
    setShowDeleteConfirmDialog(true);
  };

  // Get all descendant folder IDs recursively (for UI calculations only)
  const getDescendantFolderIds = (folderId: string): string[] => {
    const children = folders.filter((f) => f.asset_folder_id === folderId);
    const descendants: string[] = children.map((c) => c.id);

    for (const child of children) {
      descendants.push(...getDescendantFolderIds(child.id));
    }

    return descendants;
  };

  // Confirm delete folder. The server deletes the folder, its subfolders and
  // the files inside — or refuses while one of those files is still used; the
  // UI only changes after the server confirmed.
  const handleConfirmDeleteFolder = async () => {
    if (!deletingFolderId) return;
    const folderBeingDeleted = folders.find((f) => f.id === deletingFolderId);
    const parentFolderId = folderBeingDeleted?.asset_folder_id || null;

    try {
      const deletedFolderIds = await deleteFolder(deletingFolderId);

      // If the deleted folder (or a descendant) was open, go to its parent
      if (selectedFolderId && deletedFolderIds.includes(selectedFolderId)) {
        setSelectedFolderId(parentFolderId);
      }
      setAssets((prev) =>
        prev.filter(
          (a) =>
            !a.asset_folder_id || !deletedFolderIds.includes(a.asset_folder_id),
        ),
      );
      toast.success("Folder deleted");
      void refreshFolderCounts();
    } catch (error) {
      toast.error("Unable to delete folder", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setDeletingFolderId(null);
    }
  };

  // Start editing folder
  const handleEditFolder = (id: string) => {
    const folder = folders.find((f) => f.id === id);
    if (folder) {
      setEditingFolderId(id);
      setEditFolderName(folder.name);
      setEditFolderParentId(folder.asset_folder_id);
      setShowEditFolderDialog(true);
    }
  };

  // Confirm folder edit (rename and/or move). The server also rewrites the
  // stored depth of the moved branch; we mirror its result in the store.
  const handleConfirmEdit = async (
    newName: string,
    newParentFolderId: string | null,
  ): Promise<boolean> => {
    if (!editingFolderId) return false;
    const folder = folders.find((f) => f.id === editingFolderId);
    const parentChanged = newParentFolderId !== (folder?.asset_folder_id ?? null);

    const response = await assetFoldersApi.update(editingFolderId, {
      name: newName,
      ...(parentChanged ? { parentId: newParentFolderId } : {}),
    });
    if (response.error !== undefined) {
      toast.error("Unable to update folder", { description: response.error });
      return false;
    }

    const { folder: saved, depths } = response.data;
    updateFolder(editingFolderId, saved);
    for (const [id, depth] of Object.entries(depths)) {
      if (id !== saved.id) updateFolder(id, { depth });
    }
    setEditingFolderId(null);
    setEditFolderName("");
    setEditFolderParentId(null);

    if (parentChanged) {
      setCollapsedIds((prev) => {
        const next = new Set(prev);
        next.delete(newParentFolderId ?? "root");
        return next;
      });
    }
    return true;
  };

  // Show delete asset confirmation, with where the file is used
  const handleDeleteAsset = async (id: string) => {
    setDeletingAssetId(id);
    setAssetUsage(null);
    setLoadingUsage(true);
    setShowDeleteAssetConfirmDialog(true);

    const response = await assetsApi.getUsage(id);
    if (response.error === undefined) {
      setAssetUsage(response.data);
    } else {
      toast.error("Couldn't check where this file is used", {
        description: response.error,
      });
    }
    setLoadingUsage(false);
  };

  // Confirm delete asset. Not optimistic: the file leaves the UI only after
  // the server removed the stored object AND the record. A file that is still
  // used is refused (the dialog already lists where).
  const handleConfirmDeleteAsset = async () => {
    if (!deletingAssetId) return;
    const id = deletingAssetId;
    const result = await deleteAssetFromLibrary(id);
    if (result.ok) {
      setAssets((prev) => prev.filter((a) => a.id !== id));
      setTotalAssets((prev) => Math.max(0, prev - 1));
      setSelectedAssetIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast.success("Asset deleted");
      void refreshFolderCounts();
    } else {
      toast.error(result.inUse ? "This file is still in use" : "Unable to delete asset", {
        description: result.error,
      });
    }
    setDeletingAssetId(null);
    setAssetUsage(null);
  };

  // Bulk delete. Every file is checked and removed on its own server-side and
  // reported individually: files still in use (or failing) are KEPT and named.
  const handleBulkDelete = async () => {
    if (selectedAssetIds.size === 0) return;
    const ids = Array.from(selectedAssetIds);

    const response = await assetsApi.bulkDelete(ids);
    if (response.error !== undefined) {
      toast.error("Failed to delete assets", { description: response.error });
      return;
    }

    const { deleted, inUse, failed } = response.data;
    deleted.forEach((id) => removeAsset(id));
    setAssets((prev) => prev.filter((a) => !deleted.includes(a.id)));
    setTotalAssets((prev) => Math.max(0, prev - deleted.length));
    // Whatever was not deleted stays selected so the user can see/act on it
    setSelectedAssetIds(new Set(ids.filter((id) => !deleted.includes(id))));
    void refreshFolderCounts();

    if (inUse.length > 0 || failed.length > 0) {
      const first = inUse[0];
      toast.error(`${deleted.length} deleted, ${inUse.length + failed.length} kept`, {
        description: first
          ? `“${first.filename}” is still used by ${describeUsages(first.usages)}.`
          : failed[0]?.error,
      });
    } else {
      toast.success(deleted.length === 1 ? "Asset deleted" : `${deleted.length} assets deleted`);
    }
  };

  // Bulk move (target `null` = All files). Persisted first, then reflected.
  const handleBulkMove = async (targetFolderId: string | null) => {
    if (selectedAssetIds.size === 0) return;
    const ids = Array.from(selectedAssetIds);

    const response = await assetsApi.move(ids, targetFolderId);
    if (response.error !== undefined) {
      toast.error("Failed to move assets", { description: response.error });
      return;
    }

    const moved = new Set(response.data.movedIds);
    moved.forEach((id) => updateAsset(id, { asset_folder_id: targetFolderId }));
    if (targetFolderId !== selectedFolderId) {
      setAssets((prev) => prev.filter((a) => !moved.has(a.id)));
      setTotalAssets((prev) => Math.max(0, prev - moved.size));
    }
    setSelectedAssetIds(new Set());
    setShowBulkMoveDialog(false);
    void refreshFolderCounts();

    if (moved.size < ids.length) {
      toast.error("Some assets could not be moved", {
        description: `${moved.size} moved, ${ids.length - moved.size} no longer exist`,
      });
    }
  };

  const handlePreviewAsset = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  // Start creating SVG
  const handleCreateSvg = () => {
    setIsCreateSvgMode(true);
    setEditingAssetId(null);
    setEditAssetName("");
    setEditAssetFolderId(
      isVirtualFolder(selectedFolderId) ? null : selectedFolderId,
    );
    setEditAssetContent("");
    setShowEditAssetDialog(true);
  };

  // Start editing asset
  const handleEditAsset = (id: string) => {
    setIsCreateSvgMode(false);
    const asset = assetsById[id] || assets.find((a) => a.id === id);
    if (asset) {
      setEditingAssetId(id);
      setEditAssetName(asset.filename);
      setEditAssetFolderId(asset.asset_folder_id || null);
      setEditAssetContent(asset.content || null);
      setShowEditAssetDialog(true);
    }
  };

  // Create a custom SVG icon asset (typed/pasted markup or a library icon).
  // The server sanitizes the markup; a rejected SVG keeps the dialog open.
  const handleCreateSvgAsset = async (
    name: string,
    folderId: string | null,
    content: string,
  ): Promise<boolean> => {
    if (!name.trim() || !content.trim()) return false;

    const response = await assetsApi.createSvg({ name, folderId, content });
    if (response.error !== undefined) {
      toast.error("Unable to create SVG icon", { description: response.error });
      return false;
    }

    const created = response.data;
    addAsset(created);
    // Show it right away when it belongs to the folder being viewed
    if ((created.asset_folder_id ?? null) === selectedFolderId) {
      setAssets((prev) =>
        prev.some((a) => a.id === created.id) ? prev : [created, ...prev],
      );
      setTotalAssets((prev) => prev + 1);
    }
    setEditAssetName("");
    setEditAssetFolderId(null);
    setEditAssetContent(null);
    toast.success("SVG icon created");
    void refreshFolderCounts();
    return true;
  };

  // Save from the edit / new-SVG dialog. Resolves true when it succeeded.
  const handleConfirmEditAsset = async (
    newName: string,
    newFolderId: string | null,
    newContent?: string | null,
  ): Promise<boolean> => {
    if (isCreateSvgMode) {
      return handleCreateSvgAsset(newName, newFolderId, newContent ?? "");
    }
    if (!editingAssetId || !newName.trim()) return false;

    const original =
      assetsById[editingAssetId] || assets.find((a) => a.id === editingAssetId);
    if (!original) return false;

    const patch: { filename?: string; folderId?: string | null; content?: string } = {};
    if (newName !== original.filename) patch.filename = newName;
    const folderChanged = newFolderId !== (original.asset_folder_id ?? null);
    if (folderChanged) patch.folderId = newFolderId;
    // Markup of an UPLOADED svg mirrors its stored file and isn't editable
    if (newContent != null && !original.storage_path && newContent !== original.content) {
      patch.content = newContent;
    }

    if (Object.keys(patch).length > 0) {
      const response = await assetsApi.update(editingAssetId, patch);
      if (response.error !== undefined) {
        toast.error("Unable to update asset", { description: response.error });
        return false;
      }
      updateAsset(editingAssetId, response.data);
      if (folderChanged) void refreshFolderCounts();
      const saved = response.data;
      setAssets((prev) =>
        folderChanged && newFolderId !== selectedFolderId
          ? prev.filter((a) => a.id !== saved.id)
          : prev.map((a) => (a.id === saved.id ? saved : a)),
      );
    }

    setEditingAssetId(null);
    setEditAssetName("");
    setEditAssetFolderId(null);
    setEditAssetContent(null);
    return true;
  };

  // Used by the Enter key and the Save/Create button: awaits the result and
  // only closes the dialog when it worked (so errors never vanish with it).
  const submitEditAsset = async () => {
    if (isSavingAsset) return;
    setIsSavingAsset(true);
    try {
      const ok = await handleConfirmEditAsset(
        editAssetName,
        editAssetFolderId,
        editAssetContent,
      );
      if (ok) setShowEditAssetDialog(false);
    } finally {
      setIsSavingAsset(false);
    }
  };

  // Handle file upload button click
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  // Selection handlers
  const handleAssetSelect = (assetId: string, selected: boolean) => {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(assetId);
      } else {
        next.delete(assetId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedAssetIds.size === assets.length) {
      setSelectedAssetIds(new Set());
    } else {
      setSelectedAssetIds(new Set(assets.map((asset) => asset.id)));
    }
  };

  const handleClearSelection = () => {
    setSelectedAssetIds(new Set());
  };

  // Handle file selection → UploadThing. The server re-verifies the real bytes
  // and persists the row; an asset is shown only from that confirmed response.
  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const picked = Array.from(event.target.files ?? []);
    const resetInput = () => {
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    if (picked.length === 0) return;
    if (!campaignId) {
      toast.error("The editor is still loading.");
      resetInput();
      return;
    }

    // Fast pre-checks for friendly messages (not the security boundary)
    const accepted: File[] = [];
    for (const file of picked) {
      const problem = validateUploadCandidate(file);
      if (problem) toast.error("Can't upload this file", { description: problem });
      else accepted.push(file);
    }
    if (accepted.length === 0) {
      resetInput();
      return;
    }

    setIsUploading(true);
    setUploadProgress({ current: 0, total: accepted.length });
    setUploadingAssets(
      accepted.map((file) => ({
        id: `temp-${Math.random().toString(36).slice(2, 11)}`,
        filename: file.name,
        file,
      })),
    );

    try {
      const targetFolderId = isVirtualFolder(selectedFolderId) ? null : selectedFolderId;
      const results = await startUpload(accepted, { campaignId, folderId: targetFolderId });
      // `undefined` = the upload failed and onUploadError already told the user

      const uploaded = (results ?? [])
        .map((r) => (r.serverData as { asset?: Asset } | null)?.asset)
        .filter((a): a is Asset => !!a);

      uploaded.forEach((asset) => addAsset(asset));
      const visible = uploaded.filter(
        (a) => (a.asset_folder_id ?? null) === targetFolderId,
      );
      if (visible.length > 0) {
        setAssets((prev) => [
          ...visible.filter((v) => !prev.some((p) => p.id === v.id)),
          ...prev,
        ]);
        setTotalAssets((prev) => prev + visible.length);
      }
      if (uploaded.length > 0) {
        void refreshFolderCounts();
        toast.success(
          uploaded.length === 1 ? `Uploaded ${uploaded[0].filename}` : `Uploaded ${uploaded.length} files`,
        );
      }
    } catch (error) {
      toast.error("Upload failed", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
      setUploadingAssets([]);
      resetInput();
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          width="1200px"
          className="h-[80vh]"
          aria-describedby={undefined}
        >
          <DialogHeader className="-mt-8.75">
            <DialogTitle className="sr-only">File Manager</DialogTitle>

            <div className="flex items-center justify-between gap-2 pr-7 -ml-2.5">
              <div className="flex items-center gap-2 flex-1">
                <div className="flex-1">
                  <InputGroup>
                    <InputGroupAddon>
                      <Icon name="search" className="size-3" />
                    </InputGroupAddon>

                    <InputGroupInput
                      placeholder="Search..."
                      autoFocus={false}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      autoComplete="off"
                    />

                    {searchQuery.trim() && (
                      <InputGroupAddon align="inline-end">
                        <button
                          onClick={() => setSearchQuery("")}
                          className="size-6 transition-opacity flex items-center justify-center cursor-pointer rounded-sm hover:bg-secondary/80"
                          aria-label="Clear search"
                        >
                          <Icon name="x" className="size-3" />
                        </button>
                      </InputGroupAddon>
                    )}
                  </InputGroup>
                </div>

                {/* Category filter multi-select */}
                <Popover modal>
                  <PopoverTrigger asChild>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-35 justify-between gap-1 font-normal"
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        {selectedCategories === null ||
                        selectedCategories.length === 0 ? (
                          <>
                            <Icon
                              name="layers"
                              className="size-3 shrink-0 text-muted-foreground"
                            />
                            <span className="truncate">All types</span>
                          </>
                        ) : (
                          <>
                            {selectedCategories.map((c) => {
                              const opt = FILE_MANAGER_CATEGORY_OPTIONS.find(
                                (o) => o.id === c,
                              );
                              return opt ? (
                                <Icon
                                  key={c}
                                  name={opt.icon}
                                  className="size-3 shrink-0 text-muted-foreground"
                                />
                              ) : null;
                            })}
                            <span className="truncate">
                              {selectedCategories
                                .map(
                                  (c) =>
                                    FILE_MANAGER_CATEGORY_OPTIONS.find(
                                      (o) => o.id === c,
                                    )?.label,
                                )
                                .filter(Boolean)
                                .join(", ")}
                            </span>
                          </>
                        )}
                      </span>
                      <Icon
                        name="chevronDown"
                        className="size-2.5 opacity-50 shrink-0"
                      />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="min-w-35 w-auto p-1" align="start">
                    <div className="flex flex-col">
                      <label
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs cursor-pointer hover:bg-accent",
                          selectedCategories === null && "bg-accent",
                        )}
                      >
                        <Checkbox
                          checked={selectedCategories === null}
                          onCheckedChange={(checked) => {
                            if (checked) setSelectedCategories(null);
                          }}
                        />
                        <Icon
                          name="layers"
                          className="size-3 text-muted-foreground"
                        />
                        All types
                      </label>
                      {FILE_MANAGER_CATEGORY_OPTIONS.map(
                        ({ id, label, icon }) => {
                          // Only show checked if explicitly selected (not when "All" is selected)
                          const checked =
                            selectedCategories !== null &&
                            selectedCategories.includes(id);
                          return (
                            <label
                              key={id}
                              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs cursor-pointer hover:bg-accent"
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(c) => {
                                  setSelectedCategories((prev) => {
                                    if (prev === null) {
                                      // Was "All", now select only this category
                                      return [id];
                                    }
                                    if (c) {
                                      return prev.includes(id)
                                        ? prev
                                        : [...prev, id];
                                    }
                                    const next = prev.filter((x) => x !== id);
                                    return next.length === 0 ? null : next;
                                  });
                                }}
                              />
                              <Icon
                                name={icon}
                                className="size-3 text-muted-foreground"
                              />
                              {label}
                            </label>
                          );
                        },
                      )}
                    </div>
                  </PopoverContent>
                </Popover>

                <Separator
                  orientation="vertical"
                  className="h-7! shrink-0 mx-0.5"
                />
              </div>

              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={handleCreateSvg}>
                  <Icon name="icon" />
                  SVG
                </Button>
                <Button
                  size="sm"
                  onClick={handleUploadClick}
                  disabled={isUploading}
                >
                  <Icon name="upload" />
                  Upload
                </Button>
              </div>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={UPLOAD_ACCEPT}
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          </DialogHeader>

          <div className="flex-1 flex -my-6 -mx-6 overflow-hidden">
            {/* Folder Sidebar */}
            <div className="w-64 border-r h-full overflow-y-auto px-4">
              <header className="py-5 flex justify-between">
                <span className="font-medium">File manager</span>
                <div className="-my-1">
                  <Button
                    size="xs"
                    variant="secondary"
                    aria-label="New folder"
                    title="New folder"
                    onClick={() => {
                      // Expand selected folder when creating a child
                      if (selectedFolderId) {
                        setCollapsedIds((prev) => {
                          const next = new Set(prev);
                          next.delete(selectedFolderId);
                          return next;
                        });
                      } else {
                        // Expand root if creating at root level
                        setCollapsedIds((prev) => {
                          const next = new Set(prev);
                          next.delete("root");
                          return next;
                        });
                      }
                      setShowCreateFolderDialog(true);
                    }}
                  >
                    <Icon name="plus" />
                  </Button>
                </div>
              </header>
              <div className="space-y-0">
                {flattenedFolders.map((folder) => {
                  // Virtual root gets special treatment
                  if (folder.id === "root") {
                    const hasRootChildren = folders.some(
                      (f) => f.asset_folder_id === null,
                    );
                    const isRootCollapsed = collapsedIds.has("root");

                    return (
                      <div
                        key="root"
                        className={cn(
                          "group relative flex items-center h-8 outline-none focus:outline-none rounded-lg cursor-pointer select-none",
                          "hover:bg-secondary/50",
                          selectedFolderId === null &&
                            "bg-primary text-primary-foreground hover:bg-primary",
                          selectedFolderId !== null &&
                            "text-secondary-foreground/80 dark:text-muted-foreground",
                        )}
                        style={{ paddingLeft: "8px" }}
                        onClick={() => setSelectedFolderId(null)}
                      >
                        {/* Expand/Collapse Button */}
                        {hasRootChildren ? (
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggle("root");
                            }}
                            className={cn(
                              "w-4 h-4 flex items-center justify-center shrink-0 cursor-pointer",
                              isRootCollapsed ? "" : "rotate-90",
                            )}
                          >
                            <Icon
                              name="chevronRight"
                              className={cn(
                                "size-2.5 opacity-50",
                                selectedFolderId === null && "opacity-80",
                              )}
                            />
                          </div>
                        ) : (
                          <div className="w-4 h-4 shrink-0 flex items-center justify-center">
                            <div
                              className={cn(
                                "ml-px w-1.5 h-px bg-white opacity-0",
                                selectedFolderId === null && "opacity-0",
                              )}
                            />
                          </div>
                        )}

                        {/* Folder Icon */}
                        <Icon
                          name="folder"
                          className={`size-3 ml-1 mr-2 ${selectedFolderId === null ? "opacity-90" : "opacity-50"}`}
                        />

                        {/* Label */}
                        <span className="grow text-xs font-medium overflow-hidden text-ellipsis whitespace-nowrap pointer-events-none">
                          All files
                        </span>

                        {/* Asset Count - shown when not hovering */}
                        {(folderAssetCounts["root"] || 0) > 0 && (
                          <span
                            className={cn(
                              "text-xs mr-3 pointer-events-none shrink-0 group-hover:opacity-0",
                              selectedFolderId === null
                                ? "opacity-70"
                                : "opacity-40",
                            )}
                          >
                            {folderAssetCounts["root"] || 0}
                          </span>
                        )}
                      </div>
                    );
                  }

                  return (
                    <FolderRow
                      key={folder.id}
                      node={folder}
                      isSelected={folder.id === selectedFolderId}
                      hasChildren={hasChildFolders(folder.id, folders)}
                      isCollapsed={collapsedIds.has(folder.id)}
                      assetCount={folderAssetCounts[folder.id] || 0}
                      onSelect={setSelectedFolderId}
                      onToggle={handleToggle}
                      onDelete={handleDeleteFolder}
                      onEdit={handleEditFolder}
                    />
                  );
                })}

                {/* Virtual Libraries tree: Libraries > Icons > Remix */}
                <div className="mt-4">
                  {/* Libraries */}
                  {(() => {
                    const isLibrariesCollapsed =
                      collapsedIds.has(VIRTUAL_LIBRARIES_ID);
                    const isLibrariesSelected =
                      selectedFolderId === VIRTUAL_LIBRARIES_ID;

                    return (
                      <>
                        <div
                          className={cn(
                            "group relative flex items-center h-8 outline-none focus:outline-none rounded-lg cursor-pointer select-none",
                            "hover:bg-secondary/50",
                            isLibrariesSelected &&
                              "bg-primary text-primary-foreground hover:bg-primary",
                            !isLibrariesSelected &&
                              "text-secondary-foreground/80 dark:text-muted-foreground",
                          )}
                          style={{ paddingLeft: "8px" }}
                          onClick={() => {
                            setSelectedFolderId(VIRTUAL_LIBRARIES_ID);
                            setCollapsedIds((prev) => {
                              const next = new Set(prev);
                              next.delete(VIRTUAL_LIBRARIES_ID);
                              return next;
                            });
                          }}
                        >
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggle(VIRTUAL_LIBRARIES_ID);
                            }}
                            className={cn(
                              "w-4 h-4 flex items-center justify-center shrink-0 cursor-pointer",
                              isLibrariesCollapsed ? "" : "rotate-90",
                            )}
                          >
                            <Icon
                              name="chevronRight"
                              className={cn(
                                "size-2.5 opacity-50",
                                isLibrariesSelected && "opacity-80",
                              )}
                            />
                          </div>
                          <Icon
                            name="layers"
                            className={`size-3 ml-1 mr-2 ${isLibrariesSelected ? "opacity-90" : "opacity-50"}`}
                          />
                          <span className="grow text-xs font-medium overflow-hidden text-ellipsis whitespace-nowrap pointer-events-none">
                            Libraries
                          </span>
                        </div>

                        {/* Icons (child of Libraries) */}
                        {!isLibrariesCollapsed &&
                          (() => {
                            const isIconsCollapsed =
                              collapsedIds.has(VIRTUAL_ICONS_ID);
                            const isIconsSelected =
                              selectedFolderId === VIRTUAL_ICONS_ID;

                            return (
                              <>
                                <div
                                  className={cn(
                                    "group relative flex items-center h-8 outline-none focus:outline-none rounded-lg cursor-pointer select-none",
                                    "hover:bg-secondary/50",
                                    isIconsSelected &&
                                      "bg-primary text-primary-foreground hover:bg-primary",
                                    !isIconsSelected &&
                                      "text-secondary-foreground/80 dark:text-muted-foreground",
                                  )}
                                  style={{ paddingLeft: "22px" }}
                                  onClick={() => {
                                    setSelectedFolderId(VIRTUAL_ICONS_ID);
                                    setCollapsedIds((prev) => {
                                      const next = new Set(prev);
                                      next.delete(VIRTUAL_ICONS_ID);
                                      return next;
                                    });
                                  }}
                                >
                                  {/* Vertical connector */}
                                  <div
                                    className={cn(
                                      "absolute z-10 top-0 bottom-0 w-px",
                                      isIconsSelected
                                        ? "bg-white/30"
                                        : "bg-white/10",
                                    )}
                                    style={{ left: "16px" }}
                                  />

                                  <div
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleToggle(VIRTUAL_ICONS_ID);
                                    }}
                                    className={cn(
                                      "w-4 h-4 flex items-center justify-center shrink-0 cursor-pointer",
                                      isIconsCollapsed ? "" : "rotate-90",
                                    )}
                                  >
                                    <Icon
                                      name="chevronRight"
                                      className={cn(
                                        "size-2.5 opacity-50",
                                        isIconsSelected && "opacity-80",
                                      )}
                                    />
                                  </div>
                                  <Icon
                                    name="folder"
                                    className={`size-3 ml-1 mr-2 ${isIconsSelected ? "opacity-90" : "opacity-50"}`}
                                  />
                                  <span className="grow text-xs font-medium overflow-hidden text-ellipsis whitespace-nowrap pointer-events-none">
                                    Icons
                                  </span>
                                </div>

                                {/* Remix (child of Icons) */}
                                {!isIconsCollapsed &&
                                  (() => {
                                    return (
                                      <div
                                        className={cn(
                                          "group relative flex items-center h-8 outline-none focus:outline-none rounded-lg cursor-pointer select-none",
                                          "hover:bg-secondary/50",
                                          isRemixIconsView &&
                                            "bg-primary text-primary-foreground hover:bg-primary",
                                          !isRemixIconsView &&
                                            "text-secondary-foreground/80 dark:text-muted-foreground",
                                        )}
                                        style={{ paddingLeft: "36px" }}
                                        onClick={() =>
                                          setSelectedFolderId(VIRTUAL_REMIX_ID)
                                        }
                                      >
                                        {/* Vertical connectors */}
                                        <div
                                          className={cn(
                                            "absolute z-10 top-0 bottom-0 w-px",
                                            isRemixIconsView
                                              ? "bg-white/30"
                                              : "bg-white/10",
                                          )}
                                          style={{ left: "16px" }}
                                        />
                                        <div
                                          className={cn(
                                            "absolute z-10 top-0 bottom-0 w-px",
                                            isRemixIconsView
                                              ? "bg-white/30"
                                              : "bg-white/10",
                                          )}
                                          style={{ left: "30px" }}
                                        />

                                        <div className="w-4 h-4 shrink-0 flex items-center justify-center">
                                          <div
                                            className={cn(
                                              "ml-px w-1.5 h-px bg-white opacity-0",
                                            )}
                                          />
                                        </div>
                                        <Icon
                                          name="folder"
                                          className={`size-3 ml-1 mr-2 ${isRemixIconsView ? "opacity-90" : "opacity-50"}`}
                                        />
                                        <span className="grow text-xs font-medium overflow-hidden text-ellipsis whitespace-nowrap pointer-events-none">
                                          Remix
                                        </span>
                                        {remixTotalIcons > 0 && (
                                          <span
                                            className={cn(
                                              "text-xs mr-3 pointer-events-none shrink-0",
                                              isRemixIconsView
                                                ? "opacity-70"
                                                : "opacity-40",
                                            )}
                                          >
                                            {remixTotalIcons.toLocaleString()}
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })()}
                              </>
                            );
                          })()}
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* File Grid */}
            <div className="flex-1 px-6 pb-5 overflow-y-auto flex flex-col">
              {selectedFolderId === VIRTUAL_LIBRARIES_ID ? (
                <>
                  <FileGridHeader>
                    <span className="text-xs text-foreground font-medium">
                      Libraries
                    </span>
                  </FileGridHeader>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-4">
                    <FileGridItem
                      id={VIRTUAL_ICONS_ID}
                      name="Icons"
                      type="folder"
                      onClick={() => {
                        setSelectedFolderId(VIRTUAL_ICONS_ID);
                        setCollapsedIds((prev) => {
                          const next = new Set(prev);
                          next.delete(VIRTUAL_LIBRARIES_ID);
                          next.delete(VIRTUAL_ICONS_ID);
                          return next;
                        });
                      }}
                    />
                  </div>
                </>
              ) : selectedFolderId === VIRTUAL_ICONS_ID ? (
                <>
                  <FileGridHeader>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <button
                        onClick={() =>
                          setSelectedFolderId(VIRTUAL_LIBRARIES_ID)
                        }
                        className="hover:text-foreground transition-colors cursor-pointer"
                      >
                        Libraries
                      </button>
                      <Icon
                        name="chevronRight"
                        className="size-2.5 opacity-50"
                      />
                      <span className="text-foreground font-medium">Icons</span>
                    </div>
                  </FileGridHeader>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-4">
                    <FileGridItem
                      id={VIRTUAL_REMIX_ID}
                      name="Remix"
                      type="folder"
                      onClick={() => {
                        setSelectedFolderId(VIRTUAL_REMIX_ID);
                        setCollapsedIds((prev) => {
                          const next = new Set(prev);
                          next.delete(VIRTUAL_LIBRARIES_ID);
                          next.delete(VIRTUAL_ICONS_ID);
                          return next;
                        });
                      }}
                    />
                  </div>
                </>
              ) : isRemixIconsView ? (
                <>
                  {/* Remix Icons header */}
                  <FileGridHeader isSticky>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <button
                        onClick={() =>
                          setSelectedFolderId(VIRTUAL_LIBRARIES_ID)
                        }
                        className="hover:text-foreground transition-colors cursor-pointer"
                      >
                        Libraries
                      </button>
                      <Icon
                        name="chevronRight"
                        className="size-2.5 opacity-50"
                      />
                      <button
                        onClick={() => setSelectedFolderId(VIRTUAL_ICONS_ID)}
                        className="hover:text-foreground transition-colors cursor-pointer"
                      >
                        Icons
                      </button>
                      <Icon
                        name="chevronRight"
                        className="size-2.5 opacity-50"
                      />
                      <span className="text-foreground font-medium">Remix</span>
                      {debouncedSearch.trim() && (
                        <>
                          <Icon
                            name="chevronRight"
                            className="size-2.5 opacity-50"
                          />
                          <span className="text-muted-foreground font-medium">
                            &quot;{debouncedSearch}&quot;
                          </span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {remixTotal > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {remixIcons.length === remixTotal
                            ? `${remixTotal.toLocaleString()} icons`
                            : `${remixIcons.length.toLocaleString()} of ${remixTotal.toLocaleString()} icons`}
                        </span>
                      )}

                      {/* Category filter (hidden for now) */}
                      {/*}
                      <Select
                        value={remixCategory || '__all__'}
                        onValueChange={(value) => setRemixCategory(value === '__all__' ? undefined : value)}
                      >
                        <SelectTrigger className="h-7 text-xs w-32">
                          <SelectValue placeholder="All categories" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All categories</SelectItem>
                          {remixCategories.map((cat) => (
                            <SelectItem key={cat.name} value={cat.name}>{cat.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      */}

                      {/* Style filter */}
                      <Select
                        value={remixStyle || "__all__"}
                        onValueChange={(value) =>
                          setRemixStyle(
                            value === "__all__"
                              ? undefined
                              : (value as "fill" | "line"),
                          )
                        }
                      >
                        <SelectTrigger className="h-7 text-xs w-24">
                          <SelectValue placeholder="All styles" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All styles</SelectItem>
                          <SelectItem value="fill">Fill</SelectItem>
                          <SelectItem value="line">Line</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </FileGridHeader>

                  {/* Remix Icons grid */}
                  {isLoadingRemixIcons && remixIcons.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center">
                      <Spinner />
                    </div>
                  ) : remixIcons.length === 0 ? (
                    <div className="flex-1 flex flex-col">
                      <div className="flex-1 w-full flex-col flex gap-1 items-center justify-center">
                        <div>No icons found</div>
                        <div className="text-muted-foreground">
                          Try a different search or filter
                        </div>
                      </div>
                      <div className="flex-1" />
                    </div>
                  ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-4">
                      {remixIcons.map((icon) => (
                        <div
                          key={`${icon.source}-${icon.name}`}
                          className="flex flex-col gap-1.5 group"
                        >
                          <div
                            className="relative aspect-square bg-secondary/30 rounded-md flex items-center justify-center overflow-hidden hover:bg-secondary/60 cursor-pointer"
                            onClick={() => handleRemixIconClick(icon)}
                          >
                            <div className="absolute inset-0 opacity-10 bg-checkerboard" />
                            <div
                              data-icon
                              className="relative w-full h-full flex items-center justify-center p-5 pointer-events-none text-foreground z-10"
                              dangerouslySetInnerHTML={{ __html: sanitizeSvgForInline(icon.svg) }}
                            />
                          </div>
                          <span
                            className="truncate max-w-full text-xs opacity-60 text-center"
                            title={icon.name}
                          >
                            {icon.name}
                          </span>
                        </div>
                      ))}

                      {hasMoreRemixIcons && (
                        <LoadMoreSentinel ref={setRemixLoadMoreRef} />
                      )}
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* Breadcrumb */}
                  <FileGridHeader isSticky>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      {searchQuery.trim() ? (
                        <>
                          <span className="text-foreground font-medium">
                            Results for &quot;{searchQuery}&quot;
                          </span>
                          <Icon
                            name="chevronRight"
                            className="size-2.5 opacity-50"
                          />
                          <span className="text-muted-foreground font-medium">
                            {assets.length}{" "}
                            {assets.length === 1 ? "file" : "files"}
                          </span>
                        </>
                      ) : (
                        <>
                          {breadcrumbPath.map((item, index) => (
                            <React.Fragment key={item.id || "root"}>
                              <button
                                onClick={() => setSelectedFolderId(item.id)}
                                className={cn(
                                  "hover:text-foreground transition-colors",
                                  index === breadcrumbPath.length - 1
                                    ? "text-foreground font-medium"
                                    : "cursor-pointer",
                                )}
                              >
                                {item.name}
                              </button>
                              {index < breadcrumbPath.length - 1 && (
                                <Icon
                                  name="chevronRight"
                                  className="size-2.5 opacity-50"
                                />
                              )}
                            </React.Fragment>
                          ))}
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Show asset count */}
                      {assets.length > 0 && selectedAssetIds.size === 0 && (
                        <span className="text-xs text-muted-foreground">
                          {assets.length >= totalAssets
                            ? `${assets.length} ${assets.length === 1 ? "file" : "files"}`
                            : `${assets.length} of ${totalAssets} files`}
                        </span>
                      )}

                      {selectedAssetIds.size > 0 ? (
                        <>
                          <span className="text-xs text-muted-foreground">
                            {selectedAssetIds.size} selected
                          </span>

                          <Button
                            size="xs"
                            variant="secondary"
                            className="px-2!"
                            onClick={() => {
                              setBulkMoveTargetFolderId(selectedFolderId);
                              setShowBulkMoveDialog(true);
                            }}
                          >
                            <Icon name="folder" />
                            Move
                          </Button>

                          <Button
                            size="xs"
                            variant="destructive"
                            className="px-2!"
                            onClick={() => setShowBulkDeleteConfirmDialog(true)}
                          >
                            <Icon name="trash" />
                            Delete
                          </Button>

                          <Button
                            size="xs"
                            variant="secondary"
                            onClick={handleClearSelection}
                          >
                            Deselect all
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="xs"
                          variant="secondary"
                          onClick={handleSelectAll}
                          disabled={assets.length === 0}
                          className="text-xs"
                        >
                          Select all
                        </Button>
                      )}
                    </div>
                  </FileGridHeader>

                  {/* Loading indicator for initial load - show ONLY this, nothing else */}
                  {isLoadingAssets &&
                  assets.length === 0 &&
                  currentUploadingAssets.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center">
                      <Spinner />
                    </div>
                  ) : (searchQuery.trim() ? true : childFolders.length === 0) &&
                    assets.length === 0 &&
                    currentUploadingAssets.length === 0 ? (
                    <div className="flex-1 flex flex-col">
                      <div className="flex-1 w-full flex-col flex gap-1 items-center justify-center">
                        <div>No files found</div>
                        <div className="text-muted-foreground">
                          {searchQuery.trim() || selectedCategories !== null
                            ? "No files were found using the current filters"
                            : selectedFolderId === null
                              ? "No files"
                              : "No folders or assets in this folder"}
                        </div>
                      </div>
                      <div className="flex-1"></div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-4">
                      {/* Display child folders (hide when searching) */}
                      {!searchQuery.trim() &&
                        childFolders.map((folder) => (
                          <FileGridItem
                            key={folder.id}
                            id={folder.id}
                            name={folder.name}
                            type="folder"
                            onClick={() => {
                              setSelectedFolderId(folder.id);
                              // Auto-expand the folder in the tree
                              setCollapsedIds((prev) => {
                                const next = new Set(prev);
                                next.delete(folder.id);
                                return next;
                              });
                            }}
                            onEdit={() => handleEditFolder(folder.id)}
                            onDelete={() => handleDeleteFolder(folder.id)}
                          />
                        ))}

                      {/* Display uploading assets */}
                      {currentUploadingAssets.map((uploadingAsset) => {
                        // Remove file extension from name
                        const nameWithoutExtension =
                          uploadingAsset.filename.replace(/\.[^/.]+$/, "");

                        return (
                          <FileGridItem
                            key={uploadingAsset.id}
                            id={uploadingAsset.id}
                            name={nameWithoutExtension}
                            type="uploading"
                            file={uploadingAsset.file}
                          />
                        );
                      })}

                      {/* Display existing assets */}
                      {assets.map((asset) => (
                        <FileGridItem
                          key={asset.id}
                          id={asset.id}
                          name={asset.filename}
                          type="asset"
                          mimeType={asset.mime_type}
                          imageUrl={asset.public_url}
                          content={asset.content}
                          onClick={() => onAssetSelect?.(asset)}
                          isSelected={selectedAssetIds.has(asset.id)}
                          onSelectChange={(selected) =>
                            handleAssetSelect(asset.id, selected)
                          }
                          onPreview={
                            asset.public_url || asset.storage_path
                              ? () =>
                                  handlePreviewAsset(
                                    getAssetProxyUrl(asset) ||
                                      asset.public_url!,
                                  )
                              : undefined
                          }
                          onEdit={() => handleEditAsset(asset.id)}
                          onDelete={() => handleDeleteAsset(asset.id)}
                        />
                      ))}

                      {hasMoreAssets && (
                        <LoadMoreSentinel ref={setLoadMoreRef} />
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Folder Dialog */}
      <AssetFolderDialog
        open={showCreateFolderDialog}
        onOpenChange={setShowCreateFolderDialog}
        onConfirm={handleCreateFolder}
        mode="create"
        initialParentFolderId={
          isVirtualFolder(selectedFolderId) ? null : selectedFolderId
        }
        folders={folders}
      />

      {/* Edit Folder Dialog */}
      <AssetFolderDialog
        open={showEditFolderDialog}
        onOpenChange={setShowEditFolderDialog}
        onConfirm={handleConfirmEdit}
        mode="rename"
        initialName={editFolderName}
        initialParentFolderId={editFolderParentId}
        folders={folders}
        currentFolderId={editingFolderId}
      />

      {/* Delete Folder Confirmation Dialog */}
      <ConfirmDialog
        open={showDeleteConfirmDialog}
        onOpenChange={setShowDeleteConfirmDialog}
        title="Delete folder"
        description={(() => {
          if (!deletingFolderId)
            return "Are you sure you want to delete this folder?";

          const descendantIds = getDescendantFolderIds(deletingFolderId);
          // Count assets from cache (may not include all assets)
          const assetsCount = Object.values(assetsById).filter(
            (asset) =>
              asset.asset_folder_id === deletingFolderId ||
              descendantIds.includes(asset.asset_folder_id || ""),
          ).length;

          if (descendantIds.length > 0 || assetsCount > 0) {
            const parts = [];
            if (descendantIds.length > 0) {
              parts.push(
                `${descendantIds.length} subfolder${descendantIds.length > 1 ? "s" : ""}`,
              );
            }
            if (assetsCount > 0) {
              parts.push(`${assetsCount} asset${assetsCount > 1 ? "s" : ""}`);
            }
            return `Are you sure you want to delete this folder and all its contents (${parts.join(" and ")})? This action cannot be undone.`;
          }

          return "Are you sure you want to delete this folder? This action cannot be undone.";
        })()}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmVariant="destructive"
        onConfirm={handleConfirmDeleteFolder}
      />

      {/* Delete Asset Confirmation Dialog.
          A file that is still used can't be deleted: the confirm button is
          disabled and the places that use it are listed. */}
      <ConfirmDialog
        open={showDeleteAssetConfirmDialog}
        onOpenChange={(open) => {
          setShowDeleteAssetConfirmDialog(open);
          if (!open) {
            setAssetUsage(null);
            setLoadingUsage(false);
          }
        }}
        title={assetUsage && assetUsage.total > 0 ? "Asset is in use" : "Delete asset"}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmVariant="destructive"
        disableConfirm={loadingUsage || (assetUsage?.total ?? 0) > 0}
        onConfirm={handleConfirmDeleteAsset}
      >
        {loadingUsage ? (
          <span className="flex items-center gap-2">
            <Spinner />
            Checking asset usage...
          </span>
        ) : assetUsage && assetUsage.total > 0 ? (
          <div className="space-y-3">
            <p>
              <span className="text-foreground">
                {(
                  assetsById[deletingAssetId ?? ""] ||
                  assets.find((a) => a.id === deletingAssetId)
                )?.filename ?? "This asset"}
              </span>{" "}
              is still in use, so it can&apos;t be deleted yet. Remove it from
              the places below first, then delete it. It is used in:
            </p>
            <div className="space-y-2 text-muted-foreground">
              {(
                [
                  ["Pages", assetUsage.pages],
                  ["Components", assetUsage.components],
                  ["Layer styles", assetUsage.layerStyles],
                  ["CMS collections", assetUsage.cmsItems],
                  ["Published funnels", assetUsage.publishedFunnels],
                ] as const
              )
                .filter(([, items]) => items.length > 0)
                .map(([label, items]) => (
                  <div key={label}>
                    <div className="flex gap-1.5 font-medium text-muted-foreground mb-1">
                      <span className="text-foreground">{label}</span>
                      <span>&mdash;</span>
                      <span>
                        {items.length} item{items.length > 1 ? "s" : ""}
                      </span>
                    </div>
                    <ul className="list-disc list-inside space-y-0.5 ml-1">
                      {items.map((item) => (
                        <li key={item.id}>{item.name}</li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          </div>
        ) : (
          "Are you sure you want to delete this asset? This action cannot be undone."
        )}
      </ConfirmDialog>

      {/* Bulk Delete Assets Confirmation Dialog */}
      <ConfirmDialog
        open={showBulkDeleteConfirmDialog}
        onOpenChange={setShowBulkDeleteConfirmDialog}
        title={`Delete ${selectedAssetIds.size} file${selectedAssetIds.size > 1 ? "s" : ""}`}
        description={`Are you sure you want to delete ${selectedAssetIds.size} file${selectedAssetIds.size > 1 ? "s" : ""}? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmVariant="destructive"
        onConfirm={() => {
          handleBulkDelete();
          setShowBulkDeleteConfirmDialog(false);
        }}
      />

      {/* Bulk Move Assets Dialog */}
      <Dialog open={showBulkMoveDialog} onOpenChange={setShowBulkMoveDialog}>
        <DialogContent
          width="320px"
          aria-describedby={undefined}
          className="gap-0"
        >
          <DialogHeader>
            <DialogTitle>
              Move {selectedAssetIds.size} asset
              {selectedAssetIds.size > 1 ? "s" : ""}
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4.5 pt-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="bulk-move-folder">Folder</Label>
              <Select
                value={bulkMoveTargetFolderId || "root"}
                onValueChange={(value) =>
                  setBulkMoveTargetFolderId(value === "root" ? null : value)
                }
              >
                <SelectTrigger id="bulk-move-folder">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="root">All files</SelectItem>
                  {folders.map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {buildFolderPath(folder.id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DialogFooter className="grid grid-cols-2 mt-1">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowBulkMoveDialog(false);
                  setBulkMoveTargetFolderId(null);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  handleBulkMove(bulkMoveTargetFolderId);
                  setBulkMoveTargetFolderId(null);
                }}
              >
                Move
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Asset / Create SVG Dialog */}
      <Dialog
        open={showEditAssetDialog}
        onOpenChange={(open) => {
          setShowEditAssetDialog(open);
          if (!open) {
            // Delay cleanup until after close animation
            setTimeout(() => {
              setEditAssetContent(null);
              setIsCreateSvgMode(false);
            }, 200);
          }
        }}
      >
        <DialogContent
          width="400px"
          aria-describedby={undefined}
          className="gap-0"
        >
          <DialogHeader>
            <DialogTitle>
              {isCreateSvgMode ? "New SVG icon" : "Edit asset"}
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4.5 pt-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="asset-name">File name</Label>
              <Input
                id="asset-name"
                value={editAssetName}
                onChange={(e) => setEditAssetName(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !isCreateSvgMode &&
                    !editAssetContent
                  ) {
                    e.preventDefault();
                    void submitEditAsset();
                  }
                }}
                autoFocus
                autoComplete="off"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="asset-folder">Folder</Label>
              <Select
                value={editAssetFolderId || "root"}
                onValueChange={(value) =>
                  setEditAssetFolderId(value === "root" ? null : value)
                }
              >
                <SelectTrigger id="asset-folder">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="root">All files</SelectItem>
                  {folders.map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {buildFolderPath(folder.id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {(isCreateSvgMode || editAssetContent !== null) && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="svg-code">SVG code</Label>
                <Textarea
                  id="svg-code"
                  value={editAssetContent || ""}
                  onChange={(e) => setEditAssetContent(e.target.value)}
                  readOnly={
                    !isCreateSvgMode &&
                    !!(editingAssetId && assetsById[editingAssetId]?.storage_path)
                  }
                  className="font-mono text-xs min-h-50 max-h-100"
                  placeholder="<svg>...</svg>"
                  autoComplete="off"
                />
              </div>
            )}

            <DialogFooter className="grid grid-cols-2 mt-1">
              <Button
                variant="secondary"
                onClick={() => setShowEditAssetDialog(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void submitEditAsset()}
                disabled={
                  isSavingAsset ||
                  !editAssetName.trim() ||
                  (isCreateSvgMode && !editAssetContent?.trim())
                }
              >
                {isCreateSvgMode ? "Create" : "Save"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

    </>
  );
}
