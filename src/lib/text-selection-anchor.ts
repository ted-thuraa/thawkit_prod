/**
 * Text selection anchor helpers
 *
 * Geometry for the floating text-formatting toolbar that appears under a
 * highlighted range of text inside the canvas iframe.
 *
 * The canvas is an iframe that is scaled with `transform: scale(zoom / 100)`.
 * Rects measured *inside* the iframe (Range / ProseMirror coords) are reported
 * in the iframe's own unscaled layout space, whereas the toolbar lives in the
 * parent document. `mapIframeRectToContainer` converts between the two using
 * the same formula as `SelectionOverlay`:
 *
 *   screen = iframeRect.origin - containerRect.origin + innerRect.origin * scale
 *
 * Everything in this file is DOM-free apart from `getEditorSelectionRect`,
 * which only reads from a Tiptap editor, so the maths can be unit-tested.
 */

import type { Editor } from "@tiptap/react";

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface ToolbarPlacement {
  /** Top-left of the toolbar, in container coordinates (px). */
  top: number;
  left: number;
  /** Which side of the selection the toolbar ended up on. */
  placement: "below" | "above";
}

/** Gap between the selection and the toolbar (px). */
export const TOOLBAR_GAP = 10;
/** Minimum distance kept from the edges of the canvas viewport (px). */
export const TOOLBAR_EDGE = 8;

export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/**
 * Convert a rect measured inside the (scaled) canvas iframe into container
 * coordinates.
 *
 * @param inner - rect in the iframe's unscaled layout space
 * @param iframeRect - `iframeElement.getBoundingClientRect()` (on-screen)
 * @param containerRect - `containerElement.getBoundingClientRect()` (on-screen)
 * @param scale - zoom / 100
 */
export function mapIframeRectToContainer(
  inner: Rect,
  iframeRect: Pick<Rect, "top" | "left">,
  containerRect: Pick<Rect, "top" | "left">,
  scale: number,
): Rect {
  return {
    top: iframeRect.top - containerRect.top + inner.top * scale,
    left: iframeRect.left - containerRect.left + inner.left * scale,
    width: inner.width * scale,
    height: inner.height * scale,
  };
}

/**
 * Decide where the toolbar goes relative to the selection anchor.
 *
 * - Centred horizontally on the selection.
 * - Below the selection by default; flips above when there is no room below
 *   but there is room above; otherwise stays below, clamped into view.
 * - Always clamped inside the container's edges.
 * - Returns `null` when the selection is entirely scrolled out of view, so the
 *   toolbar can hide rather than float over unrelated content.
 */
export function placeToolbar(
  anchor: Rect,
  toolbar: Size,
  bounds: Size,
  options: { gap?: number; edge?: number } = {},
): ToolbarPlacement | null {
  const gap = options.gap ?? TOOLBAR_GAP;
  const edge = options.edge ?? TOOLBAR_EDGE;

  const anchorBottom = anchor.top + anchor.height;
  const anchorRight = anchor.left + anchor.width;

  // Selection fully outside the visible area: nothing sensible to anchor to.
  if (
    anchorBottom < 0 ||
    anchor.top > bounds.height ||
    anchorRight < 0 ||
    anchor.left > bounds.width
  ) {
    return null;
  }

  const maxTop = Math.max(edge, bounds.height - toolbar.height - edge);
  const maxLeft = Math.max(edge, bounds.width - toolbar.width - edge);

  const below = anchorBottom + gap;
  const above = anchor.top - gap - toolbar.height;

  let top: number;
  let placement: ToolbarPlacement["placement"];
  if (below <= maxTop) {
    top = below;
    placement = "below";
  } else if (above >= edge) {
    top = above;
    placement = "above";
  } else {
    top = clamp(below, edge, maxTop);
    placement = "below";
  }

  const centred = anchor.left + anchor.width / 2 - toolbar.width / 2;
  const left = clamp(centred, edge, maxLeft);

  return { top, left, placement };
}

/**
 * Measure the current (non-empty) selection of a Tiptap editor, in the
 * iframe's own unscaled viewport coordinates.
 *
 * Uses a DOM Range built from ProseMirror positions rather than
 * `window.getSelection()` so the rect stays available while focus has moved to
 * a toolbar popover (the browser can drop or grey out the native selection
 * then, but ProseMirror's state keeps it).
 *
 * Returns `null` when the editor view is unavailable or the selection is empty.
 */
export function getEditorSelectionRect(editor: Editor): Rect | null {
  try {
    if (editor.isDestroyed) return null;
    const { view } = editor;
    const { from, to, empty } = view.state.selection;
    if (empty) return null;

    // Preferred: union box of every line the range touches.
    try {
      const start = view.domAtPos(from);
      const end = view.domAtPos(to);
      const range = view.dom.ownerDocument.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      const box = range.getBoundingClientRect();
      if (box.width > 0 || box.height > 0) {
        return {
          top: box.top,
          left: box.left,
          width: box.width,
          height: box.height,
        };
      }
    } catch {
      // fall through to coordsAtPos
    }

    // Fallback (e.g. a selected atom node): box between the two end points.
    const a = view.coordsAtPos(from);
    const b = view.coordsAtPos(to);
    const left = Math.min(a.left, b.left);
    const top = Math.min(a.top, b.top);
    return {
      top,
      left,
      width: Math.max(a.right, b.right) - left,
      height: Math.max(a.bottom, b.bottom) - top,
    };
  } catch {
    // `editor.view` throws while the view is not mounted yet.
    return null;
  }
}
