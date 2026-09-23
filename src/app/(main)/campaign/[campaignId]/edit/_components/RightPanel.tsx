import React from "react";
import { cn } from "@/lib/utils";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * RightPanel — floating properties panel (Design / Settings / Interactions
 * in Ycode's RightSidebar). Intentionally EMPTY for now: this file only
 * establishes the floating card so EditorShell can position it and the
 * real controls can be dropped in as `children` later without touching
 * layout again.
 *
 * `h-full` fills the height EditorShell gives it (top/bottom inset match
 * the left panel); `w-80` (320px) mirrors Ycode's right sidebar width.
 * Content that outgrows the card should scroll inside it — add
 * `overflow-y-auto` on the child you mount, not here, so the rounded
 * corners keep clipping correctly.
 * ─────────────────────────────────────────────────────────────────────────
 */
interface RightPanelProps {
  children?: React.ReactNode;
  className?: string;
}

const RightPanel = React.memo(function RightPanel({
  children,
  className,
}: RightPanelProps) {
  return (
    <aside
      aria-label="Properties"
      className={cn(
        "flex h-full w-80 shrink-0 flex-col overflow-hidden rounded-xl border bg-background shadow-lg",
        className,
      )}
    >
      {children}
    </aside>
  );
});

export default RightPanel;
