// path: src/lib/assets/asset-usage-summary.ts

import type { AssetUsage } from "./delete-asset";

/** Usage grouped for display (client-safe, pure). */
export interface AssetUsageSummary {
  total: number;
  pages: Array<{ id: string; name: string }>;
  components: Array<{ id: string; name: string }>;
  layerStyles: Array<{ id: string; name: string }>;
  /** `name` is the collection the item belongs to. */
  cmsItems: Array<{ id: string; name: string }>;
  /** Funnels whose CURRENT published version references the asset. */
  publishedFunnels: Array<{ id: string; name: string }>;
}

export function summarizeUsages(usages: readonly AssetUsage[]): AssetUsageSummary {
  const pick = (kind: AssetUsage["kind"]) =>
    usages.filter((u) => u.kind === kind).map(({ id, name }) => ({ id, name }));
  return {
    total: usages.length,
    pages: pick("page"),
    components: pick("component"),
    layerStyles: pick("layer_style"),
    cmsItems: pick("cms_item"),
    publishedFunnels: pick("published_version"),
  };
}
