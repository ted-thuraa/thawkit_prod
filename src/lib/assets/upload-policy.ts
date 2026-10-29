// path: src/lib/assets/upload-policy.ts

/**
 * Single source of truth for WHAT may be uploaded to the asset library.
 * Pure (no server-only / DB / SDK imports) so the UploadThing route config,
 * the server-side verification, the dialog's `accept` attribute and the
 * tests all read the same list.
 *
 * Scope: web-safe raster images + SVG. Video, audio, documents and fonts are
 * deliberately NOT uploadable (video is supported only as an external
 * provider link — see `src/lib/video-embed.ts`).
 *
 * The list is intentionally narrower than `ALLOWED_MIME_TYPES` in
 * `asset-constants.ts` (which also lists bmp/tiff/…): those display
 * inconsistently in browsers. Existing library rows with other types keep
 * displaying; they just can't be newly uploaded.
 */

export const RASTER_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

export const SVG_MIME_TYPE = "image/svg+xml" as const;

export const UPLOADABLE_MIME_TYPES = [...RASTER_MIME_TYPES, SVG_MIME_TYPE] as const;

export type UploadableMime = (typeof UPLOADABLE_MIME_TYPES)[number];

export const MAX_RASTER_BYTES = 8 * 1024 * 1024;
export const MAX_SVG_BYTES = 512 * 1024;
export const MAX_FILES_PER_UPLOAD = 10;
export const MAX_FILENAME_LENGTH = 200;

/** `UploadThing` route config: explicit MIME keys, never `image`/`video`/`blob` wildcards. */
export const FILE_ROUTE_CONFIG = {
  "image/jpeg": { maxFileSize: "8MB", maxFileCount: MAX_FILES_PER_UPLOAD },
  "image/png": { maxFileSize: "8MB", maxFileCount: MAX_FILES_PER_UPLOAD },
  "image/webp": { maxFileSize: "8MB", maxFileCount: MAX_FILES_PER_UPLOAD },
  "image/gif": { maxFileSize: "8MB", maxFileCount: MAX_FILES_PER_UPLOAD },
  "image/avif": { maxFileSize: "8MB", maxFileCount: MAX_FILES_PER_UPLOAD },
  "image/svg+xml": { maxFileSize: "512KB", maxFileCount: MAX_FILES_PER_UPLOAD },
} as const;

/** Value for `<input accept>` / dropzone. */
export const UPLOAD_ACCEPT = UPLOADABLE_MIME_TYPES.join(",");

export function isUploadableMime(mime: string | null | undefined): mime is UploadableMime {
  return !!mime && (UPLOADABLE_MIME_TYPES as readonly string[]).includes(mime);
}

export function isSvgMime(mime: string | null | undefined): boolean {
  return mime === SVG_MIME_TYPE;
}

export function maxBytesFor(mime: UploadableMime): number {
  return mime === SVG_MIME_TYPE ? MAX_SVG_BYTES : MAX_RASTER_BYTES;
}

export interface UploadCandidate {
  name: string;
  type: string;
  size: number;
}

/**
 * Validates what the CLIENT claims about a file. This is advisory only —
 * it produces fast, friendly errors (and gates the middleware); the real
 * check is the byte-level inspection after upload.
 * Returns an error message, or null when acceptable.
 */
export function validateUploadCandidate(file: UploadCandidate): string | null {
  if (!file.name || file.name.length > MAX_FILENAME_LENGTH) {
    return "File name is missing or too long.";
  }
  if (!isUploadableMime(file.type)) {
    return `"${file.name}": only JPEG, PNG, WebP, GIF, AVIF and SVG images can be uploaded.`;
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return `"${file.name}" is empty.`;
  }
  if (file.size > maxBytesFor(file.type)) {
    const limit = file.type === SVG_MIME_TYPE ? "512 KB" : "8 MB";
    return `"${file.name}" is too large (limit ${limit} for this type).`;
  }
  return null;
}

/** Library-safe display filename: no path separators / control characters. */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]+/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return (cleaned || "upload").slice(0, MAX_FILENAME_LENGTH);
}

/**
 * Only files served from UploadThing's CDN may be fetched for verification
 * (SSRF guard — the URL comes from a signed callback, but we still pin it).
 */
export function isTrustedUploadUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return (
    host === "ufs.sh" ||
    host.endsWith(".ufs.sh") ||
    host === "utfs.io" ||
    host.endsWith(".utfs.io")
  );
}
