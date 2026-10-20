// Regression tests for the frame scheduler behind the floating text toolbar.
//
// Bug: TextSelectionToolbar coalesced its measurements with a `rafRef` flag,
// and its unmount cleanup called cancelAnimationFrame(rafRef.current) WITHOUT
// resetting the ref. React StrictMode (on by default in `next dev`) runs that
// cleanup and then re-runs the effects on the same instance, so the flag stayed
// "a frame is pending" while that frame had been cancelled and could never
// fire. Every later schedule() was then dropped: the toolbar stayed
// `display: none` forever, even with a valid selection.
//
// These tests pin the invariant that fixes it: after cancel(), the scheduler
// must work again.
//
// Run:  npm i -D vitest && npx vitest run --config tests/vitest.config.ts

import { describe, expect, it, vi } from "vitest";
import { createFrameScheduler } from "@/lib/frame-scheduler";

/** A controllable stand-in for requestAnimationFrame / cancelAnimationFrame. */
function fakeFrameClock() {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  return {
    raf: (callback: () => void) => {
      const id = nextId++;
      pending.set(id, callback);
      return id;
    },
    caf: vi.fn((id: number) => {
      pending.delete(id);
    }),
    /** Fire every frame callback that is still pending, like one browser frame. */
    flush() {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback());
    },
    get pendingCount() {
      return pending.size;
    },
  };
}

function setup() {
  const clock = fakeFrameClock();
  const run = vi.fn();
  const scheduler = createFrameScheduler(run, clock.raf, clock.caf);
  return { clock, run, scheduler };
}

describe("createFrameScheduler", () => {
  it("coalesces any number of schedule() calls into one run per frame", () => {
    const { clock, run, scheduler } = setup();

    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();
    expect(clock.pendingCount).toBe(1);
    expect(run).not.toHaveBeenCalled();

    clock.flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("can be scheduled again after its frame has run", () => {
    const { clock, run, scheduler } = setup();

    scheduler.schedule();
    clock.flush();
    scheduler.schedule();
    clock.flush();

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("cancel() discards the pending frame so run never fires", () => {
    const { clock, run, scheduler } = setup();

    scheduler.schedule();
    scheduler.cancel();
    clock.flush();

    expect(run).not.toHaveBeenCalled();
    expect(clock.pendingCount).toBe(0);
  });

  it("REGRESSION: schedule() works again after cancel() (StrictMode mount -> cleanup -> remount)", () => {
    const { clock, run, scheduler } = setup();

    scheduler.schedule(); // effects run on mount
    scheduler.cancel(); // StrictMode's simulated unmount cleanup
    scheduler.schedule(); // effects re-run on the same instance

    // The frame requested after the remount must actually be pending...
    expect(clock.pendingCount).toBe(1);
    // ...and must run. With the old latch it was dropped and this stayed 0.
    clock.flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("stays usable across repeated cancel/schedule cycles (StrictMode, Fast Refresh)", () => {
    const { clock, run, scheduler } = setup();

    for (let i = 0; i < 5; i++) {
      scheduler.schedule();
      scheduler.cancel();
    }
    scheduler.schedule();
    clock.flush();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("cancel() with nothing pending is a no-op", () => {
    const { clock, scheduler } = setup();

    scheduler.cancel();

    expect(clock.caf).not.toHaveBeenCalled();
  });

  it("cancel() cancels exactly the pending frame", () => {
    const { clock, scheduler } = setup();

    scheduler.schedule();
    scheduler.cancel();
    scheduler.cancel(); // second cancel has nothing left to cancel

    expect(clock.caf).toHaveBeenCalledTimes(1);
  });

  it("lets run() schedule the next frame itself", () => {
    const clock = fakeFrameClock();
    let runs = 0;
    const scheduler = createFrameScheduler(
      () => {
        runs++;
        if (runs === 1) scheduler.schedule(); // e.g. a re-measure after layout settles
      },
      clock.raf,
      clock.caf,
    );

    scheduler.schedule();
    clock.flush();
    expect(runs).toBe(1);
    expect(clock.pendingCount).toBe(1);

    clock.flush();
    expect(runs).toBe(2);
  });
});
