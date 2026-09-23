"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"; // Ensure this path is correct for your Shadcn UI components
import { Button } from "@/components/ui/button"; // Needed for AlertDialogAction props

interface AlertDialogOptions {
  title: string;
  description: ReactNode; // Allow ReactNode for more flexible content
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void; // Optional callback
  onCancel?: () => void; // Optional callback
  danger?: boolean; // For styling the confirm button (e.g., red for destructive actions)
}

interface AlertDialogContextType {
  showAlertDialog: (options: AlertDialogOptions) => Promise<boolean>; // Returns true if confirmed, false if cancelled
}

const AlertDialogContext = createContext<AlertDialogContextType | undefined>(
  undefined,
);

export const useAlertDialog = () => {
  const context = useContext(AlertDialogContext);
  if (!context) {
    throw new Error(
      "useAlertDialog must be used within an AlertDialogProvider",
    );
  }
  return context;
};

interface AlertDialogProviderProps {
  children: ReactNode;
}

interface DialogState {
  isOpen: boolean;
  options: AlertDialogOptions | null;
  resolvePromise: ((value: boolean) => void) | null;
}

export const AlertDialogProvider: React.FC<AlertDialogProviderProps> = ({
  children,
}) => {
  const [dialogState, setDialogState] = useState<DialogState>({
    isOpen: false,
    options: null,
    resolvePromise: null,
  });

  const showAlertDialog = useCallback((opts: AlertDialogOptions) => {
    return new Promise<boolean>((resolve) => {
      setDialogState({
        isOpen: true,
        options: opts,
        resolvePromise: resolve,
      });
    });
  }, []); // No dependencies, this function is stable

  const handleClose = (confirmed: boolean) => {
    if (dialogState.resolvePromise) {
      dialogState.resolvePromise(confirmed);
    }

    if (confirmed && dialogState.options?.onConfirm) {
      dialogState.options.onConfirm();
    } else if (!confirmed && dialogState.options?.onCancel) {
      dialogState.options.onCancel();
    }

    setDialogState({ isOpen: false, options: null, resolvePromise: null });
  };

  // This handles closures triggered by AlertDialog's default behaviors (ESC, overlay click)
  const onDialogVisibilityChange = (open: boolean) => {
    if (!open && dialogState.isOpen) {
      // If the dialog is being closed externally (e.g., ESC, overlay click)
      // and it was previously open according to our state, treat as cancel.
      handleClose(false);
    }
    // If `open` is true, it's typically because we set `dialogState.isOpen` to true,
    // so no specific action is needed here for opening.
  };

  return (
    <AlertDialogContext.Provider value={{ showAlertDialog }}>
      {children}
      {dialogState.options && (
        <AlertDialog
          open={dialogState.isOpen}
          onOpenChange={onDialogVisibilityChange}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{dialogState.options.title}</AlertDialogTitle>
              {dialogState.options.description && (
                <AlertDialogDescription>
                  {dialogState.options.description}
                </AlertDialogDescription>
              )}
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                variant="outline"
                size="default"
                onClick={() => handleClose(false)}
              >
                {dialogState.options.cancelText || "Cancel"}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => handleClose(true)}
                // AlertDialogAction accepts Button props, so variant can be used
                size="default"
                variant={dialogState.options.danger ? "destructive" : "default"}
              >
                {dialogState.options.confirmText || "Confirm"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </AlertDialogContext.Provider>
  );
};
