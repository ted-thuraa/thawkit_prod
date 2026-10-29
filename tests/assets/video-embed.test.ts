import { describe, expect, it } from "vitest";
import {
  buildVideoEmbedUrl,
  isAllowedEmbedUrl,
  parseVideoInput,
} from "@/lib/video-embed";

const YT = "dQw4w9WgXcQ";
const LOOM = "0123456789abcdef0123456789abcdef";

describe("parseVideoInput — YouTube", () => {
  it.each([
    [`https://www.youtube.com/watch?v=${YT}`],
    [`https://youtube.com/watch?v=${YT}&t=10s`],
    [`https://m.youtube.com/watch?v=${YT}`],
    [`https://youtu.be/${YT}`],
    [`https://youtu.be/${YT}?si=abc`],
    [`https://www.youtube.com/embed/${YT}`],
    [`https://www.youtube-nocookie.com/embed/${YT}`],
    [`https://www.youtube.com/shorts/${YT}`],
    [`https://www.youtube.com/live/${YT}`],
    [`www.youtube.com/watch?v=${YT}`],
    [`  ${YT}  `],
  ])("parses %s", (input) => {
    expect(parseVideoInput(input)).toEqual({ provider: "youtube", video_id: YT });
  });
});

describe("parseVideoInput — Loom", () => {
  it.each([
    [`https://www.loom.com/share/${LOOM}`],
    [`https://loom.com/share/${LOOM}?sid=x`],
    [`https://www.loom.com/embed/${LOOM}`],
  ])("parses %s", (input) => {
    expect(parseVideoInput(input)).toEqual({ provider: "loom", video_id: LOOM });
  });

  it("accepts a bare Loom id only when Loom is the preferred provider", () => {
    expect(parseVideoInput(LOOM)).toBeNull();
    expect(parseVideoInput(LOOM, "loom")).toEqual({ provider: "loom", video_id: LOOM });
  });
});

describe("parseVideoInput — rejects", () => {
  it.each([
    "", "   ", "not a url",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "ftp://www.youtube.com/watch?v=" + YT,
    "https://evil.example/watch?v=" + YT,
    "https://youtube.com.evil.example/watch?v=" + YT,
    "https://www.youtube.com.evil.example/embed/" + YT,
    "https://evilyoutube.com/watch?v=" + YT,
    "https://user:pass@www.youtube.com/watch?v=" + YT,
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/watch?v=" + YT + "<script>",
    "https://www.youtube.com/embed/../watch",
    "https://www.youtube.com/watch",
    "https://www.youtube.com/channel/UC123",
    "https://www.loom.com/share/not-a-hex-id",
    "https://vimeo.com/123456",
  ])("%s", (input) => {
    expect(parseVideoInput(input)).toBeNull();
  });
});

describe("buildVideoEmbedUrl", () => {
  it("builds YouTube embed URLs with options", () => {
    expect(buildVideoEmbedUrl({ provider: "youtube", video_id: YT })).toBe(
      `https://www.youtube.com/embed/${YT}`,
    );
    expect(
      buildVideoEmbedUrl({ provider: "youtube", video_id: YT }, { privacyMode: true, muted: true, controls: false }),
    ).toBe(`https://www.youtube-nocookie.com/embed/${YT}?mute=1&controls=0`);
    expect(
      buildVideoEmbedUrl({ provider: "youtube", video_id: YT }, { loop: true }),
    ).toBe(`https://www.youtube.com/embed/${YT}?loop=1&playlist=${YT}`);
  });

  it("builds Loom embed URLs", () => {
    expect(buildVideoEmbedUrl({ provider: "loom", video_id: LOOM })).toBe(
      `https://www.loom.com/embed/${LOOM}`,
    );
  });

  it.each([
    ["x/../../redirect"],
    [`${YT}?autoplay=1&evil=1`],
    [`${YT}#frag`],
    ["https://evil.example/x"],
    ["//evil.example"],
    ["javascript:alert(1)"],
    [""],
    ["a b c d e f g"],
    ["{{cms.field}}"],
  ])("refuses unvalidated YouTube id %j", (id) => {
    expect(buildVideoEmbedUrl({ provider: "youtube", video_id: id })).toBeNull();
  });

  it("refuses unknown providers and prototype tricks", () => {
    expect(buildVideoEmbedUrl({ provider: "vimeo", video_id: "123" })).toBeNull();
    expect(buildVideoEmbedUrl({ provider: "__proto__", video_id: YT })).toBeNull();
    expect(buildVideoEmbedUrl({ provider: "constructor", video_id: YT })).toBeNull();
    expect(buildVideoEmbedUrl({ provider: "youtube", video_id: YT.repeat(2) })).toBeNull();
  });

  it("every produced URL passes the origin allow-list", () => {
    for (const url of [
      buildVideoEmbedUrl({ provider: "youtube", video_id: YT }),
      buildVideoEmbedUrl({ provider: "youtube", video_id: YT }, { privacyMode: true }),
      buildVideoEmbedUrl({ provider: "loom", video_id: LOOM }),
    ]) {
      expect(url && isAllowedEmbedUrl(url)).toBe(true);
    }
  });
});

describe("isAllowedEmbedUrl", () => {
  it.each([
    ["https://www.youtube.com/embed/x", true],
    ["https://www.loom.com/embed/x", true],
    ["http://www.youtube.com/embed/x", false],
    ["https://youtube.com/embed/x", false],
    ["https://www.youtube.com.evil.example/embed/x", false],
    ["https://evil.example/embed/x", false],
    ["https://user@www.youtube.com/embed/x", false],
    ["javascript:alert(1)", false],
    ["", false],
  ])("%s → %s", (url, expected) => {
    expect(isAllowedEmbedUrl(url)).toBe(expected);
  });
});
