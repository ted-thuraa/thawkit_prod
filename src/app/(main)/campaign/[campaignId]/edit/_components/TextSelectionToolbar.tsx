"use client";

/**
 * Text Selection Toolbar
 *
 * Floating formatting bar shown under a highlighted range of text while a
 * text/heading layer is being edited inline on the canvas.
 *
 * Architecture notes
 * - The inline editor (CanvasTextEditor) runs inside the canvas iframe; this
 *   toolbar lives in the parent document, over the canvas, and drives the
 *   editor through `useCanvasTextEditorStore`.
 * - Position is computed from the editor's selection and mapped from the
 *   iframe's unscaled space to screen space (zoom-aware), then applied
 *   imperatively (like SelectionOverlay) so scroll/zoom/typing never cause a
 *   React re-render. React state is only used for button states.
 * - Visibility follows the editor's selection, not focus: it stays while focus
 *   is in a toolbar popover or the sidebar, and hides for a caret-only
 *   selection, during a mouse drag-select, in preview mode, while the sidebar
 *   is being resized, or when the selection is scrolled out of view.
 * - Every toolbar mousedown is `preventDefault`-ed (except inside inputs) so
 *   clicking a button never moves focus out of the iframe or collapses the
 *   selection before the command runs.
 * - Font size and colour are *inline* styles on the selection, written through
 *   `useDesignSync` (which creates/reuses a `dynamicStyle` mark). Their
 *   displayed values come from the browser's computed style at the selection,
 *   so they stay correct through inheritance, breakpoints and `clamp()` sizes.
 * - Text alignment is a *block* property, so it is written to the layer itself
 *   via a second, layer-level `useDesignSync` (never as an inline style).
 */

import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Italic,
  Link2,
  Minus,
  Plus,
  Strikethrough,
  Underline,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useDesignSync } from "@/hooks/use-design-sync";
import { useCanvasTextEditorStore } from "@/stores/editor/useCanvasTextEditorStore";
import { useEditorStore } from "@/stores/editor/useEditorStore";
import { canLayerHaveLink } from "@/lib/layer-utils";
import {
  getEditorSelectionRect,
  getSelectionComputedTypography,
  mapIframeRectToContainer,
  placeToolbar,
} from "@/lib/text-selection-anchor";
import {
  FONT_SIZE_PRESETS,
  fontSizeToDesignValue,
  formatFontSize,
  parseFontSizeInput,
  rgbToHexColor,
  stepFontSize,
} from "@/lib/toolbar-typography";
import type { Collection, CollectionField, Layer } from "@/types/funnel";
import type { FieldGroup } from "./CollectionFieldSelector";
import ColorPicker from "./ColorPicker";
import RichTextLinkPopover from "./RichTextLinkPopover";

interface TextSelectionToolbarProps {
  /** The canvas iframe element */
  iframeElement: HTMLIFrameElement | null;
  /** The canvas viewport element (same box SelectionOverlay measures against) */
  containerElement: HTMLElement | null;
  /** Current canvas zoom percentage (100 = 100%) */
  zoom: number;
  /** The layer currently being edited (for link eligibility + popover context) */
  editingLayer: Layer | null;
  /** All layers in the current context (page or component), for link checks */
  allLayers: Layer[];
  /** Applies a partial update to a layer (same updater the canvas uses) */
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  fieldGroups?: FieldGroup[];
  allFields?: Record<string, CollectionField[]>;
  collections?: Collection[];
  isInsideCollectionLayer?: boolean;
}

const HIDDEN_STYLE: React.CSSProperties = { display: "none" };

/** Re-measure again shortly after a layout-affecting change: the Tailwind CDN
 * generates CSS for new classes asynchronously, so the first measurement can
 * land before the text has actually reflowed. */
const SETTLE_DELAY_MS = 80;

/** How long an optimistic font size is shown before trusting the computed
 * value again (covers the gap until the new class has rendered). */
const PENDING_SIZE_TTL_MS = 1500;

type TextAlign = "left" | "center" | "right";

const ALIGNMENTS: {
  value: TextAlign;
  label: string;
  Icon: typeof AlignLeft;
}[] = [
  { value: "left", label: "Align left", Icon: AlignLeft },
  { value: "center", label: "Align center", Icon: AlignCenter },
  { value: "right", label: "Align right", Icon: AlignRight },
];

/** Collapse the design value to one of the three toolbar alignments. */
function normalizeTextAlign(value: string | undefined): TextAlign | null {
  switch (value) {
    case undefined:
    case "":
    case "left":
    case "start":
      return "left";
    case "center":
      return "center";
    case "right":
    case "end":
      return "right";
    default:
      return null; // e.g. justify: none of the three buttons is active
  }
}

// ─── Button ──────────────────────────────────────────────────────────────────

interface ToolbarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  pressed?: boolean;
}

/** Forwards its ref and props so Radix `asChild` triggers can wrap it. */
const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  function ToolbarButton(
    { label, pressed = false, className, children, ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        title={label}
        aria-label={label}
        aria-pressed={pressed}
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-md text-neutral-300 transition-colors",
          "hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40",
          "disabled:pointer-events-none disabled:opacity-40",
          pressed && "bg-white/20 text-white",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

const Divider = () => (
  <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-white/15" />
);

// ─── Font size control ───────────────────────────────────────────────────────

interface FontSizeControlProps {
  /** Current size in px (null while unknown) */
  value: number | null;
  onStep: (direction: 1 | -1, big: boolean) => void;
  onSet: (px: number) => void;
  /** Return keyboard focus to the text editor */
  onReturnFocus: () => void;
}

/** `[−] [ 144 ⌄ ] [+]`: stepper buttons, a typeable field and a presets list. */
function FontSizeControl({
  value,
  onStep,
  onSet,
  onReturnFocus,
}: FontSizeControlProps) {
  // `null` = show the live value; a string = the user is typing.
  const [draft, setDraft] = useState<string | null>(null);
  const [presetsOpen, setPresetsOpen] = useState(false);
  /** Enter/Escape already handled the field; the blur they cause must not
   * commit a second time. */
  const skipBlurCommitRef = useRef(false);

  const commit = (raw: string) => {
    const px = parseFontSizeInput(raw);
    if (px !== null && px !== value) onSet(px);
  };

  return (
    <div className="flex items-center">
      <ToolbarButton
        label="Decrease font size (Shift: 10)"
        onClick={(e) => onStep(-1, e.shiftKey)}
      >
        <Minus className="size-3.5" />
      </ToolbarButton>

      <input
        aria-label="Font size"
        inputMode="decimal"
        spellCheck={false}
        autoComplete="off"
        className="h-7 w-10 rounded-md bg-transparent text-center text-[13px] font-semibold text-white outline-none focus:bg-white/10"
        value={draft ?? formatFontSize(value)}
        onFocus={(e) => {
          setDraft(formatFontSize(value));
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // Keep keystrokes away from any document-level shortcuts.
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            skipBlurCommitRef.current = true;
            if (draft !== null) commit(draft);
            setDraft(null);
            onReturnFocus();
          } else if (e.key === "Escape") {
            e.preventDefault();
            skipBlurCommitRef.current = true;
            setDraft(null);
            onReturnFocus();
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            onStep(e.key === "ArrowUp" ? 1 : -1, e.shiftKey);
            setDraft(null);
          }
        }}
        onBlur={() => {
          if (skipBlurCommitRef.current) {
            skipBlurCommitRef.current = false;
            return;
          }
          if (draft !== null) commit(draft);
          setDraft(null);
        }}
      />

      <Popover open={presetsOpen} onOpenChange={setPresetsOpen}>
        <PopoverTrigger asChild>
          <ToolbarButton label="Font sizes" className="-ml-1 mr-0.5 w-5">
            <ChevronDown className="size-3" />
          </ToolbarButton>
        </PopoverTrigger>
        <PopoverContent
          align="center"
          sideOffset={8}
          className="w-20 border-white/10 bg-neutral-900 p-1 text-neutral-200"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            onReturnFocus();
          }}
        >
          <div className="max-h-64 overflow-y-auto">
            {FONT_SIZE_PRESETS.map((size) => (
              <button
                key={size}
                type="button"
                className={cn(
                  "w-full rounded px-2 py-1 text-left text-xs hover:bg-white/10",
                  value !== null && Math.round(value) === size && "bg-white/15",
                )}
                onClick={() => {
                  onSet(size);
                  setPresetsOpen(false);
                }}
              >
                {size}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <ToolbarButton
        label="Increase font size (Shift: 10)"
        onClick={(e) => onStep(1, e.shiftKey)}
      >
        <Plus className="size-3.5" />
      </ToolbarButton>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

function TextSelectionToolbarImpl({
  iframeElement,
  containerElement,
  zoom,
  editingLayer,
  allLayers,
  onLayerUpdate,
  fieldGroups,
  allFields,
  collections,
  isInsideCollectionLayer = false,
}: TextSelectionToolbarProps) {
  const editor = useCanvasTextEditorStore((s) => s.editor);
  const isEditing = useCanvasTextEditorStore((s) => s.isEditing);
  const activeMarks = useCanvasTextEditorStore((s) => s.activeMarks);
  const toggleBold = useCanvasTextEditorStore((s) => s.toggleBold);
  const toggleItalic = useCanvasTextEditorStore((s) => s.toggleItalic);
  const toggleUnderline = useCanvasTextEditorStore((s) => s.toggleUnderline);
  const toggleStrike = useCanvasTextEditorStore((s) => s.toggleStrike);
  const focusEditor = useCanvasTextEditorStore((s) => s.focusEditor);

  const activeBreakpoint = useEditorStore((s) => s.activeBreakpoint);
  const activeUIState = useEditorStore((s) => s.activeUIState);
  const activeTextStyleKey = useEditorStore((s) => s.activeTextStyleKey);

  // Inline (selection) styles: with a selection, `updateDesignProperty` creates
  // or reuses a dynamicStyle mark and edits that text style.
  const {
    updateDesignProperty: updateInlineStyle,
    debouncedUpdateDesignProperty,
  } = useDesignSync({
    layer: editingLayer,
    onLayerUpdate,
    activeBreakpoint,
    activeUIState,
    activeTextStyleKey,
  });

  // Block-level properties (alignment): always the layer itself, never an
  // inline style, so no active text style key is passed.
  const {
    updateDesignProperties: updateLayerProperties,
    getDesignProperty: getLayerProperty,
  } = useDesignSync({
    layer: editingLayer,
    onLayerUpdate,
    activeBreakpoint,
    activeUIState,
    activeTextStyleKey: null,
  });

  /** Rendered size/colour at the selection (see getSelectionComputedTypography). */
  const [typography, setTypography] = useState<{
    fontSizePx: number | null;
    color: string | null;
  }>({ fontSizePx: null, color: null });
  /** A size we just applied but that hasn't rendered yet, shown meanwhile so
   * rapid +/- clicks build on each other instead of the stale rendered value. */
  const pendingSizeRef = useRef<{
    px: number;
    from: number;
    to: number;
    at: number;
  } | null>(null);

  const toolbarRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const rafRef = useRef<number | null>(null);
  /** True while the mouse is down inside the editor (drag-selecting). */
  const selectingRef = useRef(false);
  /** True while something else owns the canvas (sidebar resize, context menu). */
  const blockedRef = useRef(false);
  // The link popover is open *for a particular editor instance*. Every editing
  // session creates a fresh editor, so the popover closes by itself when
  // editing ends: no reset effect needed.
  const [linkOpenFor, setLinkOpenFor] = useState<Editor | null>(null);
  const linkOpen = editor !== null && linkOpenFor === editor;

  // ── Positioning ────────────────────────────────────────────────────────────

  const position = useCallback(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const hide = () => {
      if (el.style.display !== "none") el.style.display = "none";
    };

    if (
      !editor ||
      !iframeElement ||
      !containerElement ||
      !useCanvasTextEditorStore.getState().isEditing ||
      blockedRef.current ||
      selectingRef.current
    ) {
      hide();
      return;
    }

    const selectionRect = getEditorSelectionRect(editor);
    if (!selectionRect) {
      hide();
      return;
    }

    // Refresh the size/colour readout for the selection (cheap; only commits
    // to React state when something actually changed).
    const computed = getSelectionComputedTypography(editor);
    let sizePx = computed ? Math.round(computed.fontSizePx * 10) / 10 : null;
    const pending = pendingSizeRef.current;
    if (pending) {
      const { from, to } = editor.state.selection;
      const expired =
        Date.now() - pending.at > PENDING_SIZE_TTL_MS ||
        pending.from !== from ||
        pending.to !== to;
      if (expired || (sizePx !== null && Math.abs(sizePx - pending.px) < 0.5)) {
        pendingSizeRef.current = null; // rendered value caught up (or moved on)
      } else {
        sizePx = pending.px;
      }
    }
    const color = computed ? rgbToHexColor(computed.color) : null;
    setTypography((prev) =>
      prev.fontSizePx === sizePx && prev.color === color
        ? prev
        : { fontSizePx: sizePx, color },
    );

    const anchor = mapIframeRectToContainer(
      selectionRect,
      iframeElement.getBoundingClientRect(),
      containerElement.getBoundingClientRect(),
      zoomRef.current / 100,
    );

    // Must be displayed to be measured; both happen before the next paint.
    el.style.display = "flex";
    const placement = placeToolbar(
      anchor,
      { width: el.offsetWidth, height: el.offsetHeight },
      {
        width: containerElement.clientWidth,
        height: containerElement.clientHeight,
      },
    );
    if (!placement) {
      hide();
      return;
    }
    el.style.transform = `translate3d(${Math.round(placement.left)}px, ${Math.round(placement.top)}px, 0)`;
  }, [editor, iframeElement, containerElement]);

  /** Coalesce bursts of events (scroll, transactions, mutations) into one
   * measurement per frame. */
  const schedule = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      position();
    });
  }, [position]);

  // Re-measure when editing starts/stops or the editor instance changes.
  useEffect(() => {
    schedule();
  }, [isEditing, editor, schedule]);

  // Zoom changes shift every rect inside the iframe. The zoom transform may
  // animate, so measure now and again once it has settled.
  useEffect(() => {
    zoomRef.current = zoom;
    schedule();
    const id = setTimeout(schedule, 200);
    return () => clearTimeout(id);
  }, [zoom, schedule]);

  // Selection / content / layout / scroll listeners.
  useEffect(() => {
    if (!editor || !iframeElement || !containerElement) return;
    const iframeDoc = iframeElement.contentDocument;
    if (!iframeDoc) return;

    let editorDom: HTMLElement | null = null;
    try {
      editorDom = editor.view.dom;
    } catch {
      return; // view not mounted yet; effect re-runs when the editor changes
    }

    const timeouts = new Set<ReturnType<typeof setTimeout>>();
    const scheduleSettled = () => {
      schedule();
      const id = setTimeout(() => {
        timeouts.delete(id);
        schedule();
      }, SETTLE_DELAY_MS);
      timeouts.add(id);
    };

    // Hide while drag-selecting; reveal on mouseup (window as well, because the
    // pointer can be released outside the iframe).
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (editorDom && editorDom.contains(e.target as Node)) {
        selectingRef.current = true;
        position();
      }
    };
    const onMouseUp = () => {
      if (!selectingRef.current) return;
      selectingRef.current = false;
      schedule();
    };

    editor.on("selectionUpdate", schedule);
    editor.on("transaction", scheduleSettled);
    editor.on("focus", schedule);
    editor.on("blur", schedule);

    iframeDoc.addEventListener("mousedown", onMouseDown, true);
    iframeDoc.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("blur", onMouseUp);

    containerElement.addEventListener("scroll", schedule, { passive: true });
    iframeDoc.addEventListener("scroll", schedule, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("viewportChange", scheduleSettled);

    // Layout shifts that don't come from a transaction: font swaps, image
    // loads, class changes applied by dynamic styles, sidebar-driven resizes.
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(editorDom);
    resizeObserver.observe(iframeElement);
    if (iframeDoc.body) resizeObserver.observe(iframeDoc.body);

    const mutationObserver = new MutationObserver(scheduleSettled);
    mutationObserver.observe(editorDom, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    // Sidebar resize / canvas context menu temporarily own the canvas.
    const syncBlocked = (state: ReturnType<typeof useEditorStore.getState>) => {
      const blocked = !!(
        state.isSidebarResizing || state.isCanvasContextMenuOpen
      );
      if (blocked === blockedRef.current) return;
      blockedRef.current = blocked;
      schedule();
    };
    syncBlocked(useEditorStore.getState());
    const unsubscribe = useEditorStore.subscribe(syncBlocked);

    schedule();

    return () => {
      editor.off("selectionUpdate", schedule);
      editor.off("transaction", scheduleSettled);
      editor.off("focus", schedule);
      editor.off("blur", schedule);
      iframeDoc.removeEventListener("mousedown", onMouseDown, true);
      iframeDoc.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("blur", onMouseUp);
      containerElement.removeEventListener("scroll", schedule);
      iframeDoc.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("viewportChange", scheduleSettled);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      unsubscribe();
      timeouts.forEach(clearTimeout);
      selectingRef.current = false;
    };
  }, [editor, iframeElement, containerElement, position, schedule]);

  // Cancel any pending frame on unmount.
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Keep focus and the selection in the iframe when a toolbar button is
    // pressed. React bubbles events from portalled popover content through
    // this handler too; those live outside the toolbar's DOM and must keep
    // their default behaviour (typing in inputs, opening selects, ...).
    const target = e.target as HTMLElement;
    if (!e.currentTarget.contains(target)) return;
    if (target.closest("input, textarea, select, [contenteditable='true']")) {
      return;
    }
    e.preventDefault();
  }, []);

  // ── Font size / colour / alignment ─────────────────────────────────────────

  const applyFontSize = useCallback(
    (px: number) => {
      if (!editor) return;
      try {
        const { from, to } = editor.state.selection;
        pendingSizeRef.current = { px, from, to, at: Date.now() };
      } catch {
        return; // editor view gone
      }
      setTypography((prev) => ({ ...prev, fontSizePx: px }));
      updateInlineStyle("typography", "fontSize", fontSizeToDesignValue(px));
      // Re-measure once the optimistic value has expired, in case the
      // rendered size never caught up.
      setTimeout(schedule, PENDING_SIZE_TTL_MS + 50);
    },
    [editor, updateInlineStyle, schedule],
  );

  const stepFontSizeBy = useCallback(
    (direction: 1 | -1, big: boolean) => {
      applyFontSize(
        stepFontSize(typography.fontSizePx ?? 16, direction, big ? 10 : 1),
      );
    },
    [applyFontSize, typography.fontSizePx],
  );

  const handleColorImmediate = useCallback(
    (value: string) => {
      updateInlineStyle(
        "typography",
        "color",
        value.replace(/\s+/g, "") || null,
      );
    },
    [updateInlineStyle],
  );

  const handleColorDebounced = useCallback(
    (value: string) => {
      debouncedUpdateDesignProperty(
        "typography",
        "color",
        value.replace(/\s+/g, "") || null,
      );
    },
    [debouncedUpdateDesignProperty],
  );

  const handleColorOpenChange = useCallback(
    (open: boolean) => {
      // Hand keyboard focus back to the text once the picker closes.
      if (!open) requestAnimationFrame(focusEditor);
    },
    [focusEditor],
  );

  const currentAlign = normalizeTextAlign(
    getLayerProperty("typography", "textAlign"),
  );

  const handleAlign = useCallback(
    (value: TextAlign) => {
      updateLayerProperties([
        { category: "typography", property: "textAlign", value },
      ]);
    },
    [updateLayerProperties],
  );

  // ── Link eligibility (mirrors Ycode: links can't be nested) ───────────────

  const canHaveLinks = editingLayer
    ? canLayerHaveLink(editingLayer, allLayers, "richText").canHaveLinks
    : true;

  return (
    <div className="pointer-events-none absolute inset-0 z-50 overflow-hidden">
      <div
        ref={toolbarRef}
        role="toolbar"
        aria-label="Text formatting"
        data-text-selection-toolbar
        onMouseDown={handleMouseDown}
        className={cn(
          "pointer-events-auto absolute top-0 left-0 h-10 items-center gap-0.5 px-1.5",
          "rounded-xl border border-white/10 bg-neutral-900/85 text-neutral-200 backdrop-blur-md",
          "shadow-[0_8px_30px_rgba(0,0,0,0.35)] select-none will-change-transform",
        )}
        style={HIDDEN_STYLE}
      >
        <ToolbarButton
          label="Bold (Ctrl/⌘ B)"
          pressed={activeMarks.bold}
          onClick={toggleBold}
        >
          <Bold className="size-4" strokeWidth={2.25} />
        </ToolbarButton>
        <ToolbarButton
          label="Italic (Ctrl/⌘ I)"
          pressed={activeMarks.italic}
          onClick={toggleItalic}
        >
          <Italic className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Underline (Ctrl/⌘ U)"
          pressed={activeMarks.underline}
          onClick={toggleUnderline}
        >
          <Underline className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Strikethrough"
          pressed={activeMarks.strike}
          onClick={toggleStrike}
        >
          <Strikethrough className="size-4" />
        </ToolbarButton>

        <Divider />

        {editor && canHaveLinks ? (
          <RichTextLinkPopover
            editor={editor}
            fieldGroups={fieldGroups}
            allFields={allFields}
            collections={collections}
            isInsideCollectionLayer={isInsideCollectionLayer}
            layer={editingLayer}
            open={linkOpen}
            onOpenChange={(open) => setLinkOpenFor(open ? editor : null)}
            trigger={
              <ToolbarButton label="Link" pressed={activeMarks.richTextLink}>
                <Link2 className="size-4" />
              </ToolbarButton>
            }
          />
        ) : (
          <ToolbarButton label="Links cannot be nested" disabled>
            <Link2 className="size-4" />
          </ToolbarButton>
        )}

        <Divider />

        <FontSizeControl
          value={typography.fontSizePx}
          onStep={stepFontSizeBy}
          onSet={applyFontSize}
          onReturnFocus={focusEditor}
        />

        <Divider />

        {/* The picker's swatch trigger is themed for the app; restyle it to sit
            in the dark pill. */}
        <div className="flex items-center [&_button]:bg-white/10 [&_button:hover]:bg-white/20">
          <ColorPicker
            swatchOnly
            solidOnly
            value={typography.color ?? ""}
            defaultValue="#ffffff"
            onChange={handleColorDebounced}
            onImmediateChange={handleColorImmediate}
            onOpenChange={handleColorOpenChange}
          />
        </div>

        <Divider />

        {ALIGNMENTS.map(({ value, label, Icon }) => (
          <ToolbarButton
            key={value}
            label={label}
            pressed={currentAlign === value}
            onClick={() => handleAlign(value)}
          >
            <Icon className="size-4" />
          </ToolbarButton>
        ))}
      </div>
    </div>
  );
}

export const TextSelectionToolbar = memo(TextSelectionToolbarImpl);
export default TextSelectionToolbar;
