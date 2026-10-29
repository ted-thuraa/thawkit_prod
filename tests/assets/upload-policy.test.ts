import { describe, expect, it } from "vitest";
import {
  FILE_ROUTE_CONFIG,
  UPLOADABLE_MIME_TYPES,
  isTrustedUploadUrl,
  isUploadableMime,
  sanitizeFilename,
  validateUploadCandidate,
} from "@/lib/assets/upload-policy";

describe("upload policy", () => {
  it("accepts supported images and SVG", () => {
    for (const type of UPLOADABLE_MIME_TYPES) {
      expect(validateUploadCandidate({ name: "a", type, size: 1000 })).toBeNull();
    }
  });

  it.each([
    "video/mp4", "video/webm", "audio/mpeg", "application/pdf", "font/woff2",
    "text/html", "application/octet-stream", "image/bmp", "image/tiff", "image/jpg", "",
  ])("rejects %s", (type) => {
    expect(validateUploadCandidate({ name: "a", type, size: 1000 })).not.toBeNull();
    expect(isUploadableMime(type)).toBe(false);
  });

  it("enforces per-type size limits", () => {
    expect(validateUploadCandidate({ name: "a.png", type: "image/png", size: 8 * 1024 * 1024 })).toBeNull();
    expect(validateUploadCandidate({ name: "a.png", type: "image/png", size: 8 * 1024 * 1024 + 1 })).toMatch(/too large/);
    expect(validateUploadCandidate({ name: "a.svg", type: "image/svg+xml", size: 512 * 1024 + 1 })).toMatch(/too large/);
  });

  it("rejects empty and overlong names", () => {
    expect(validateUploadCandidate({ name: "a", type: "image/png", size: 0 })).toMatch(/empty/);
    expect(validateUploadCandidate({ name: "x".repeat(300), type: "image/png", size: 10 })).not.toBeNull();
  });

  it("route config has explicit MIME keys only (no wildcards)", () => {
    expect(Object.keys(FILE_ROUTE_CONFIG).sort()).toEqual([...UPLOADABLE_MIME_TYPES].sort());
    for (const key of Object.keys(FILE_ROUTE_CONFIG)) {
      expect(["image", "video", "audio", "blob", "pdf", "text"]).not.toContain(key);
    }
  });

  it("sanitizes filenames", () => {
    const traversal = sanitizeFilename("../../etc/passwd");
    expect(traversal).not.toMatch(/[\\/]/);
    expect(traversal.startsWith(".")).toBe(false);
    expect(sanitizeFilename("C:\\Users\\x\\a.png")).not.toMatch(/[\\/]/);
    expect(sanitizeFilename("a\u0000b.png")).toBe("ab.png");
    expect(sanitizeFilename("   ")).toBe("upload");
  });

  it("only trusts https UploadThing CDN hosts", () => {
    expect(isTrustedUploadUrl("https://abc123.ufs.sh/f/key")).toBe(true);
    expect(isTrustedUploadUrl("https://utfs.io/f/key")).toBe(true);
    expect(isTrustedUploadUrl("http://abc.ufs.sh/f/key")).toBe(false);
    expect(isTrustedUploadUrl("https://evil.example/f/key")).toBe(false);
    expect(isTrustedUploadUrl("https://ufs.sh.evil.example/f/k")).toBe(false);
    expect(isTrustedUploadUrl("https://evilufs.sh/f/k")).toBe(false);
    expect(isTrustedUploadUrl("http://169.254.169.254/latest")).toBe(false);
    expect(isTrustedUploadUrl("not a url")).toBe(false);
  });
});
