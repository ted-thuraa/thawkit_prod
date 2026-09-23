"use client";

import React from "react";
import { GitForkIcon, Palette, Plus, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * EditorToolbar — the floating button group at the bottom-centre of the
 * canvas. Positioning is EditorShell's job; this file is only the pill.
 *
 * ACTIONS (from the placeholder buttons that used to live in
 * builderMain.tsx: Plus + Palette, with GitForkIcon already imported
 * there for the funnel-flow action):
 *   - Add element  → onAddElement
 *   - Styles       → onOpenStyles
 *   - Funnel flow  → onOpenFlow
 *
 * None of these features exist yet, so the component is deliberately
 * HANDLER-DRIVEN: a button whose handler isn't supplied renders disabled
 * rather than looking live and silently doing nothing. Passing a handler
 * enables it — no changes to this file needed.
 * ─────────────────────────────────────────────────────────────────────────
 */
interface EditorToolbarProps {
  onAddElement?: () => void;
  onOpenStyles?: () => void;
  onOpenFlow?: () => void;
}

interface ToolbarAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect?: () => void;
}

const EditorToolbar = React.memo(function EditorToolbar({
  onAddElement,
  onOpenStyles,
  onOpenFlow,
}: EditorToolbarProps) {
  const actions: ToolbarAction[] = [
    {
      id: "add-element",
      label: "Add element",
      icon: Plus,
      onSelect: onAddElement,
    },
    { id: "styles", label: "Styles", icon: Palette, onSelect: onOpenStyles },
    {
      id: "funnel-flow",
      label: "Funnel flow",
      icon: GitForkIcon,
      onSelect: onOpenFlow,
    },
  ];

  return (
    <TooltipProvider delayDuration={300}>
      <div
        role="toolbar"
        aria-label="Editor tools"
        aria-orientation="horizontal"
        className="flex items-center gap-1 rounded-xl border bg-background p-1 shadow-lg"
      >
        {actions.map(({ id, label, icon: ActionIcon, onSelect }) => (
          <Tooltip key={id}>
            {/* A disabled <button> swallows pointer events, so the tooltip
                trigger is a wrapper span — otherwise disabled actions would
                never explain themselves. */}
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={label}
                  disabled={!onSelect}
                  onClick={onSelect}
                >
                  <ActionIcon className="size-4" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
});

export default EditorToolbar;
