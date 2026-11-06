// path: src/lib/assets/library-service.ts

import "server-only";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { Asset, AssetFolder } from "@/types/funnel";
import {
  getDraftAsset,
  getDraftFolder,
  insertFolder,
  insertInlineSvgAsset,
  listDraftAssetsInFolders,
  listDraftFolders,
  markFoldersDeleted,
  moveDraftAssets,
  updateDraftAsset,
  updateFolderAndDepths,
} from "./asset-repository";
import { getFolderAndDescendantIds, isDescendantAssetFolder } from "./asset-folder-utils";
import {
  deleteAsset,
  type AssetUsage,
  type DeleteDeps,
  type DeleteOutcome,
} from "./delete-asset";
import { MAX_FOLDER_NAME_LENGTH } from "./folder-name";
import { sanitizeSvg } from "./svg-sanitizer";
import { MAX_FILENAME_LENGTH, sanitizeFilename } from "./upload-policy";

/**
 * Media-library management beyond upload/delete: folders and inline-SVG
 * (custom icon) assets. Every function takes the `organizationId` derived from
 * the authorized campaign; ids that don't belong to it behave as missing.
 *
 * "All files" is a virtual root: `folderId: null` means "no regular folder",
 * and no folder row is ever created for it.
 * Folder ORDER is append-only here (new folder = last sibling); reordering is
 * deliberately not implemented.
 */


export function validateFolderName(raw: string): string {
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!name) throw new ValidationError("Folder name is required.", { name: ["Required"] });
  if (name.length > MAX_FOLDER_NAME_LENGTH) {
    throw new ValidationError(`Folder name must be at most ${MAX_FOLDER_NAME_LENGTH} characters.`, {
      name: ["Too long"],
    });
  }
  return name;
}

async function requireFolder(organizationId: string, folderId: string): Promise<AssetFolder> {
  const folder = await getDraftFolder(organizationId, folderId);
  if (!folder) throw new NotFoundError("That folder no longer exists.", { folderId });
  return folder;
}

/** A target folder for an asset/folder; `null` (All files) needs no lookup. */
async function requireTargetFolder(
  organizationId: string,
  folderId: string | null,
): Promise<AssetFolder | null> {
  if (folderId === null) return null;
  return requireFolder(organizationId, folderId);
}

// ─── Folders ────────────────────────────────────────────────────────────────

export async function createFolder(
  organizationId: string,
  input: { name: string; parentId: string | null },
): Promise<AssetFolder> {
  const name = validateFolderName(input.name);
  const parent = await requireTargetFolder(organizationId, input.parentId);
  const siblings = (await listDraftFolders(organizationId)).filter(
    (f) => f.asset_folder_id === (parent?.id ?? null),
  );
  const order = siblings.reduce((max, f) => Math.max(max, f.order + 1), 0);
  return insertFolder(organizationId, {
    name,
    parentId: parent?.id ?? null,
    depth: parent ? parent.depth + 1 : 0,
    order,
  });
}

export interface FolderUpdateResult {
  folder: AssetFolder;
  /** New stored depth of every folder whose depth changed (the folder and its descendants). */
  depths: Record<string, number>;
}

export async function updateFolder(
  organizationId: string,
  folderId: string,
  patch: { name?: string; parentId?: string | null },
): Promise<FolderUpdateResult> {
  const all = await listDraftFolders(organizationId);
  const folder = all.find((f) => f.id === folderId.toLowerCase());
  if (!folder) throw new NotFoundError("That folder no longer exists.", { folderId });

  const name = patch.name !== undefined ? validateFolderName(patch.name) : undefined;
  const reparent = patch.parentId !== undefined && patch.parentId !== folder.asset_folder_id;

  let newParent: AssetFolder | null = null;
  if (reparent && patch.parentId) {
    newParent = all.find((f) => f.id === patch.parentId!.toLowerCase()) ?? null;
    if (!newParent) throw new NotFoundError("The destination folder no longer exists.");
    // Moving a folder into itself or its own subtree would orphan the whole branch.
    if (newParent.id === folder.id || isDescendantAssetFolder(newParent.id, folder.id, all)) {
      throw new ValidationError("A folder can't be moved into itself or one of its subfolders.");
    }
  }

  const depths = new Map<string, number>();
  if (reparent) {
    const base = newParent ? newParent.depth + 1 : 0;
    const shift = base - folder.depth;
    for (const id of getFolderAndDescendantIds(folder.id, all)) {
      const f = all.find((x) => x.id === id)!;
      depths.set(id, f.depth + shift);
    }
  }

  if (name === undefined && !reparent) return { folder, depths: {} };

  await updateFolderAndDepths(
    organizationId,
    folder.id,
    {
      name,
      parentId: reparent ? (newParent?.id ?? null) : undefined,
    },
    depths,
  );

  const updated = await getDraftFolder(organizationId, folder.id);
  if (!updated) throw new NotFoundError("That folder no longer exists.", { folderId });
  return { folder: updated, depths: Object.fromEntries(depths) };
}

export type FolderDeleteOutcome =
  | { status: "deleted"; folderIds: string[]; assetIds: string[] }
  | { status: "in_use"; blocked: Array<{ assetId: string; filename: string; usages: AssetUsage[] }> };

/**
 * Deletes a folder, its subfolders AND the files inside them (the library
 * semantics Ycode has), but safely:
 *   1. if ANY contained file is still referenced, NOTHING is deleted
 *      (`in_use`), exactly like deleting that file on its own;
 *   2. otherwise each file goes through the normal lifecycle (stored object
 *      first, then the record) — a storage failure aborts with an error and
 *      leaves the folder and its remaining files intact, so retrying is safe;
 *   3. only then are the folders soft-deleted.
 */
export async function deleteFolder(
  organizationId: string,
  folderId: string,
  deps: DeleteDeps,
): Promise<FolderDeleteOutcome> {
  const all = await listDraftFolders(organizationId);
  const folder = all.find((f) => f.id === folderId.toLowerCase());
  if (!folder) throw new NotFoundError("That folder no longer exists.", { folderId });

  const folderIds = getFolderAndDescendantIds(folder.id, all);
  const assets = await listDraftAssetsInFolders(organizationId, folderIds);

  const blocked: Array<{ assetId: string; filename: string; usages: AssetUsage[] }> = [];
  for (const a of assets) {
    const usages = await deps.findUsages(organizationId, a.id);
    if (usages.length > 0) blocked.push({ assetId: a.id, filename: a.filename, usages });
  }
  if (blocked.length > 0) return { status: "in_use", blocked };

  const deletedAssetIds: string[] = [];
  for (const a of assets) {
    const outcome = await deleteAsset(organizationId, a.id, deps);
    if (outcome.status === "in_use") {
      // Became referenced between the pre-check and now: stop, keep everything else.
      return {
        status: "in_use",
        blocked: [{ assetId: a.id, filename: a.filename, usages: outcome.usages }],
      };
    }
    deletedAssetIds.push(a.id);
  }

  await markFoldersDeleted(organizationId, folderIds);
  return { status: "deleted", folderIds, assetIds: deletedAssetIds };
}

// ─── Inline SVG assets (custom icons) ───────────────────────────────────────

function sha256Hex(bytes: Uint8Array): Promise<string> {
  return crypto.subtle
    .digest("SHA-256", bytes as unknown as ArrayBuffer)
    .then((d) => Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join(""));
}

function cleanAssetName(raw: string): string {
  const name = sanitizeFilename(raw);
  if (!raw.trim()) throw new ValidationError("A name is required.", { name: ["Required"] });
  return name.slice(0, MAX_FILENAME_LENGTH);
}

async function prepareSvg(content: string) {
  const result = sanitizeSvg(content);
  if (!result.ok) throw new ValidationError(`This SVG can't be used: ${result.reason}`);
  const bytes = new TextEncoder().encode(result.svg);
  return {
    content: result.svg,
    contentHash: await sha256Hex(bytes),
    fileSize: bytes.byteLength,
    width: result.width,
    height: result.height,
  };
}

/**
 * Creates a custom SVG icon asset from markup (typed/pasted by the user or
 * taken from the icon library). The markup is sanitized by the same allow-list
 * sanitizer as uploads; nothing is stored in UploadThing (no file, `content`
 * only) — the Icon control renders `content` inline.
 */
export async function createSvgAsset(
  organizationId: string,
  input: { name: string; folderId: string | null; content: string },
): Promise<Asset> {
  const filename = cleanAssetName(input.name);
  const folder = await requireTargetFolder(organizationId, input.folderId);
  const svg = await prepareSvg(input.content);
  return insertInlineSvgAsset(organizationId, {
    filename,
    folderId: folder?.id ?? null,
    ...svg,
  });
}

// ─── Asset edits ────────────────────────────────────────────────────────────

export async function updateAssetDetails(
  organizationId: string,
  assetId: string,
  patch: { filename?: string; folderId?: string | null; content?: string },
): Promise<Asset> {
  const current = await getDraftAsset(organizationId, assetId);
  if (!current) throw new NotFoundError("That file no longer exists.", { assetId });

  const update: Parameters<typeof updateDraftAsset>[2] = {};
  if (patch.filename !== undefined) update.filename = cleanAssetName(patch.filename);
  if (patch.folderId !== undefined) {
    const folder = await requireTargetFolder(organizationId, patch.folderId);
    update.assetFolderId = folder?.id ?? null;
  }
  if (patch.content !== undefined && patch.content !== current.content) {
    // An uploaded SVG's markup mirrors its stored file (`public_url` is what the
    // Image control uses); editing only the markup would make the two disagree.
    if (current.storage_path) {
      throw new ValidationError("The markup of an uploaded SVG can't be edited. Create a new SVG icon instead.");
    }
    if (current.mime_type !== "image/svg+xml") {
      throw new ValidationError("Only SVG icons have editable markup.");
    }
    Object.assign(update, await prepareSvg(patch.content));
  }

  if (Object.keys(update).length === 0) return current;
  const saved = await updateDraftAsset(organizationId, current.id, update);
  if (!saved) throw new NotFoundError("That file no longer exists.", { assetId });
  return saved;
}

export async function moveAssets(
  organizationId: string,
  assetIds: readonly string[],
  folderId: string | null,
): Promise<string[]> {
  const folder = await requireTargetFolder(organizationId, folderId);
  return moveDraftAssets(organizationId, assetIds, folder?.id ?? null);
}

export interface BulkDeleteOutcome {
  deleted: string[];
  inUse: Array<{ assetId: string; filename: string; usages: AssetUsage[] }>;
  failed: Array<{ assetId: string; filename: string; error: string }>;
}

/** Per-asset lifecycle; one failure never hides the others' results. */
export async function bulkDeleteAssets(
  organizationId: string,
  assetIds: readonly string[],
  deps: DeleteDeps,
): Promise<BulkDeleteOutcome> {
  const out: BulkDeleteOutcome = { deleted: [], inUse: [], failed: [] };
  for (const id of [...new Set(assetIds)]) {
    const existing = await deps.getAsset(organizationId, id);
    const filename = existing?.filename ?? id;
    try {
      const outcome: DeleteOutcome = await deleteAsset(organizationId, id, deps);
      if (outcome.status === "deleted") out.deleted.push(id);
      else out.inUse.push({ assetId: id, filename, usages: outcome.usages });
    } catch (error) {
      out.failed.push({
        assetId: id,
        filename,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
  return out;
}
