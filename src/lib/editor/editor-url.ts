// path: src/lib/editor/editor-url.ts

/**
 * Pure (React-free, store-free) URL helpers for the campaign editor.
 *
 * These live outside `hooks/use-editor-url.ts` on purpose: `useEditorStore`
 * (Zustand) runs outside React's render tree and needs to mirror the selected
 * layer into the URL, but `use-editor-url.ts` in turn needs to read
 * `useEditorStore` (for the centralized page-navigation helper). Keeping the
 * leaf helpers here means neither module has to import the other.
 *
 * ROUTE / QUERY CONTRACT
 *
 *   /campaign/{campaignId}/edit/pages/{pageId}?view=desktop&tab=design&layer=body
 *   /campaign/{campaignId}/edit/pages/{pageId}?...&edit=general|seo|custom-code
 *   /campaign/{campaignId}/edit/components/{componentId}?tab=design&layer=...&variant=...
 *
 *   view   desktop | tablet | mobile                 (canvas viewport)
 *   tab    design | settings | interactions          (RIGHT inspector tab)
 *   layer  primary selected layer id, default `body`
 *   edit   page-settings mode (general | seo | custom-code); absent otherwise
 *
 * The LEFT sidebar tab (Layers / Pages) is NOT part of the URL — it is owned
 * by `useEditorStore.activeSidebarTab`.
 */

export type Viewport = "desktop" | "tablet" | "mobile";
export type RightPanelTab = "design" | "settings" | "interactions";
export type PageSettingsTab = "general" | "seo" | "custom-code";

export const DEFAULT_VIEW: Viewport = "desktop";
export const DEFAULT_RIGHT_TAB: RightPanelTab = "design";

/**
 * Convention: every page's root `layers` array contains exactly one
 * non-deletable root node with this id. It is the URL default so an
 * unqualified page route always resolves to a defined selection.
 */
export const DEFAULT_LAYER_ID = "body";

const VIEWPORTS: readonly Viewport[] = ["desktop", "tablet", "mobile"];
const RIGHT_TABS: readonly RightPanelTab[] = [
  "design",
  "settings",
  "interactions",
];
const PAGE_SETTINGS_TABS: readonly PageSettingsTab[] = [
  "general",
  "seo",
  "custom-code",
];

export function parseViewport(value: string | null | undefined): Viewport | null {
  return VIEWPORTS.includes(value as Viewport) ? (value as Viewport) : null;
}

export function parseRightTab(
  value: string | null | undefined,
): RightPanelTab | null {
  return RIGHT_TABS.includes(value as RightPanelTab)
    ? (value as RightPanelTab)
    : null;
}

export function parsePageSettingsTab(
  value: string | null | undefined,
): PageSettingsTab | null {
  return PAGE_SETTINGS_TABS.includes(value as PageSettingsTab)
    ? (value as PageSettingsTab)
    : null;
}

export interface PageUrlOptions {
  view?: Viewport;
  rightTab?: RightPanelTab;
  layerId?: string;
  /** When set, the URL is in page-settings mode (`?edit=<tab>`). */
  settingsTab?: PageSettingsTab;
}

/**
 * Build the canonical page-route URL. `view`, `tab` and `layer` always get a
 * value (explicit option → fallback → default) so the editor entry URL is
 * always `?view=…&tab=…&layer=…`. `edit` is only emitted for settings mode —
 * leaving settings mode simply omits it.
 */
export function buildPageUrl(
  campaignId: string,
  pageId: string,
  options: PageUrlOptions = {},
  fallback?: URLSearchParams,
): string {
  const params = new URLSearchParams();
  params.set(
    "view",
    options.view ?? parseViewport(fallback?.get("view")) ?? DEFAULT_VIEW,
  );
  params.set(
    "tab",
    options.rightTab ??
      parseRightTab(fallback?.get("tab")) ??
      DEFAULT_RIGHT_TAB,
  );
  params.set(
    "layer",
    options.layerId ?? fallback?.get("layer") ?? DEFAULT_LAYER_ID,
  );
  if (options.settingsTab) params.set("edit", options.settingsTab);
  return `/campaign/${campaignId}/edit/pages/${pageId}?${params.toString()}`;
}

/** True when the browser is currently on a page/component editor route. */
export function isEditorResourceRoute(pathname?: string): boolean {
  const path =
    pathname ?? (typeof window !== "undefined" ? window.location.pathname : "");
  return /^\/campaign\/[^/]+\/edit\/(pages|components)\/[^/]+$/.test(path);
}

/**
 * Set (or clear) a single query param via `history.replaceState`, without
 * pushing a new history entry and without re-writing the URL when the value
 * hasn't actually changed (avoids Next.js's patched `history.replaceState`
 * triggering a router-wide re-render for a no-op).
 */
export function updateUrlQueryParam(
  key: string,
  value: string | null | undefined,
): void {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams(window.location.search);
  const current = params.get(key);
  if ((value ?? null) === current) return;

  if (value) params.set(key, value);
  else params.delete(key);

  const query = params.toString();
  const newUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
  window.history.replaceState({ ...window.history.state }, "", newUrl);
}

// Debounce window for the `?layer=…` URL mirror — long enough to coalesce
// rapid selection changes (e.g. arrow-key navigation through the layers
// tree), short enough that the URL is accurate by the time anyone copies it.
const LAYER_URL_DEBOUNCE_MS = 250;
let pendingLayerUrlTimer: ReturnType<typeof setTimeout> | null = null;
let pendingLayerUrlValue: string | null = null;

/**
 * Debounced version of `updateUrlQueryParam('layer', id)`, for high-frequency
 * callers (canvas click, tree click, arrow-key navigation). The route check
 * runs when the timer FIRES (not when it is scheduled) so a selection made
 * just before leaving the editor never writes a stray `layer` param onto a
 * non-editor URL.
 */
export function scheduleLayerIdUrlUpdate(layerId: string | null): void {
  pendingLayerUrlValue = layerId;
  if (pendingLayerUrlTimer !== null) return;
  pendingLayerUrlTimer = setTimeout(() => {
    pendingLayerUrlTimer = null;
    if (!isEditorResourceRoute()) return;
    updateUrlQueryParam("layer", pendingLayerUrlValue);
  }, LAYER_URL_DEBOUNCE_MS);
}
