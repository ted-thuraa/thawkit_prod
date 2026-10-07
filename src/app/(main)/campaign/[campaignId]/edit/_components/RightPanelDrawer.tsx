"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useEditorStore } from "@/stores/editor/useEditorStore";
import type { Layer } from "@/types/funnel";
import RightPanel from "./RightPanel";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * RightPanelDrawer — hosts <RightPanel> in a shadcn/ui Drawer (vaul).
 *
 * VISIBILITY is owned by `useEditorStore.isRightPanelOpen`, so the
 * SelectionToolbar's Edit button can toggle it without any prop-drilling
 * and without re-rendering the editor orchestrator. Closed → the Drawer
 * content (and therefore <RightPanel>) is NOT mounted.
 *
 * It closes via:
 *   1. the toolbar Edit button (toggle),
 *   2. the X button in the panel header,
 *   3. the Escape key,
 *   4. the selection being cleared / moving to `body` (nothing to inspect;
 *      the toolbar is hidden then, so this is the only other way out).
 * It stays open while selection moves between layers (the inspector follows
 * the selection). It also closes when `disabled` flips on (page-settings
 * mode, where the left panel hosts the settings form).
 *
 * DRAWER CONFIG
 *   direction="right"   side drawer
 *   modal={false}       no overlay, no focus trap, no scroll lock — the
 *                       canvas stays fully interactive, and clicking it
 *                       does not dismiss the drawer
 *   dismissible={false} disables swipe-to-dismiss (it would fight sliders
 *                       and colour pickers) and vaul's own outside-click /
 *                       Esc dismissal; Esc is handled explicitly below
 *   container           the `data-editor-shell` root, so the drawer sits
 *                       inside the editor area (below the header, within
 *                       the 12px gutters) instead of covering the viewport
 * ─────────────────────────────────────────────────────────────────────────
 */
interface RightPanelDrawerProps {
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  /** Force-closed and unavailable (e.g. page-settings mode) */
  disabled?: boolean;
}

export default function RightPanelDrawer({
  onLayerUpdate,
  disabled = false,
}: RightPanelDrawerProps) {
  const isOpen = useEditorStore((state) => state.isRightPanelOpen);
  const closeRightPanel = useEditorStore((state) => state.closeRightPanel);
  // Boolean selector: re-renders only when "has an inspectable layer" flips.
  const hasInspectableLayer = useEditorStore(
    (state) => !!state.selectedLayerId && state.selectedLayerId !== "body",
  );

  // Resolve the portal target from our position in the tree (no prop needed).
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const anchorRef = useCallback((el: HTMLElement | null) => {
    setContainer(el ? el.closest<HTMLElement>("[data-editor-shell]") : null);
  }, []);

  // Keep the store flag honest so a hidden drawer never "re-appears" later.
  useEffect(() => {
    if (isOpen && (disabled || !hasInspectableLayer)) closeRightPanel();
  }, [isOpen, disabled, hasInspectableLayer, closeRightPanel]);

  return (
    <>
      <span ref={anchorRef} hidden aria-hidden="true" />
      {container && (
        <Drawer
          open={isOpen && !disabled}
          direction="right"
          modal={false}
          dismissible={false}
          container={container}
        >
          <DrawerContent
            onEscapeKeyDown={closeRightPanel}
            // Overrides the shared wrapper's viewport-fixed, padded,
            // card-backed defaults: position inside the editor area, keep
            // RightPanel's own card/width, and use the 12px editor gutter.
            className="absolute p-3 before:hidden data-[vaul-drawer-direction=right]:w-auto data-[vaul-drawer-direction=right]:sm:max-w-none"
          >
            {/* Required by the underlying Radix dialog for a11y */}
            <DrawerTitle className="sr-only">Properties</DrawerTitle>
            <DrawerDescription className="sr-only">
              Edit the properties of the selected element
            </DrawerDescription>
            <RightPanel
              onLayerUpdate={onLayerUpdate}
              onClose={closeRightPanel}
              className="flex-1"
            />
          </DrawerContent>
        </Drawer>
      )}
    </>
  );
}
