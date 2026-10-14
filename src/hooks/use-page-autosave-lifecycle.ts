// path: src/hooks/use-page-autosave-lifecycle.ts

"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { selectSaveState, usePagesStore } from "@/stores/editor/usePagesStore";

const SAVE_ERROR_TOAST_ID = "page-autosave-error";

/**
 * Browser-lifecycle glue for page autosave. The save engine itself lives in
 * `usePagesStore` (per-page 2 s debounce, retry, single in-flight request per
 * page); this hook only covers the moments a debounce timer cannot be trusted:
 *
 *   - the tab is hidden or the page is being unloaded → send unsaved edits NOW
 *     instead of waiting out the debounce,
 *   - the user tries to leave with edits that are not saved yet → ask first,
 *   - a save fails → say so once (retries are automatic and silent).
 *
 * Mount it once, in the editor shell.
 */
export function usePageAutosaveLifecycle(): void {
  useEffect(() => {
    const flush = () => {
      void usePagesStore.getState().flushPendingSaves();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (selectSaveState(usePagesStore.getState()) === "saved") return;
      // Best effort: the request may or may not complete as the page tears
      // down, so also ask the user to stay.
      flush();
      event.preventDefault();
      event.returnValue = "";
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  useEffect(() => {
    let previous = selectSaveState(usePagesStore.getState());
    return usePagesStore.subscribe((state) => {
      const next = selectSaveState(state);
      if (next === "error" && previous !== "error") {
        toast.error("Couldn't save your changes", {
          id: SAVE_ERROR_TOAST_ID,
          description:
            "We'll keep retrying. Keep this tab open until it recovers.",
        });
      } else if (previous === "error" && next !== "error") {
        toast.dismiss(SAVE_ERROR_TOAST_ID);
      }
      previous = next;
    });
  }, []);
}
