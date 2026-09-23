// path: src/hooks/use-campaign-editor-url.ts

"use client";

import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Adapted from Ycode's hooks/use-editor-url.ts (github.com/ycode/ycode, MIT
 * licensed). Pure route/query interpretation: reads `usePathname()` +
 * `useSearchParams()` and returns a discriminated `CampaignEditorUrlState`,
 * plus navigation helpers that push canonical URLs. Nothing here touches
 * data loading — see CampaignEditorMain.tsx for why this exists (the
 * persistent-builder pattern) and what consumes this hook's output.
 *
 * SCOPE (this port): matches `campaign/[campaignId]/editor/{layers,pages,components}/[id]`
 * only. Ycode's hook also matches collections/settings/localization/
 * profile/forms/integrations routes — all excluded here per current scope
 * (CMS/Collections excluded entirely; the others have no Thawkit
 * equivalent yet). Extend this hook's match list the same way Ycode's
 * does — one additional `if (xMatch) return {...}` block per new route
 * type — when those land.
 *
 * `campaignId` is accepted as an explicit argument rather than regex-parsed
 * out of the pathname alongside everything else: the Server Component
 * layout already resolved it authoritatively from `params` before any of
 * this client code runs, so re-deriving it here would just be a second,
 * potentially-divergent source of truth for a value we already have.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type EditorRouteType = "layers" | "page" | "component" | null;
export type PageSettingsTab = "general" | "seo" | "custom-code";
export type RightPanelTab = "design" | "settings" | "interactions";
export type Viewport = "desktop" | "tablet" | "mobile";
/** Matches EditorBody.tsx's Tabs value — inferred from route type, same as Ycode's `sidebarTab`. */
export type SidebarTab = "layers" | "pages";

export interface CampaignEditorUrlState {
  type: EditorRouteType;
  /** `pageId` for 'layers'/'page' routes, `componentId` for 'component' routes. */
  resourceId: string | null;
  /** Page-settings edit mode — mirrors Ycode's `?edit=` on the pages route. */
  isEditingPage: boolean;
  editTab: PageSettingsTab | null;
  sidebarTab: SidebarTab;
  view: Viewport | null;
  rightTab: RightPanelTab | null;
  layerId: string | null;
  variantId: string | null;
}

/**
 * Convention (matching Ycode): every page's root `layers` array contains
 * exactly one non-deletable root node with this id. Established here as
 * the URL default so an unqualified `/layers/[pageId]` always resolves to
 * a defined selection; actually enforcing "body is non-deletable" is a
 * Phase 6 (tree-mutation) concern, not something this hook or the schema
 * can enforce on its own.
 */
const DEFAULT_LAYER_ID = "body";

// ─── Standalone (non-hook) URL helpers ─────────────────────────────────────
//
// Ported from Ycode's `updateUrlQueryParam` (hooks/use-editor-url.ts) plus
// its module-level debounce wrapper around the `?layer=` param
// (stores/useEditorStore.ts's `scheduleLayerUrlUpdate`). Both live here,
// as plain exported functions rather than values returned from the hook,
// for the same reason Ycode keeps them separate: `useEditorStore` (Zustand)
// runs OUTSIDE React's render tree and cannot call a hook — but it still
// needs to mirror layer selection into the URL when the user clicks a
// layer in the canvas or tree, not just when a component calls
// `navigateToLayers`/`replaceLayerIdInUrl` directly.

/**
 * Set (or clear) a single query param via `history.replaceState`, without
 * pushing a new history entry and without re-writing the URL when the
 * value hasn't actually changed (avoids Next.js's patched
 * `history.replaceState` triggering a router-wide re-render for a no-op).
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
// tree), short enough that the URL is accurate by the time anyone copies
// it. Matches Ycode's own LAYER_URL_DEBOUNCE_MS exactly.
const LAYER_URL_DEBOUNCE_MS = 250;
let pendingLayerUrlTimer: ReturnType<typeof setTimeout> | null = null;
let pendingLayerUrlValue: string | null = null;

/**
 * Debounced version of `updateUrlQueryParam('layer', id)`, for high-frequency
 * callers (canvas click, tree click, arrow-key navigation) — see
 * useEditorStore's `setSelectedLayerId`, which is the one caller of this.
 */
export function scheduleLayerIdUrlUpdate(layerId: string | null): void {
  pendingLayerUrlValue = layerId;
  if (pendingLayerUrlTimer !== null) return;
  pendingLayerUrlTimer = setTimeout(() => {
    pendingLayerUrlTimer = null;
    updateUrlQueryParam("layer", pendingLayerUrlValue);
  }, LAYER_URL_DEBOUNCE_MS);
}

export function useCampaignEditorUrl(campaignId: string) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const base = `/campaign/${campaignId}/edit`;

  const urlState = useMemo((): CampaignEditorUrlState => {
    const layersMatch = pathname?.match(
      /^\/campaign\/[^/]+\/edit\/layers\/([^/]+)$/,
    );
    const pageMatch = pathname?.match(
      /^\/campaign\/[^/]+\/edit\/pages\/([^/]+)$/,
    );
    const componentMatch = pathname?.match(
      /^\/campaign\/[^/]+\/edit\/components\/([^/]+)$/,
    );

    if (layersMatch) {
      return {
        type: "layers",
        resourceId: layersMatch[1],
        isEditingPage: false,
        editTab: null,
        sidebarTab: "layers",
        view: (searchParams?.get("view") as Viewport | null) ?? null,
        rightTab: (searchParams?.get("tab") as RightPanelTab | null) ?? null,
        layerId: searchParams?.get("layer") ?? null,
        variantId: null,
      };
    }

    if (pageMatch) {
      const editParam = searchParams?.get("edit");
      const editTab =
        editParam && editParam !== "" && editParam !== "general"
          ? (editParam as PageSettingsTab)
          : null;

      return {
        type: "page",
        resourceId: pageMatch[1],
        isEditingPage: searchParams?.has("edit") ?? false,
        editTab,
        sidebarTab: "pages",
        view: (searchParams?.get("view") as Viewport | null) ?? null,
        rightTab: (searchParams?.get("tab") as RightPanelTab | null) ?? null,
        layerId: searchParams?.get("layer") ?? null,
        variantId: null,
      };
    }

    if (componentMatch) {
      return {
        type: "component",
        resourceId: componentMatch[1],
        isEditingPage: false,
        editTab: null,
        // Matches Ycode: component-edit mode shows the Layers sidebar
        // (editing the component's own tree), not a Pages tree.
        sidebarTab: "layers",
        view: null,
        rightTab: (searchParams?.get("tab") as RightPanelTab | null) ?? null,
        layerId: searchParams?.get("layer") ?? null,
        variantId: searchParams?.get("variant") ?? null,
      };
    }

    // Base /campaign/[campaignId]/editor route — no resource selected yet.
    return {
      type: null,
      resourceId: null,
      isEditingPage: false,
      editTab: null,
      sidebarTab: "layers",
      view: null,
      rightTab: null,
      layerId: null,
      variantId: null,
    };
  }, [pathname, searchParams]);

  const navigateToLayers = useCallback(
    (
      pageId: string,
      options?: {
        view?: Viewport;
        rightTab?: RightPanelTab;
        layerId?: string;
        /**
         * Use router.replace() instead of push(). Ycode's own
         * navigateToLayers always pushes — appropriate for a real user
         * action (clicking a page) that should be back-navigable. This
         * codebase adds `replace` for the one case Ycode doesn't
         * distinguish: CampaignEditorMain's synthetic "no/invalid resource
         * in the URL, redirect to the funnel's first page" correction,
         * where the pre-redirect URL was never a real navigation target
         * the user should be able to land back on via the back button.
         */
        replace?: boolean;
      },
    ) => {
      const params = new URLSearchParams(window.location.search);
      params.delete("edit"); // layers view is never in page-settings edit mode
      params.set("view", options?.view ?? params.get("view") ?? "desktop");
      params.set("tab", options?.rightTab ?? params.get("tab") ?? "design");
      params.set(
        "layer",
        options?.layerId ?? params.get("layer") ?? DEFAULT_LAYER_ID,
      );
      const url = `${base}/layers/${pageId}?${params.toString()}`;
      if (options?.replace) {
        router.replace(url);
      } else {
        router.push(url);
      }
    },
    [router, base],
  );

  const navigateToPageSettings = useCallback(
    (pageId: string, tab?: PageSettingsTab) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("edit", tab && tab !== "general" ? tab : "general");
      router.push(`${base}/pages/${pageId}?${params.toString()}`);
    },
    [router, base, searchParams],
  );

  /**
   * Switch to the Pages tab WITHOUT opening the settings panel — the
   * `pages` route type minus the `?edit=` param. Mirrors Ycode's split
   * between `navigateToPage` (just shows the tree) and `navigateToPageEdit`
   * (opens settings). Needed by LeftPanel.tsx's tab click handler: clicking
   * "Pages" should show the list, not immediately pop open a page's
   * settings form.
   */
  const navigateToPages = useCallback(
    (pageId: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.delete("edit");
      const query = params.toString();
      router.push(`${base}/pages/${pageId}${query ? `?${query}` : ""}`);
    },
    [router, base, searchParams],
  );

  const navigateToComponent = useCallback(
    (
      componentId: string,
      options?: {
        rightTab?: RightPanelTab;
        layerId?: string;
        variantId?: string | null;
      },
    ) => {
      const current = new URLSearchParams(window.location.search);
      const params = new URLSearchParams();
      params.set("tab", options?.rightTab ?? current.get("tab") ?? "design");
      if (options?.layerId) params.set("layer", options.layerId);
      const variant =
        options?.variantId !== undefined
          ? options.variantId
          : current.get("variant");
      if (variant) params.set("variant", variant);
      router.push(`${base}/components/${componentId}?${params.toString()}`);
    },
    [router, base],
  );

  const navigateToEditor = useCallback(() => {
    router.push(base);
  }, [router, base]);

  /**
   * Mirrors the selected layer back into the URL WITHOUT pushing a new
   * history entry. Thin wrapper around `updateUrlQueryParam` for React
   * callers; `useEditorStore`'s `setSelectedLayerId` calls
   * `scheduleLayerIdUrlUpdate` directly instead, since it can't use this
   * hook (see the standalone-helpers comment above).
   */
  const replaceLayerIdInUrl = useCallback((layerId: string | null) => {
    updateUrlQueryParam("layer", layerId);
  }, []);

  return {
    urlState,
    navigateToLayers,
    navigateToPageSettings,
    navigateToPages,
    navigateToComponent,
    navigateToEditor,
    replaceLayerIdInUrl,
  };
}
