// path: src/lib/assets/delete-asset-deps.ts

import "server-only";
import { logger } from "@/lib/logger";
import { getDraftAsset, markAssetDeleted } from "./asset-repository";
import { findAssetUsages } from "./asset-usage";
import type { DeleteDeps } from "./delete-asset";
import { deleteStoredObject } from "./uploadthing-server";

export const deleteAssetDeps: DeleteDeps = {
  getAsset: getDraftAsset,
  findUsages: findAssetUsages,
  deleteObject: deleteStoredObject,
  markDeleted: markAssetDeleted,
  log: logger,
};
