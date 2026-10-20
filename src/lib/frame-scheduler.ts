/**
 * Frame scheduler
 *
 * Coalesces any number of `schedule()` calls into a single callback per
 * animation frame.
 *
 * The coalescing needs a "a frame is already pending" flag, and that flag is
 * only correct if it is cleared on *every* path that makes the pending frame
 * not run: the frame firing, and `cancel()`. This is why it lives in one small
 * unit instead of being hand-rolled next to a `useRef` in components.
 *
 * Hand-rolled, the cancel path is easy to get wrong: calling
 * `cancelAnimationFrame(ref.current)` without also resetting `ref.current`
 * leaves a permanently "pending" flag whose frame will never fire, after which
 * every `schedule()` is silently dropped. React StrictMode (on by default in
 * `next dev`) triggers exactly that by running an effect's cleanup and then
 * re-running the effect on the same component instance, and so does Fast
 * Refresh.
 *
 * A scheduler stays usable after `cancel()`: cancelling only discards the
 * pending frame, it does not dispose the scheduler.
 */

export interface FrameScheduler {
  /** Request `run` on the next frame. No-op if a frame is already pending. */
  schedule: () => void;
  /** Drop the pending frame, if any. `schedule()` works again afterwards. */
  cancel: () => void;
}

export function createFrameScheduler(
  run: () => void,
  // Injectable so the logic can be tested without a browser.
  raf: (callback: () => void) => number = (callback) =>
    requestAnimationFrame(callback),
  caf: (id: number) => void = (id) => cancelAnimationFrame(id),
): FrameScheduler {
  let pendingId: number | null = null;

  return {
    schedule() {
      if (pendingId !== null) return;
      pendingId = raf(() => {
        // Clear first, so `run` may itself call `schedule()` for a later frame.
        pendingId = null;
        run();
      });
    },

    cancel() {
      if (pendingId === null) return;
      caf(pendingId);
      pendingId = null;
    },
  };
}
