/**
 * Live Layer Updates Hook
 *
 * Manages real-time synchronization of layer changes using Supabase Realtime
 */

import { useCallback, useEffect, useMemo, useRef } from "react";

import { usePagesStore } from "@/stores/editor/usePagesStore";
import { useEditorStore } from "@/stores/editor/useEditorStore";

import { findAddedLayerIds } from "@/lib/layer-utils";

import type { Layer, LayerUpdate } from "@/types/funnel";
import { debounce } from "lodash";

// Helper function to find layer in draft
function findLayerInDraft(layers: Layer[], layerId: string): Layer | null {
  for (const layer of layers) {
    if (layer.id === layerId) return layer;
    if (layer.children) {
      const found = findLayerInDraft(layer.children, layerId);
      if (found) return found;
    }
  }
  return null;
}

export interface UseLiveLayerUpdatesReturn {
  broadcastLayerUpdate: (layerId: string, changes: Partial<Layer>) => void;
  broadcastLayerAdd: (
    pageId: string,
    parentLayerId: string | null,
    layerName: string,
    newLayer: Layer,
  ) => void;
  broadcastLayerDelete: (pageId: string, layerId: string) => void;
  broadcastLayerMove: (
    pageId: string,
    layerId: string,
    targetParentId: string | null,
    targetIndex: number,
  ) => void;
  isReceivingUpdates: boolean;
  lastUpdateTime: number | null;
}

export function useLiveLayerUpdates(
  pageId: string | null,
): UseLiveLayerUpdatesReturn {
  const channelRef = useRef<any>(null);
  const isReceivingUpdates = useRef(false);
  const lastUpdateTime = useRef<number | null>(null);
  const updateQueue = useRef<LayerUpdate[]>([]);
  const pageIdRef = useRef<string | null>(pageId);

  // Update pageIdRef whenever pageId changes
  useEffect(() => {
    pageIdRef.current = pageId;
  }, [pageId]);

  const handleIncomingUpdate = useCallback((update: LayerUpdate) => {
    // Get fresh current user ID from store

    // if ( update.user_id === freshCurrentUserId) {
    //   return;
    // }

    // Add to update queue
    updateQueue.current.push(update);

    // Process updates in order
    processUpdateQueue();

    // Update last update time
    lastUpdateTime.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- processUpdateQueue is a ref, adding would cause infinite loop
  }, []);

  const handleLockChange = useCallback((lockChange: any) => {
    // Lock changes are handled silently - no toast notifications
    // The lock indicator UI shows lock status visually
  }, []);

  const handleIncomingLayerAdd = useCallback(
    (payload: any) => {
      // Get fresh current user ID from store
    },
    [pageId],
  );

  const handleIncomingLayerDelete = useCallback(
    (payload: any) => {
      // Get fresh current user ID from store
    },
    [pageId],
  );

  const handleIncomingLayerMove = useCallback((payload: any) => {}, [pageId]);

  const processUpdateQueue = useCallback(() => {
    // Get fresh pageId from the ref (this will be the current value)
    const currentPageId = pageIdRef.current;

    if (updateQueue.current.length === 0) {
      return;
    }

    const update = updateQueue.current.shift();
    if (!update) return;

    // Get fresh state from store
    const { draftsByPageId: freshDrafts, updateLayer: freshUpdateLayer } =
      usePagesStore.getState();
    const currentDraft = freshDrafts[currentPageId || ""];

    if (!currentPageId) {
      return;
    }

    if (!currentDraft) {
      return;
    }

    // Apply the update to the store (without broadcasting back)
    if (currentPageId) {
      try {
        freshUpdateLayer(currentPageId, update.layer_id, update.changes);
      } catch (error) {
        console.error(`[LIVE-UPDATES] Error applying update:`, error);
      }
    }

    // Process next update
    if (updateQueue.current.length > 0) {
      setTimeout(processUpdateQueue, 16); // Process at 60fps
    }
  }, []); // No dependencies since we use refs

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
      }
    };
  }, []);

  // Stable return reference: broadcast callbacks are already memoized via
  // useCallback, and `isReceivingUpdates` / `lastUpdateTime` are refs that
  // mutate silently — no consumer reads them. Returning a stable object
  // prevents downstream `React.memo` cascades through Canvas → LayerRenderer
  // → LayerContextMenu when the host component re-renders for unrelated reasons.
  return useMemo(
    () => ({
      isReceivingUpdates: isReceivingUpdates.current,
      lastUpdateTime: lastUpdateTime.current,
    }),
    [],
  );
}
