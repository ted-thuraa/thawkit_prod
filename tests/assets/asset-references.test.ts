import { describe, expect, it } from "vitest";
import { collectAssetIdsFromJson } from "@/lib/editor/bootstrap/collect-asset-ids";
import {
  createAssetVariable,
  getImageUrlFromVariable,
} from "@/lib/variable-utils";
import { DEFAULT_ASSETS } from "@/lib/asset-constants";

const IMG = "11111111-1111-4111-8111-111111111111";
const ICON = "22222222-2222-4222-8222-222222222222";
const POSTER = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

interface TestLayer {
  id: string;
  name: string;
  classes?: string[];
  settings?: Record<string, unknown>;
  variables: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  children?: TestLayer[];
}

/** The same write the controls perform (ImageSettings/IconSettings/VideoSettings). */
const assign = (layer: TestLayer, patch: Record<string, unknown>): TestLayer => ({
  ...layer,
  variables: { ...layer.variables, ...patch },
});

describe("asset references survive save → reload → resolve", () => {
  const page = () => {
    let image: TestLayer = {
      id: "l1", name: "image", classes: ["rounded"], settings: { tag: "img" },
      variables: { image: { src: createAssetVariable(""), alt: { type: "dynamic_text", data: { content: "Hero" } } } },
    };
    image = assign(image, { image: { ...image.variables.image, src: createAssetVariable(IMG) } });
    const icon = assign(
      { id: "l2", name: "icon", variables: {} },
      { icon: { src: createAssetVariable(ICON) } },
    );
    const video = assign(
      { id: "l3", name: "video", variables: {} },
      { video: { src: { type: "video", data: { provider: "loom", video_id: "0123456789abcdef0123456789abcdef" } }, poster: createAssetVariable(POSTER) } },
    );
    return [{ id: "root", name: "root", variables: {}, children: [image, icon, video] }] as TestLayer[];
  };

  it("assigning an asset changes only that property (unrelated config preserved)", () => {
    const [root] = page();
    const image = root.children![0];
    expect(image.classes).toEqual(["rounded"]);
    expect(image.settings).toEqual({ tag: "img" });
    expect(image.variables.image.alt.data.content).toBe("Hero");
    expect(image.variables.image.src).toEqual({ type: "asset", data: { asset_id: IMG } });
  });

  it("only IDs are persisted — no URLs, keys or tokens in page JSON", () => {
    const json = JSON.stringify(page());
    expect(json).not.toMatch(/ufs\.sh|utfs\.io|https?:\/\//);
    expect(json).not.toMatch(/storage_path|public_url|token/i);
  });

  it("a JSON round-trip (save → reload) keeps every reference and the bootstrap finds them all", () => {
    const reloaded = JSON.parse(JSON.stringify(page()));
    expect([...collectAssetIdsFromJson(reloaded)].sort()).toEqual([ICON, IMG, POSTER].sort());
  });

  it("video links are NOT assets: the provider/id never enters the asset set", () => {
    const ids = collectAssetIdsFromJson(page());
    expect(ids.has("0123456789abcdef0123456789abcdef")).toBe(false);
  });

  describe("resolution at render time", () => {
    const library: Record<string, { public_url: string | null; content?: string | null; width?: number | null; height?: number | null }> = {
      [IMG]: { public_url: "https://app.ufs.sh/f/img" },
      [ICON]: { public_url: null, content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"/>', width: 24, height: 24 },
    };
    const getAsset = (id: string) => library[id] ?? null;

    it("resolves a stored file to its URL", () => {
      expect(getImageUrlFromVariable(createAssetVariable(IMG), getAsset)).toBe("https://app.ufs.sh/f/img");
    });

    it("renders inline-only SVGs through an inert data URL", () => {
      const url = getImageUrlFromVariable(createAssetVariable(ICON), getAsset);
      expect(url?.startsWith("data:image/svg+xml")).toBe(true);
    });

    it("REPLACE: pointing the same property at another asset changes the URL, nothing else", () => {
      library[OTHER] = { public_url: "https://app.ufs.sh/f/other" };
      expect(getImageUrlFromVariable(createAssetVariable(OTHER), getAsset)).toBe("https://app.ufs.sh/f/other");
    });

    it("REMOVE: an emptied reference falls back to the placeholder, never to a stale URL", () => {
      expect(getImageUrlFromVariable(createAssetVariable(""), getAsset)).toBe(DEFAULT_ASSETS.IMAGE);
      expect(getImageUrlFromVariable(createAssetVariable(""), getAsset, undefined, undefined, false)).toBeUndefined();
    });

    it("a deleted / foreign / missing asset resolves to nothing (no throw, no broken URL)", () => {
      expect(getImageUrlFromVariable(createAssetVariable(POSTER), getAsset)).toBeUndefined();
      expect(getImageUrlFromVariable(createAssetVariable("not-found"), () => null)).toBeUndefined();
    });
  });
});
