// path: src/lib/assets/process-upload-deps.ts

import "server-only";
import { logger } from "@/lib/logger";
import {
  findAssetByStorageKey,
  insertAssetIdempotent,
} from "./asset-repository";
import type { ProcessDeps } from "./process-upload";
import {
  deleteStoredObject,
  fetchStoredBytes,
  uploadReplacementObject,
} from "./uploadthing-server";

/** The production wiring of `processUploadedFile`'s injected effects. */
export const processUploadDeps: ProcessDeps = {
  findByStorageKey: findAssetByStorageKey,
  insertAsset: insertAssetIdempotent,
  fetchBytes: fetchStoredBytes,
  deleteObject: deleteStoredObject,
  replaceObject: uploadReplacementObject,
  log: logger,
};
