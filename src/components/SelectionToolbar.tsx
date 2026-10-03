"use client";

/**
 * SelectionToolbar
 *
 * Floating action bar anchored to the top of the currently selected canvas
 * element: [move] [LABEL] [←] [→] [copy] [delete] [edit].
 *
 * DISPLAY ONLY (phase 1): the buttons have no behavior yet.
 *
 * Positioning is imperative, like the outlines in SelectionOverlay: the
 * overlay measures the selected element and calls `handle.position(anchor)`
 * from its existing scroll / resize / mutation / zoom pipeline. This keeps
 * the toolbar glued to the outline with zero React re-renders per frame.
 *
 * `anchor` is the selected element's rect in the overlay's own coordinate
 * space (the overlay root is the toolbar's offset parent).
 */

import React, {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Move,
  Pencil,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectionToolbarAnchor {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface SelectionToolbarHandle {
  /** Re-anchor the toolbar. Pass null to hide it (e.g. during scroll). */
  position: (anchor: SelectionToolbarAnchor | null) => void;
}

interface SelectionToolbarProps {
  ref?: React.Ref<SelectionToolbarHandle>;
  /** Element identifier shown in the bar (rendered uppercase, e.g. DIV) */
  label: string;
  /** Hide without losing the last anchor (text editing, multi-select, ...) */
  hidden: boolean;
  /** Matches the outline color: green while a UI state (hover, etc.) is active */
  accent: "blue" | "green";
}

/** Gap between toolbar bottom and the element's outline (outline is 1px). */
const GAP = 2;
/** Minimum distance kept from the edges of the canvas viewport. */
const EDGE = 4;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

function ToolbarButton({
  label,
  hoverClass,
  children,
}: {
  label: string;
  hoverClass: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      tabIndex={-1}
      className={cn(
        "flex size-[18px] shrink-0 items-center justify-center rounded-[3px] outline-none transition-colors",
        hoverClass,
      )}
    >
      {children}
    </button>
  );
}

export function SelectionToolbar({
  ref,
  label,
  hidden,
  accent,
}: SelectionToolbarProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<SelectionToolbarAnchor | null>(null);
  const hiddenRef = useRef(hidden);

  const apply = useCallback(() => {
    const el = elRef.current;
    if (!el) return;

    const bounds = el.parentElement;
    const anchor = anchorRef.current;
    if (!anchor || hiddenRef.current || !bounds) {
      el.style.display = "none";
      return;
    }

    const viewportW = bounds.clientWidth;
    const viewportH = bounds.clientHeight;

    // Element is entirely outside the canvas viewport → nothing to anchor to.
    if (
      anchor.top + anchor.height < 0 ||
      anchor.top > viewportH ||
      anchor.left + anchor.width < 0 ||
      anchor.left > viewportW
    ) {
      el.style.display = "none";
      return;
    }

    // Must be displayed to be measured.
    el.style.display = "flex";
    const toolbarW = el.offsetWidth;
    const toolbarH = el.offsetHeight;

    // 1. Preferred: above the element.
    let top = anchor.top - toolbarH - GAP;

    if (top < EDGE) {
      if (anchor.top >= EDGE) {
        // 2. No room above → flip below if it fits, else stay at the top edge.
        const below = anchor.top + anchor.height + GAP;
        top = below + toolbarH <= viewportH - EDGE ? below : EDGE;
      } else {
        // 3. Element top is scrolled off → stick to the visible top edge.
        top = EDGE;
      }
    }

    top = clamp(top, EDGE, Math.max(EDGE, viewportH - toolbarH - EDGE));
    // Left-aligned to the element, clamped inside the viewport.
    const left = clamp(
      anchor.left,
      EDGE,
      Math.max(EDGE, viewportW - toolbarW - EDGE),
    );

    el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      position: (anchor) => {
        anchorRef.current = anchor;
        apply();
      },
    }),
    [apply],
  );

  // Re-apply when visibility or label (→ toolbar width) changes.
  useLayoutEffect(() => {
    hiddenRef.current = hidden;
    apply();
  }, [hidden, label, apply]);

  const isGreen = accent === "green";
  const hoverClass = isGreen ? "hover:bg-black/10" : "hover:bg-white/20";

  return (
    <div
      ref={elRef}
      role="toolbar"
      aria-label="Element actions"
      data-selection-toolbar
      // Keep focus/selection where it is; the overlay root is pointer-events-none
      // so the toolbar opts back in below.
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        "pointer-events-auto absolute top-0 left-0 z-10 h-[22px] items-center gap-px rounded-[5px] px-0.5 shadow-sm select-none will-change-transform",
        isGreen ? "bg-[#8dd92f] text-neutral-900" : "bg-blue-500 text-white",
      )}
      style={{ display: "none" }}
    >
      <ToolbarButton label="Move" hoverClass={hoverClass}>
        <Move className="size-3" strokeWidth={2.25} />
      </ToolbarButton>

      <span className="max-w-[140px] truncate px-1 text-[10px] leading-none font-bold tracking-wide uppercase">
        {label}
      </span>

      <ToolbarButton label="Move backward" hoverClass={hoverClass}>
        <ArrowLeft className="size-3" strokeWidth={2.25} />
      </ToolbarButton>
      <ToolbarButton label="Move forward" hoverClass={hoverClass}>
        <ArrowRight className="size-3" strokeWidth={2.25} />
      </ToolbarButton>
      <ToolbarButton label="Duplicate" hoverClass={hoverClass}>
        <Copy className="size-3" strokeWidth={2.25} />
      </ToolbarButton>
      <ToolbarButton label="Delete" hoverClass={hoverClass}>
        <Trash2 className="size-3" strokeWidth={2.25} />
      </ToolbarButton>
      <ToolbarButton label="Edit" hoverClass={hoverClass}>
        <Pencil className="size-3" strokeWidth={2.25} />
      </ToolbarButton>
    </div>
  );
}

export default SelectionToolbar;
