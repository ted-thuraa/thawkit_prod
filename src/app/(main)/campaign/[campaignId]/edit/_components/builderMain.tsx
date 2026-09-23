"use client";

import { ReactNode, useEffect } from "react";
import { useCampaignEditorUrl } from "@/hooks/use-editor-url";
import type { EditorBootstrapContext } from "@/lib/editor/resolve-editor-bootstrap";
import { usePagesStore } from "@/stores/editor/usePagesStore";
import { useEditorStore } from "@/stores/editor/useEditorStore";
import LeftPanel from "./LeftPanel";
import { Button } from "@/components/ui/button";
import { GitForkIcon, Palette, Plus } from "lucide-react";
import RightPanel from "./RightPanel";
import EditorToolbar from "./EditorToolbar";

interface EditorShellProps {
  /** Floating panel pinned to the left edge. */
  leftPanel?: ReactNode;
  /** Floating panel pinned to the right edge. */
  rightPanel?: ReactNode;
  /** Floating button group, pinned bottom-centre. */
  toolbar?: ReactNode;
  /** The canvas — rendered full-bleed behind every floating element. */
  children?: ReactNode;
}

export default function EditorShell({
  leftPanel,
  rightPanel,
  toolbar,
  children,
}: EditorShellProps) {
  return (
    <div className="relative min-h-0 min-w-0 flex-1 self-stretch overflow-hidden">
      {/* Layer 0 — canvas */}
      <div className="absolute inset-0 z-0">{children}</div>

      {/* Layer 1 — side panels (12px inset from every edge they touch) */}
      <div className="pointer-events-none absolute inset-0 z-20 flex justify-between gap-3 p-3">
        {leftPanel && (
          <div className="pointer-events-auto h-full">{leftPanel}</div>
        )}
        {rightPanel && (
          <div className="pointer-events-auto ml-auto h-full">{rightPanel}</div>
        )}
      </div>

      {/* Layer 1 — bottom-centre button group, centred on the FULL area
          (not on the gap between the panels) to match the wireframe. */}
      {toolbar && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center">
          <div className="pointer-events-auto">{toolbar}</div>
        </div>
      )}
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
  const { urlState, navigateToLayers } = useCampaignEditorUrl(campaignId);
  console.log("editor main");
  useEffect(() => {
    usePagesStore.getState().hydrateFromBootstrap(bootstrap.pages);
    //useComponentsStore.getState().hydrateFromBootstrap(bootstrap.components);
    // useLayerStylesStore.getState().hydrateFromBootstrap(bootstrap.layerStyles);
    useEditorStore.getState().resetForNewCampaign();
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
  //const components = useComponentsStore((state) => state.components);
  const setCurrentPageId = useEditorStore((state) => state.setCurrentPageId);

  const isPageOrientedRoute =
    urlState.type === null ||
    urlState.type === "layers" ||
    urlState.type === "page";
  const activePage =
    isPageOrientedRoute && urlState.resourceId != null
      ? (pages.find((p) => p.id === urlState.resourceId) ?? null)
      : null;
  const needsPageRedirect = isPageOrientedRoute && activePage === null;

  useEffect(() => {
    if (!needsPageRedirect) return;
    const firstPage = pages[0];
    if (firstPage) {
      navigateToLayers(firstPage.id, { replace: true });
    }
  }, [needsPageRedirect, pages, navigateToLayers]);

  // Keep useEditorStore's currentPageId in sync with whichever page the
  // URL actually resolved to — read by the (future) layers tree and
  // canvas so they don't each need their own copy of "which page is this."
  useEffect(() => {
    setCurrentPageId(activePage?.id ?? null);
  }, [activePage?.id, setCurrentPageId]);

  // Same idea for component-edit mode: LeftPanel.tsx's Layers tab reads
  // `editingComponentId`/`editingComponentVariantId` to decide whether to
  // render a page's layer tree or a component variant's, and
  // ComponentVariantsSection needs to know which variant the URL says is
  // active. Without this sync, navigating to `/editor/components/[id]`
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

  if (needsPageRedirect) {
    if (pages.length === 0) {
      return (
        <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
          This funnel has no pages yet. Page creation lands in a later phase.
        </div>
      );
    }
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
        Resolving this funnel&apos;s first page…
      </div>
    );
  }

  const showRightPanel = urlState.type !== "page";

  console.log(activePage);

  if (urlState.type === "layers" && activePage) {
    return (
      <EditorShell
        leftPanel={<LeftPanel campaignId={campaignId} />}
        rightPanel={showRightPanel ? <RightPanel /> : undefined}
        toolbar={<EditorToolbar />}
      >
        {/* CANVAS SLOT — sits behind the floating panels and fills the whole
          area, so the mounted component must size itself `h-full w-full`.
          Not mounted yet, same as before this pass:
            layers route    → <EditorBuilder layers={activePage.layers} />
            component route → the component editor, once
                              useComponentsStore hydration is re-enabled
                              above (`components.find(...)` for
                              `urlState.resourceId` / `urlState.variantId`).
          `activePage` is null on the component route, so guard it when
          uncommenting. */}
      </EditorShell>
    );
  }

  if (urlState.type === "page" && activePage) {
    return (
      <EditorShell
        leftPanel={<LeftPanel campaignId={campaignId} />}
        rightPanel={showRightPanel ? <RightPanel /> : undefined}
        toolbar={<EditorToolbar />}
      >
        {/* CANVAS SLOT — sits behind the floating panels and fills the whole
          area, so the mounted component must size itself `h-full w-full`.
          Not mounted yet, same as before this pass:
            layers route    → <EditorBuilder layers={activePage.layers} />
            component route → the component editor, once
                              useComponentsStore hydration is re-enabled
                              above (`components.find(...)` for
                              `urlState.resourceId` / `urlState.variantId`).
          `activePage` is null on the component route, so guard it when
          uncommenting. */}
      </EditorShell>
    );
  }

  // urlState.type === "component"
  //   const activeComponent =
  //     components.find((c) => c.id === urlState.resourceId) ?? null;

  return (
    <div className="h-full flex">
      {/* <LeftPanel campaignId={campaignId} />
      <div className="flex-1 h-full overflow-hidden flex items-center justify-center text-sm text-muted-foreground">
        {activeComponent ? (
          <>
            Component editor for &quot;{activeComponent.name}&quot;
            {urlState.variantId ? ` (variant ${urlState.variantId})` : ""}
          </>
        ) : (
          <>
            Component &quot;{urlState.resourceId}&quot; not found in this
            workspace.
          </>
        )}
      </div>
      <RightPanel /> */}
    </div>
  );
}
