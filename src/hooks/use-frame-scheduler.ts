"use client";

import { useEffect, useMemo } from "react";
import {
  createFrameScheduler,
  type FrameScheduler,
} from "@/lib/frame-scheduler";

/**
 * Coalesce bursts of events into one `run` per animation frame.
 *
 * The returned scheduler is replaced whenever `run` changes, and any frame
 * still pending on the old one is dropped. It is also cancelled on unmount.
 * Cancelling never disables a scheduler, so this is safe under React
 * StrictMode and Fast Refresh, which run an effect's cleanup and then re-run
 * the effect on the same instance.
 */
export function useFrameScheduler(run: () => void): FrameScheduler {
  const scheduler = useMemo(() => createFrameScheduler(run), [run]);
  useEffect(() => () => scheduler.cancel(), [scheduler]);
  return scheduler;
}
