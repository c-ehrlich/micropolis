/**
 * Scheduler + commit hooks for browser-frame state coalescing.
 * Mirrors Micropolis update cadence where simulation ticks can outpace one
 * visible map/HUD paint pass (`SimFrame` + `sim_update` in
 * `ref/micropolis/src/sim/s_sim.c` / `ref/micropolis/src/sim/sim.c`).
 * Parity note: this is a browser-only transport optimization and does not
 * alter authoritative host ordering or payload semantics.
 */
export interface CoalescedStateDispatcherOptions<State> {
  scheduleFrame: (flush: () => void) => number;
  cancelFrame: (frameHandle: number) => void;
  commitState: (nextState: State) => void;
  /**
   * Optional queued-state reducer used when multiple updates arrive before one
   * scheduled frame flush.
   * Parity note: this is a browser-only coalescing seam and does not affect
   * authoritative host ordering.
   */
  coalesceQueuedState?: (queuedState: State, nextState: State) => State;
}

/**
 * Disposable queue that keeps only the latest state until the next paint.
 * Mirrors the C separation between simulation progression and visible map/UI
 * update passes (`sim_update` map/head refresh flow).
 */
export interface CoalescedStateDispatcher<State> {
  queue(nextState: State): void;
  dispose(): void;
}

/**
 * Creates one state dispatcher that coalesces bursty runtime updates to at
 * most one commit per scheduled frame.
 * Mirrors the practical effect of `sim_update_maps`/`DoUpdateHeads`: consume
 * latest authoritative state on UI update boundaries instead of every internal
 * tick-side mutation.
 */
export function createCoalescedStateDispatcher<State>(
  options: CoalescedStateDispatcherOptions<State>,
): CoalescedStateDispatcher<State> {
  let pendingFrameHandle: number | null = null;
  let hasQueuedState = false;
  let queuedState!: State;

  /**
   * Flush one queued state into the UI commit callback.
   * Parity note: keeps latest-only behavior for queued authority projections.
   */
  const flushQueuedState = (): void => {
    pendingFrameHandle = null;
    if (!hasQueuedState) {
      return;
    }

    hasQueuedState = false;
    const nextState = queuedState;
    options.commitState(nextState);
  };

  return {
    queue(nextState) {
      if (hasQueuedState && options.coalesceQueuedState !== undefined) {
        queuedState = options.coalesceQueuedState(queuedState, nextState);
      } else {
        queuedState = nextState;
      }
      hasQueuedState = true;

      if (pendingFrameHandle !== null) {
        return;
      }

      pendingFrameHandle = options.scheduleFrame(flushQueuedState);
    },
    dispose() {
      hasQueuedState = false;

      if (pendingFrameHandle === null) {
        return;
      }

      options.cancelFrame(pendingFrameHandle);
      pendingFrameHandle = null;
    },
  };
}
