// path: src/hooks/use-editor-url.ts

"use client";

import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useEditorStore } from "@/stores/editor/useEditorStore";
import {
  DEFAULT_LAYER_ID,
  buildPageUrl,
  parsePageSettingsTab,
  parseRightTab,
  parseViewport,
  updateUrlQueryParam,
  type PageSettingsTab,
  type RightPanelTab,
  type Viewport,
} from "@/lib/editor/editor-url";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Pure route/query interpretation for the campaign editor: reads
 * `usePathname()` + `useSearchParams()` and returns a discriminated
 * `CampaignEditorUrlState`, plus navigation helpers that push canonical URLs.
 * Nothing here touches data loading — see builderMain.tsx for the
 * persistent-builder pattern and what consumes this hook's output.
 *
 * ROUTE MODEL (the `layers/[pageId]` route no longer exists):
 *
 *   /campaign/{campaignId}/edit/pages/{pageId}?view=desktop&tab=design&layer=body
 *   /campaign/{campaignId}/edit/pages/{pageId}?…&edit=general|seo|custom-code
 *   /campaign/{campaignId}/edit/components/{componentId}?tab=…&layer=…&variant=…
 *
 * The LEFT sidebar tab (Layers / Pages) is deliberately NOT derived from the
 * URL and has no query param: it is owned by
 * `useEditorStore().activeSidebarTab` (default "layers"). The URL only says
 * *what* is being edited (page / component / settings mode), never which
 * sidebar tab is showing.
 *
 * `campaignId` is accepted as an explicit argument rather than regex-parsed
 * out of the pathname: the Server Component layout already resolved it
 * authoritatively from `params` before any of this client code runs, so
 * re-deriving it here would just be a second, potentially-divergent source of
 * truth for a value we already have.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type { PageSettingsTab, RightPanelTab, Viewport };
export {
  scheduleLayerIdUrlUpdate,
  updateUrlQueryParam,
} from "@/lib/editor/editor-url";

export type EditorRouteType = "page" | "component" | null;

export interface CampaignEditorUrlState {
  type: EditorRouteType;
  /** `pageId` for 'page' routes, `componentId` for 'component' routes. */
  resourceId: string | null;
  /** Page-settings mode — `?edit=` is present on a page route. */
  isEditing: boolean;
  /** `?edit=` value; `null` for the default ("general") tab or outside settings mode. */
  editTab: PageSettingsTab | null;
  view: Viewport | null;
  /** RIGHT inspector tab (`?tab=`), not the left sidebar tab. */
  rightTab: RightPanelTab | null;
  layerId: string | null;
  variantId: string | null;
}

export interface NavigateToPageOptions {
  view?: Viewport;
  rightTab?: RightPanelTab;
  layerId?: string;
  /**
   * Use router.replace() instead of push(). Appropriate for synthetic
   * corrections (e.g. the base `/edit` route resolving to its first page, or
   * an invalid page id falling back) where the pre-redirect URL was never a
   * real navigation target the user should be able to land back on via the
   * back button.
   */
  replace?: boolean;
}

export function useCampaignEditorUrl(campaignId: string) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const base = `/campaign/${campaignId}/edit`;

  const urlState = useMemo((): CampaignEditorUrlState => {
    const pageMatch = pathname?.match(
      /^\/campaign\/[^/]+\/edit\/pages\/([^/]+)$/,
    );
    const componentMatch = pathname?.match(
      /^\/campaign\/[^/]+\/edit\/components\/([^/]+)$/,
    );

    if (pageMatch) {
      const editParam = searchParams?.get("edit");
      const parsedEditTab = parsePageSettingsTab(editParam);

      return {
        type: "page",
        resourceId: pageMatch[1],
        isEditing: searchParams?.has("edit") ?? false,
        editTab:
          parsedEditTab && parsedEditTab !== "general" ? parsedEditTab : null,
        view: parseViewport(searchParams?.get("view")),
        rightTab: parseRightTab(searchParams?.get("tab")),
        layerId: searchParams?.get("layer") ?? null,
        variantId: null,
      };
    }

    if (componentMatch) {
      return {
        type: "component",
        resourceId: componentMatch[1],
        isEditing: false,
        editTab: null,
        view: null,
        rightTab: parseRightTab(searchParams?.get("tab")),
        layerId: searchParams?.get("layer") ?? null,
        variantId: searchParams?.get("variant") ?? null,
      };
    }

    // Base /campaign/[campaignId]/edit route — no resource selected yet.
    return {
      type: null,
      resourceId: null,
      isEditing: false,
      editTab: null,
      view: null,
      rightTab: null,
      layerId: null,
      variantId: null,
    };
  }, [pathname, searchParams]);

  // Async callers (e.g. the pages list awaiting an unsaved-changes prompt)
  // must see the URL as it is NOW, not as it was when their closure was
  // created — mirror the latest state into a ref.
  const urlStateRef = useRef(urlState);
  useEffect(() => {
    urlStateRef.current = urlState;
  }, [urlState]);

  /**
   * Navigate to a page's design route. Always leaves page-settings mode
   * (`edit` is never emitted). `view` / `tab` / `layer` fall back to the
   * CURRENT query values, then to the defaults, so the URL always carries
   * `?view=…&tab=…&layer=…`.
   */
  const navigateToPage = useCallback(
    (pageId: string, options?: NavigateToPageOptions) => {
      const url = buildPageUrl(
        campaignId,
        pageId,
        {
          view: options?.view,
          rightTab: options?.rightTab,
          layerId: options?.layerId,
        },
        new URLSearchParams(window.location.search),
      );
      if (options?.replace) router.replace(url);
      else router.push(url);
    },
    [router, campaignId],
  );

  /**
   * Navigate to a page in page-settings mode (`?edit=<tab>`), preserving the
   * current view / right tab / layer unless overridden.
   */
  const navigateToPageSettings = useCallback(
    (
      pageId: string,
      tab?: PageSettingsTab,
      options?: Omit<NavigateToPageOptions, "replace">,
    ) => {
      router.push(
        buildPageUrl(
          campaignId,
          pageId,
          { ...options, settingsTab: tab ?? "general" },
          new URLSearchParams(window.location.search),
        ),
      );
    },
    [router, campaignId],
  );

  /**
   * Centralized "go to this page" helper — the ONLY place the pages list (and
   * the delete / create fallbacks) assemble a route. Performs NO data fetch;
   * it only updates routing.
   *
   * Decision order:
   *   1. `view`      ← urlState.view   (empty → undefined)
   *   2. `rightTab`  ← urlState.rightTab (empty → undefined)
   *   3. page-settings mode active → page-settings route
   *   4. Pages sidebar tab active (store-owned) → page route
   *   5. otherwise → page route (normal design/layer semantics)
   *   6. `layerId` defaults to `body`
   *
   * Steps 4 and 5 are kept as two explicit branches even though the
   * `layers/[pageId]` route is gone and both now land on the same page route:
   * the store, not the URL, decides which mode we are in, and keeping the
   * seam means callers never need to change if the two modes diverge again.
   */
  const navigateToNextPage = useCallback(
    (pageId: string, layerId?: string) => {
      const current = urlStateRef.current;
      const view = current.view || undefined;
      const rightTab = current.rightTab || undefined;
      const targetLayerId = layerId || DEFAULT_LAYER_ID;

      if (current.isEditing) {
        navigateToPageSettings(pageId, current.editTab ?? undefined, {
          view,
          rightTab,
          layerId: targetLayerId,
        });
        return;
      }

      if (useEditorStore.getState().activeSidebarTab === "pages") {
        navigateToPage(pageId, { view, rightTab, layerId: targetLayerId });
        return;
      }

      navigateToPage(pageId, { view, rightTab, layerId: targetLayerId });
    },
    [navigateToPage, navigateToPageSettings],
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
   * Fine-grained state mirrors — `history.replaceState`, no new history
   * entry. `useEditorStore.setSelectedLayerId` calls
   * `scheduleLayerIdUrlUpdate` directly instead (it can't use a hook).
   */
  const replaceLayerIdInUrl = useCallback((layerId: string | null) => {
    updateUrlQueryParam("layer", layerId);
  }, []);

  const replaceViewInUrl = useCallback((view: Viewport) => {
    updateUrlQueryParam("view", view);
  }, []);

  return {
    urlState,
    navigateToPage,
    navigateToPageSettings,
    navigateToNextPage,
    navigateToComponent,
    navigateToEditor,
    replaceLayerIdInUrl,
    replaceViewInUrl,
  };
}
