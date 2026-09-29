/**
 * Context for portaling UI elements (context menus, popovers) to the
 * correct document body when rendering inside the canvas iframe.
 *
 * Radix UI portals default to `globalThis.document.body`, which resolves
 * to the parent document when React renders inside an iframe via createRoot.
 * This context provides the iframe's body so portals render in the correct
 * coordinate system, and the current zoom level so portaled elements can
 * counter-scale to appear at 100% size.
 */
import { createContext, useContext } from 'react';

interface CanvasPortalValue {
  container: HTMLElement | null;
  /** Canvas zoom percentage (100 = 100%) */
  zoom: number;
}

const CanvasPortalContext = createContext<CanvasPortalValue>({
  container: null,
  zoom: 100,
});

export const CanvasPortalProvider = CanvasPortalContext.Provider;

/** Returns the iframe body element when inside the canvas, or null otherwise */
export function useCanvasPortalContainer(): HTMLElement | null {
  return useContext(CanvasPortalContext).container;
}

/** Returns the canvas zoom percentage (100 = 100%) when inside the canvas */
export function useCanvasZoom(): number {
  return useContext(CanvasPortalContext).zoom;
}
