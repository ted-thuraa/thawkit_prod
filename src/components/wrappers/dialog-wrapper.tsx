// DialogProvider.tsx
"use client";

import React, { createContext, useContext, useMemo, useState } from "react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Props for the DialogProvider
 */
export interface DialogProviderProps {
  trigger?: React.ReactNode; // clickable node that will be rendered as trigger (use asChild)
  children: React.ReactNode; // dialog content (component or JSX)
  title?: string;
  description?: string;
  /**
   * Extra classes to apply to the DialogContent container (tailwind classes, etc.)
   */
  className?: string;
  /**
   * Optional callbacks for lifecycle hooks
   */
  onOpen?: () => void;
  onClose?: () => void;
  /**
   * If you need to control open state from outside, pass `controlledOpen` and `onOpenChange`.
   * If omitted, the provider manages its own internal open state.
   */
  controlledOpen?: boolean | undefined;
  onOpenChange?: (open: boolean) => void;
}

/**
 * DialogProvider
 *
 * - Uses shadcn Dialog primitives
 * - Accepts a `trigger` prop which is rendered with `DialogTrigger asChild`
 * - Renders `children` inside DialogContent
 * - Provides internal `useDialogWrapper` context to allow children to close/open the dialog
 */
export default function DialogWrapper({
  trigger,
  children,
  title,
  description,
  className,
  onOpen,
  onClose,
  controlledOpen,
  onOpenChange,
}: DialogProviderProps) {
  // internal state when not controlled externally
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = typeof controlledOpen === "boolean";
  const open = isControlled ? controlledOpen! : internalOpen;

  const setOpen = (v: boolean) => {
    if (isControlled) {
      onOpenChange?.(v);
    } else {
      setInternalOpen(v);
    }
    if (v) onOpen?.();
    else onClose?.();
  };

  const close = () => setOpen(false);
  const openDialog = () => setOpen(true);

  // memoize context value to avoid unnecessary re-renders
  const contextValue = useMemo(
    () => ({ open, setOpen, close, openDialog }),
    [open]
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Render trigger as child so it uses the user's markup */}
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent className={cn(className)} showCloseButton={false}>
        {/* Header + Close button */}
        {(title || description) && (
          <DialogHeader>
            {title && <DialogTitle>{title}</DialogTitle>}
            {description && (
              <DialogDescription>{description}</DialogDescription>
            )}
          </DialogHeader>
        )}

        {/* Provide context to children so they can call useDialogWrapper() */}
        <DialogInternalContext.Provider value={contextValue}>
          <div className="mt-2">{children}</div>
        </DialogInternalContext.Provider>

        {/* Visual close button (can style or relocate) */}
        <DialogClose asChild>
          <button
            aria-label="Close dialog"
            className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            type="button"
          >
            <X size={16} />
          </button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Context exposed to dialog children so they can programmatically close/open
 * (useful for forms inside dialogs, multi-step flows, etc.)
 */
type DialogInternalContextType = {
  open: boolean;
  setOpen: (v: boolean) => void;
  close: () => void;
  openDialog: () => void;
};

const DialogInternalContext = createContext<DialogInternalContextType | null>(
  null
);

export function useDialogWrapper() {
  const ctx = useContext(DialogInternalContext);
  if (!ctx) {
    throw new Error(
      "useDialogWrapper must be used within <DialogProvider> children"
    );
  }
  return ctx;
}
