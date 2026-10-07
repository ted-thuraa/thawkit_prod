"use client";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useCampaignEditorUrl } from "@/hooks/use-editor-url";
import { DEFAULT_LAYER_ID, type Viewport } from "@/lib/editor/editor-url";
import { findLayerById } from "@/lib/editor/layer-tree-utils";
import type { Layer } from "@/types/funnel";
import type { EditorBootstrapContext } from "@/lib/editor/resolve-editor-bootstrap";
import { pagesFromRows } from "@/lib/editor/page-from-row";
import {
  componentsFromRows,
  layerStylesFromRows,
} from "@/lib/editor/design-system-from-row";
import { usePagesStore } from "@/stores/editor/usePagesStore";
import { useComponentsStore } from "@/stores/editor/useComponentsStore";
import { useLayerStylesStore } from "@/stores/editor/useLayerStylesStore";
import { useEditorStore } from "@/stores/editor/useEditorStore";
import LeftPanel from "./LeftPanel";
import RightPanelDrawer from "./RightPanelDrawer";
import EditorToolbar from "./EditorToolbar";
import EditorCenterCanvas from "./EditorCanvas";

interface EditorShellProps {
  /** Floating panel pinned to the left edge. */
  leftPanel?: ReactNode;
  /**
   * Floating overlays that portal into this shell (e.g. the RightPanel
   * drawer). Rendered inside the `data-editor-shell` root so they are
   * positioned relative to the editor area, not the viewport.
   */
  overlay?: ReactNode;
  /** Floating button group, pinned bottom-centre. */
  toolbar?: ReactNode;
  /** The canvas — rendered full-bleed behind every floating element. */
  children?: ReactNode;
}

export default function EditorShell({
  leftPanel,
  overlay,
  toolbar,
  children,
}: EditorShellProps) {
  return (
    <div
      data-editor-shell
      className="relative min-h-0 min-w-0 flex-1 self-stretch overflow-hidden"
    >
      {/* Layer 0 — canvas */}
      <div className="absolute inset-0 z-0">{children}</div>

      {/* Layer 1 — side panels (12px inset from every edge they touch) */}
      <div className="pointer-events-none absolute inset-0 z-20 flex justify-between gap-3 p-3">
        {leftPanel && (
          <div className="pointer-events-auto h-full">{leftPanel}</div>
        )}
      </div>

      {/* Layer 1 — bottom-centre button group, centred on the FULL area
          (not on the gap between the panels) to match the wireframe. */}
      {toolbar && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center">
          <div className="pointer-events-auto">{toolbar}</div>
        </div>
      )}

      {/* Overlays (RightPanel drawer) — portal target is this root */}
      {overlay}
    </div>
  );
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 * The persistent editor orchestrator — Thawkit's equivalent of Ycode's
 * YCodeBuilderMain.tsx. See this file's previous revisions (Phase 2.5/3)
 * and layout.tsx's comment for the full rationale on the persistent-mount,
 * URL-driven-mode pattern this depends on.
 *
 * STORE HYDRATION (new this pass — Phase 4): `bootstrap` is only read
 * directly on the very first render of a given `campaignId`, to seed the
 * Zustand stores that now own this data for the rest of the editing
 * session (use-pages-store.ts, use-components-store.ts,
 * use-layer-styles-store.ts). From that point on, this component reads
 * the STORES, not `bootstrap` — the stores are what Phase 6's tree UI and
 * mutations will actually read and write.
 *
 * WHY THE EXPLICIT RESET: Zustand stores here are module-level singletons,
 * shared across the whole app — NOT reset automatically just because this
 * component's props changed. Ycode never has to think about this: it's
 * one project per deployment, so there's no "switch to a different
 * project" case within a running session. This project is multi-tenant —
 * navigating from campaigns/A to campaigns/B keeps the same `layout.tsx`
 * file matched (Next.js doesn't remount a layout just because a dynamic
 * segment's VALUE changed), so without the effect below, Campaign B's
 * editor could open with Campaign A's selection/history/drag state and
 * page list still attached. The effect is keyed on `campaignId` so it
 * re-runs exactly when that matters, hydrating fresh data and resetting
 * `useEditorStore`'s interaction state back to defaults.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function CampaignEditorMain({
  campaignId,
  bootstrap,
}: {
  campaignId: string;
  bootstrap: EditorBootstrapContext;
}) {
  const { urlState, navigateToPage, replaceViewInUrl } =
    useCampaignEditorUrl(campaignId);
  const [viewportMode, setViewportModeState] = useState<Viewport>(
    urlState.view || "desktop",
  );
  useEffect(() => {
    // Order matters: reset first (it also clears usePagesStore and restores
    // the store-owned sidebar tab to "layers"), THEN hydrate.
    useEditorStore.getState().resetForNewCampaign();
    usePagesStore
      .getState()
      .hydrateFromBootstrap(pagesFromRows(bootstrap.pages));
    // Styles and components hydrate in the same effect (before any retained
    // canvas / layer-menu code resolves references), and the components store
    // also drops the previous campaign's drafts and pending saves.
    useLayerStylesStore
      .getState()
      .hydrateFromBootstrap(layerStylesFromRows(bootstrap.layerStyles));
    useComponentsStore
      .getState()
      .hydrateFromBootstrap(componentsFromRows(bootstrap.components));
    // Intentionally keyed on campaignId alone, not on `bootstrap` itself:
    // `bootstrap` is a fresh object reference on every server render, but
    // re-hydrating (and wiping in-progress local edits) on every
    // navigation within the SAME campaign would defeat the entire point
    // of moving mutations into client state. A different `campaignId` is
    // the only signal that means "this is genuinely a different funnel's
    // data now."
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const pages = usePagesStore((state) => state.pages);
  const setCurrentPageId = useEditorStore((state) => state.setCurrentPageId);

  // ─── Viewport ↔ `?view=` ──────────────────────────────────────────────
  // User-driven viewport changes are mirrored into the URL with
  // history.replaceState (fine-grained state — no history entry), and URL
  // changes (back/forward, pasted link) are mirrored back into local state.
  const setViewportMode = useCallback(
    (mode: Viewport) => {
      setViewportModeState(mode);
      replaceViewInUrl(mode);
    },
    [replaceViewInUrl],
  );
  useEffect(() => {
    if (urlState.view && urlState.view !== viewportMode) {
      setViewportModeState(urlState.view);
    }
    // Only react to the URL changing; `viewportMode` changes are pushed to
    // the URL by `setViewportMode` above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlState.view]);

  // ─── Route → active page ──────────────────────────────────────────────
  // Every page-oriented route is now `/edit/pages/[pageId]` (the base
  // `/edit` route has no resource yet and is redirected below).
  const isPageOrientedRoute =
    urlState.type === null || urlState.type === "page";
  const activePage =
    isPageOrientedRoute && urlState.resourceId != null
      ? (pages.find((p) => p.id === urlState.resourceId) ?? null)
      : null;
  const needsPageRedirect = isPageOrientedRoute && activePage === null;

  // No / unknown page in the URL → resolve to a REAL page route with query
  // defaults (`?view=desktop&tab=design&layer=body`). `replace`, because the
  // pre-redirect URL was never a navigation target worth a back-button entry.
  useEffect(() => {
    if (!needsPageRedirect || pages.length === 0) return;
    const firstPage = [...pages].sort((a, b) => a.order - b.order)[0];
    navigateToPage(firstPage.id, { replace: true });
  }, [needsPageRedirect, pages, navigateToPage]);

  // Keep useEditorStore's currentPageId in sync with whichever page the
  // URL actually resolved to — read by the layers tree, pages list and
  // canvas so they don't each need their own copy of "which page is this."
  useEffect(() => {
    setCurrentPageId(activePage?.id ?? null);
  }, [activePage?.id, setCurrentPageId]);

  // ─── URL `?layer=` → store selection (reconciliation) ─────────────────
  // Runs once per page switch (and on first load), AFTER the page's layer
  // tree is in the store (`activePage` is only non-null once it is). The
  // requested layer is validated against that page's tree: a valid id is
  // selected, otherwise fall back to `body`, otherwise nothing. Subsequent
  // selection changes flow the other way (store → URL) via
  // `setSelectedLayerId`, so this must not re-run on every `layer` change.
  const reconciledPageIdRef = useRef<string | null>(null);
  const activePageLayers = activePage?.layers;
  const urlLayerId = urlState.layerId;
  useEffect(() => {
    if (!activePage || urlState.type !== "page") return;
    if (reconciledPageIdRef.current === activePage.id) return;
    reconciledPageIdRef.current = activePage.id;

    const { selectLayerWithSublayer, clearSelection } =
      useEditorStore.getState();
    const clean = {
      textStyleKey: null,
      sublayerIndex: null,
      listItemIndex: null,
    };

    const requested = urlLayerId || DEFAULT_LAYER_ID;
    const layers = activePageLayers ?? [];
    if (findLayerById(layers, requested)) {
      selectLayerWithSublayer(requested, clean);
    } else if (findLayerById(layers, DEFAULT_LAYER_ID)) {
      selectLayerWithSublayer(DEFAULT_LAYER_ID, clean);
    } else {
      clearSelection();
    }
    // `urlLayerId` / `activePageLayers` are read only at the moment the
    // page id changes — see the comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage?.id, urlState.type]);

  // Same idea for component-edit mode: LeftPanel.tsx's Layers tab reads
  // `editingComponentId`/`editingComponentVariantId` to decide whether to
  // render a page's layer tree or a component variant's, and
  // ComponentVariantsSection needs to know which variant the URL says is
  // active. Without this sync, navigating to `/edit/components/[id]`
  // would never actually flip the store into component-edit mode — the
  // URL would say "component" but every store consumer would still think
  // it's editing whatever page was open before.
  const activeComponentId =
    urlState.type === "component" ? urlState.resourceId : null;
  const activeComponentVariantId =
    urlState.type === "component" ? (urlState.variantId ?? null) : null;
  const setEditingComponentId = useEditorStore(
    (state) => state.setEditingComponentId,
  );
  const setEditingComponentVariantId = useEditorStore(
    (state) => state.setEditingComponentVariantId,
  );
  useEffect(() => {
    setEditingComponentId(activeComponentId);
  }, [activeComponentId, setEditingComponentId]);
  useEffect(() => {
    if (activeComponentId)
      setEditingComponentVariantId(activeComponentVariantId);
  }, [
    activeComponentId,
    activeComponentVariantId,
    setEditingComponentVariantId,
  ]);

  const handleLayerUpdate = useCallback(
    (layerId: string, updates: Partial<Layer>) => {
      const {
        editingComponentId: compId,
        editingComponentVariantId: variantId,
      } = useEditorStore.getState();
      if (compId) {
        const { componentDrafts, updateComponentDraft } =
          useComponentsStore.getState();
        const variantDrafts = componentDrafts[compId];
        const targetVariantId =
          variantId && variantDrafts?.[variantId]
            ? variantId
            : variantDrafts
              ? Object.keys(variantDrafts)[0]
              : null;
        if (!targetVariantId || !variantDrafts) return;
        const layers = variantDrafts[targetVariantId] || [];
        const updateTree = (tree: Layer[]): Layer[] =>
          tree.map((l) => {
            if (l.id === layerId) return { ...l, ...updates };
            if (l.children) return { ...l, children: updateTree(l.children) };
            return l;
          });
        updateComponentDraft(compId, targetVariantId, updateTree(layers));
      } else {
        const pageId = useEditorStore.getState().currentPageId;
        if (pageId) {
          usePagesStore.getState().updateLayer(pageId, layerId, updates);
        }
      }
    },
    [],
  );

  if (needsPageRedirect) {
    if (pages.length === 0) {
      return (
        <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
          This funnel has no pages yet.
        </div>
      );
    }
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
        Resolving this funnel&apos;s first page…
      </div>
    );
  }

  if (urlState.type === "page" && activePage) {
    return (
      <EditorShell
        leftPanel={<LeftPanel campaignId={campaignId} />}
        overlay={
          // The right inspector is hidden in page-settings mode (`?edit=`),
          // where the left panel hosts the settings form instead.
          <RightPanelDrawer
            onLayerUpdate={handleLayerUpdate}
            disabled={urlState.isEditing}
          />
        }
        toolbar={<EditorToolbar />}
      >
        {/* CANVAS SLOT — sits behind the floating panels and fills the whole
          area, so the mounted component must size itself `h-full w-full`. */}
        <EditorCenterCanvas
          currentPageId={activePage.id}
          viewportMode={viewportMode}
          setViewportMode={setViewportMode}
        />
      </EditorShell>
    );
  }

  // urlState.type === "component" — component editing UI is not mounted yet.
  return <div className="h-full flex" />;
}
