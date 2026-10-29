// path: src/lib/assets/process-upload.ts

/**
 * What happens AFTER UploadThing has stored a file and calls us back.
 *
 * Pure orchestration: every side effect (fetching the stored bytes, writing
 * the DB row, deleting/replacing objects in UploadThing, logging) is injected
 * via `ProcessDeps`, so the failure semantics below are unit-tested without a
 * database or credentials. `process-upload-deps.ts` wires the real ones.
 *
 * The browser uploads straight to UploadThing, so by the time we run, the
 * object already exists and is UNTRUSTED. We therefore:
 *   1. short-circuit if this storage key already has a row (callback redelivery),
 *   2. pin the URL to UploadThing's CDN and re-check the declared type/size,
 *   3. fetch the real bytes (size-capped) and inspect them (magic bytes /
 *      SVG sanitizer) — never trusting the client's MIME type,
 *   4. for an SVG that needed cleaning, upload the SANITIZED bytes as a new
 *      object and delete the original, so the hosted file never contains
 *      active content,
 *   5. insert the metadata row idempotently (unique index on storage_path),
 *   6. on ANY failure after storage succeeded, delete every object we own
 *      (compensating action). If that cleanup itself fails, log an
 *      `asset.orphan` record with the key so it can be reconciled; a DB
 *      transaction cannot roll back an external deletion, so this is the
 *      best available guarantee.
 */

import type { Asset } from "@/types/funnel";
import { inspectImageBytes } from "./inspect-image";
import {
  isTrustedUploadUrl,
  maxBytesFor,
  sanitizeFilename,
  validateUploadCandidate,
  isUploadableMime,
} from "./upload-policy";

/** The subset of UploadThing's `UploadedFileData` we depend on. */
export interface UploadedObject {
  key: string;
  name: string;
  size: number;
  type: string;
  ufsUrl: string;
}

/** Derived server-side in the upload middleware — never client-supplied. */
export interface UploadContext {
  organizationId: string;
  userId: string;
  folderId: string | null;
}

export interface NewAssetInput {
  organizationId: string;
  assetFolderId: string | null;
  filename: string;
  storagePath: string;
  publicUrl: string;
  fileSize: number;
  mimeType: string;
  width: number | null;
  height: number | null;
  content: string | null;
  contentHash: string;
}

export interface ProcessDeps {
  findByStorageKey(key: string): Promise<Asset | null>;
  /** Idempotent: when a draft row for `storagePath` exists, return it with `created: false`. */
  insertAsset(input: NewAssetInput): Promise<{ asset: Asset; created: boolean }>;
  fetchBytes(url: string, maxBytes: number): Promise<Uint8Array>;
  /** Must throw when the object could not be confirmed deleted. */
  deleteObject(key: string): Promise<void>;
  replaceObject(args: {
    name: string;
    mime: string;
    bytes: Uint8Array;
  }): Promise<{ key: string; ufsUrl: string }>;
  log: {
    warn(message: string, context?: Record<string, unknown>): void;
    error(message: string, context?: Record<string, unknown>): void;
  };
}

/** Safe to show to the user verbatim. */
export class UploadRejectedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UploadRejectedError";
  }
}

const GENERIC_FAILURE = "The upload could not be saved. Please try again.";

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function processUploadedFile(
  file: UploadedObject,
  ctx: UploadContext,
  deps: ProcessDeps,
): Promise<Asset> {
  // 1. Redelivered callback → the work is already done.
  const existing = await deps.findByStorageKey(file.key);
  if (existing) return existing;

  // Objects that exist in UploadThing because of THIS call and must be
  // removed if we fail. An entry leaves the list only once deletion succeeds.
  const owned: string[] = [file.key];

  try {
    // 2. Trust boundary checks.
    if (!isTrustedUploadUrl(file.ufsUrl)) {
      throw new UploadRejectedError("The uploaded file could not be verified.");
    }
    const claimError = validateUploadCandidate(file);
    if (claimError) throw new UploadRejectedError(claimError);
    if (!isUploadableMime(file.type)) {
      throw new UploadRejectedError("Unsupported file type.");
    }

    // 3. Inspect the real bytes.
    const bytes = await deps.fetchBytes(file.ufsUrl, maxBytesFor(file.type));
    const inspected = inspectImageBytes(bytes, file.type);
    if (!inspected.ok) throw new UploadRejectedError(inspected.reason);

    let storageKey = file.key;
    let publicUrl = file.ufsUrl;
    let storedBytes = bytes;
    let content: string | null = null;

    // 4. SVG: hosted object must equal the sanitized markup.
    if (inspected.kind === "svg") {
      content = inspected.svg;
      if (inspected.modified) {
        const cleanBytes = new TextEncoder().encode(inspected.svg);
        const replacement = await deps.replaceObject({
          name: sanitizeFilename(file.name),
          mime: inspected.mime,
          bytes: cleanBytes,
        });
        owned.push(replacement.key);
        storageKey = replacement.key;
        publicUrl = replacement.ufsUrl;
        storedBytes = cleanBytes;

        try {
          await deps.deleteObject(file.key);
          owned.splice(owned.indexOf(file.key), 1);
        } catch (error) {
          // Stays in `owned`: the final cleanup (or a later failure) retries it.
          deps.log.warn("Could not delete original SVG after sanitizing", {
            key: file.key,
            error,
          });
        }
      }
    }

    // 5. Idempotent metadata insert.
    const { asset, created } = await deps.insertAsset({
      organizationId: ctx.organizationId,
      assetFolderId: ctx.folderId,
      filename: sanitizeFilename(file.name),
      storagePath: storageKey,
      publicUrl,
      fileSize: storedBytes.byteLength,
      mimeType: inspected.mime,
      width: inspected.width,
      height: inspected.height,
      content,
      contentHash: await sha256Hex(storedBytes),
    });

    if (!created) {
      // A concurrent delivery won. Keep the object the winning row owns;
      // delete anything else we created.
      await cleanup(
        owned.filter((key) => key !== asset.storage_path),
        deps,
      );
    }
    return asset;
  } catch (error) {
    await cleanup(owned, deps);
    if (error instanceof UploadRejectedError) throw error;
    deps.log.error("Asset upload processing failed", {
      key: file.key,
      organizationId: ctx.organizationId,
      error,
    });
    throw new UploadRejectedError(GENERIC_FAILURE, { cause: error });
  }
}

/** Best-effort compensating deletes; failures are logged as orphans. */
async function cleanup(keys: string[], deps: ProcessDeps): Promise<void> {
  for (const key of keys) {
    try {
      await deps.deleteObject(key);
    } catch (error) {
      deps.log.error("asset.orphan", {
        key,
        reason: "compensating delete failed",
        error,
      });
    }
  }
}
