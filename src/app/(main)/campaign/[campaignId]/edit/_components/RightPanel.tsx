import React from "react";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Layer } from "@/types/funnel";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import RightPanelContent from "./RightPanelContent";
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
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  onClose?: () => void;
  className?: string;
}

const RightPanel = React.memo(function RightPanel({
  onClose,
  className,
}: RightPanelProps) {
  const handleModeChange = (value: string) => {
    if (value === "agent") {
      //open();
    } else {
      //close();
    }
  };

  return (
    <aside
      aria-label="Properties"
      className={cn(
        "w-64 shrink-0 bg-background border-l flex flex-col h-full overflow-hidden  rounded-xl border  shadow-lg",
        className,
      )}
    >
      <div className="px-4 pt-4 shrink-0">
        <div className="flex items-center gap-2">
          <Tabs
            value={"human"}
            onValueChange={handleModeChange}
            className="min-w-0 flex-1"
          >
            <TabsList className="w-full">
              <TabsTrigger value="human" className="flex-1">
                Human
              </TabsTrigger>
              <TabsTrigger value="agent" className="flex-1">
                Agent
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {onClose && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Close properties panel"
              onClick={onClose}
            >
              <X />
            </Button>
          )}
        </div>
        <hr className="mt-4" />
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <RightPanelContent />
      </div>
    </aside>
  );
});

export default RightPanel;
