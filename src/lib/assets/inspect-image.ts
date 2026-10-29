// path: src/lib/assets/inspect-image.ts

/**
 * Byte-level verification of an uploaded file. The MIME type the browser
 * sent is a claim; this module decides what the bytes actually are.
 *
 * - Raster: `image-size` sniffs the real format from the header; it must be
 *   on the allow-list AND agree with the declared type (a PNG renamed `.jpg`,
 *   or an HTML/SVG file declared as an image, is rejected).
 * - SVG: must be strict UTF-8 text and pass the allow-list sanitizer. The
 *   sanitized markup (not the upload) is what we trust from then on.
 *
 * Pure: no I/O, no server-only imports.
 */

import { imageSize } from "image-size";
import { sanitizeSvg } from "./svg-sanitizer";
import {
  SVG_MIME_TYPE,
  isUploadableMime,
  maxBytesFor,
  type UploadableMime,
} from "./upload-policy";

export type InspectResult =
  | {
      ok: true;
      kind: "raster";
      mime: UploadableMime;
      width: number | null;
      height: number | null;
    }
  | {
      ok: true;
      kind: "svg";
      mime: typeof SVG_MIME_TYPE;
      width: number | null;
      height: number | null;
      /** Sanitized markup — the only form that may be stored / rendered. */
      svg: string;
      /** True when sanitizing dropped something (hosted file must be replaced). */
      modified: boolean;
    }
  | { ok: false; reason: string };

const DETECTED_TO_MIME: Record<string, UploadableMime> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

export function inspectImageBytes(
  bytes: Uint8Array,
  declaredMime: string,
): InspectResult {
  if (!isUploadableMime(declaredMime)) {
    return { ok: false, reason: "Unsupported file type." };
  }
  if (bytes.byteLength === 0) return { ok: false, reason: "File is empty." };
  if (bytes.byteLength > maxBytesFor(declaredMime)) {
    return { ok: false, reason: "File is too large." };
  }

  if (declaredMime === SVG_MIME_TYPE) {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return { ok: false, reason: "SVG must be UTF-8 text." };
    }
    const result = sanitizeSvg(text);
    if (!result.ok) return { ok: false, reason: result.reason };
    return {
      ok: true,
      kind: "svg",
      mime: SVG_MIME_TYPE,
      width: result.width,
      height: result.height,
      svg: result.svg,
      modified: result.modified,
    };
  }

  let detected: ReturnType<typeof imageSize>;
  try {
    detected = imageSize(bytes);
  } catch {
    return { ok: false, reason: "File is not a valid image." };
  }

  const realMime = DETECTED_TO_MIME[detected.type ?? ""];
  if (!realMime) return { ok: false, reason: "Unsupported or unrecognized image format." };
  if (realMime !== declaredMime) {
    return {
      ok: false,
      reason: "File contents do not match its declared type.",
    };
  }

  let width = detected.width ?? null;
  let height = detected.height ?? null;
  // EXIF orientations 5–8 are rotated 90°: displayed size swaps.
  if (detected.orientation && detected.orientation >= 5 && width && height) {
    [width, height] = [height, width];
  }
  if (!width || !height || width <= 0 || height <= 0) {
    return { ok: false, reason: "Could not read image dimensions." };
  }
  if (width > 20000 || height > 20000) {
    return { ok: false, reason: "Image dimensions are too large." };
  }

  return { ok: true, kind: "raster", mime: realMime, width, height };
}
