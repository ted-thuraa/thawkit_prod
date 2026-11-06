// path: src/lib/assets/asset-folder-utils.ts

/**
 * Pure helpers for the media library's folder tree. No React, no I/O.
 *
 * Data model (verified in `assets-schema.ts`): a folder is
 * `{ id, asset_folder_id (the parent; null = top level), name, depth, order }`.
 * There is NO persisted root folder. "All files" is a VIRTUAL root:
 *   - in the sidebar it is a synthetic node (id "root") that the UI prepends;
 *   - as a filter it is `asset_folder_id IS NULL` (the picker passes
 *     `folderId: null`), i.e. the assets that belong to no regular folder.
 *
 * Reordering is out of scope: siblings are shown by their stored `order`
 * (then name, for a stable result) and this module never writes either.
 */

import type { AssetFolder } from "@/types/funnel";

export interface FlattenedAssetFolderNode {
  id: string;
  data: AssetFolder;
  depth: number;
  parentId: string | null;
  index: number;
}

const bySiblingOrder = (a: AssetFolder, b: AssetFolder) =>
  a.order - b.order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/**
 * Depth-first flattening for rendering. Children of a collapsed folder are
 * omitted. `startDepth` is 1 when a virtual root is rendered above them.
 * Folders whose parent is missing (stale reference, e.g. a deleted parent) are
 * NOT rendered: they are unreachable from the root, exactly as on the server.
 */
export function flattenAssetFolderTree(
  folders: readonly AssetFolder[],
  parentId: string | null = null,
  collapsedIds: ReadonlySet<string> = new Set(),
  startDepth = 0,
): FlattenedAssetFolderNode[] {
  const out: FlattenedAssetFolderNode[] = [];
  const walk = (parent: string | null, depth: number, seen: Set<string>) => {
    const children = folders
      .filter((f) => f.asset_folder_id === parent)
      .sort(bySiblingOrder);
    for (const folder of children) {
      if (seen.has(folder.id)) continue; // defensive: a cycle would never terminate
      out.push({
        id: folder.id,
        data: folder,
        depth,
        parentId: parent,
        index: out.length,
      });
      if (!collapsedIds.has(folder.id)) {
        walk(folder.id, depth + 1, new Set(seen).add(folder.id));
      }
    }
  };
  walk(parentId, startDepth, new Set());
  return out;
}

/** `"root"` means the virtual root (top-level folders). */
export function hasChildFolders(
  folderId: string,
  allFolders: readonly AssetFolder[],
): boolean {
  const parent = folderId === "root" ? null : folderId;
  return allFolders.some((f) => f.asset_folder_id === parent);
}

/** True when `folderId` sits anywhere beneath `ancestorId`. */
export function isDescendantAssetFolder(
  folderId: string,
  ancestorId: string,
  allFolders: readonly AssetFolder[],
): boolean {
  const byId = new Map(allFolders.map((f) => [f.id, f]));
  const seen = new Set<string>();
  let current = byId.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.asset_folder_id === ancestorId) return true;
    current = current.asset_folder_id ? byId.get(current.asset_folder_id) : undefined;
  }
  return false;
}

/** The folder plus every descendant folder id. */
export function getFolderAndDescendantIds(
  folderId: string,
  allFolders: readonly AssetFolder[],
): string[] {
  const ids = [folderId];
  for (let i = 0; i < ids.length; i++) {
    for (const f of allFolders) {
      if (f.asset_folder_id === ids[i] && !ids.includes(f.id)) ids.push(f.id);
    }
  }
  return ids;
}

/** `["Images", "Products"]` for a folder, outermost first. */
export function buildAssetFolderPath(
  folderId: string | null,
  allFolders: readonly AssetFolder[],
): string[] {
  const byId = new Map(allFolders.map((f) => [f.id, f]));
  const parts: string[] = [];
  const seen = new Set<string>();
  let current = folderId ? byId.get(folderId) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.name);
    current = current.asset_folder_id ? byId.get(current.asset_folder_id) : undefined;
  }
  return parts;
}
