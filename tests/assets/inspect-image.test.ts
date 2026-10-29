import { describe, expect, it } from "vitest";
import { inspectImageBytes } from "@/lib/assets/inspect-image";

const u8 = (...n: number[]) => Uint8Array.from(n);

/** Minimal valid PNG header + IHDR (width x height). image-size reads only the header. */
function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const dv = new DataView(b.buffer);
  dv.setUint32(8, 13);
  b.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  b.set([8, 6, 0, 0, 0], 24);
  return b;
}

function gif(w: number, h: number): Uint8Array {
  const b = new Uint8Array(13);
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
  b[6] = w & 255; b[7] = w >> 8; b[8] = h & 255; b[9] = h >> 8;
  return b;
}

const enc = (s: string) => new TextEncoder().encode(s);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';

describe("inspectImageBytes", () => {
  it("accepts a PNG and reads its dimensions", () => {
    const r = inspectImageBytes(png(640, 480), "image/png");
    expect(r).toMatchObject({ ok: true, kind: "raster", mime: "image/png", width: 640, height: 480 });
  });

  it("accepts a GIF", () => {
    const r = inspectImageBytes(gif(10, 20), "image/gif");
    expect(r).toMatchObject({ ok: true, width: 10, height: 20 });
  });

  it("rejects a PNG declared as JPEG (declared/real mismatch)", () => {
    const r = inspectImageBytes(png(10, 10), "image/jpeg");
    expect(r.ok).toBe(false);
  });

  it("rejects HTML/script bytes declared as an image", () => {
    expect(inspectImageBytes(enc("<html><script>alert(1)</script></html>"), "image/png").ok).toBe(false);
  });

  it("rejects an SVG payload declared as PNG", () => {
    expect(inspectImageBytes(enc(SVG), "image/png").ok).toBe(false);
  });

  it("rejects PNG bytes declared as SVG", () => {
    expect(inspectImageBytes(png(5, 5), "image/svg+xml").ok).toBe(false);
  });

  it("rejects empty, truncated and garbage input", () => {
    expect(inspectImageBytes(new Uint8Array(0), "image/png").ok).toBe(false);
    expect(inspectImageBytes(u8(0x89, 0x50), "image/png").ok).toBe(false);
    expect(inspectImageBytes(u8(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), "image/png").ok).toBe(false);
  });

  it("rejects absurd dimensions", () => {
    expect(inspectImageBytes(png(30000, 10), "image/png").ok).toBe(false);
  });

  it("rejects unsupported declared types (video, pdf)", () => {
    expect(inspectImageBytes(png(5, 5), "video/mp4").ok).toBe(false);
    expect(inspectImageBytes(enc("%PDF-1.4"), "application/pdf").ok).toBe(false);
  });

  it("accepts a clean SVG and returns sanitized markup + size", () => {
    const r = inspectImageBytes(enc(SVG), "image/svg+xml");
    expect(r).toMatchObject({ ok: true, kind: "svg", width: 24, height: 24, modified: false });
  });

  it("flags SVGs that needed cleaning, and rejects active ones", () => {
    const dirty = SVG.replace("<path", '<metadata/><path data-x="1"');
    const r = inspectImageBytes(enc(dirty), "image/svg+xml");
    expect(r).toMatchObject({ ok: true, kind: "svg", modified: true });
    expect(inspectImageBytes(enc(SVG.replace("<path", "<script>1</script><path")), "image/svg+xml").ok).toBe(false);
  });

  it("rejects non-UTF-8 SVG bytes", () => {
    expect(inspectImageBytes(u8(0xff, 0xfe, 0x3c, 0x00), "image/svg+xml").ok).toBe(false);
  });
});
