import { describe, expect, it } from 'vitest';

import { createCoalescedStateDispatcher } from './frame-coalescer.ts';

interface ManualFrameScheduler {
  cancelFrame(frameHandle: number): void;
  pendingFrameCount(): number;
  runNextFrame(): void;
  scheduleFrame(flush: () => void): number;
}

/**
 * Deterministic animation-frame scheduler fixture for runtime coalescer tests.
 * Parity note: this is a test seam for browser `requestAnimationFrame`.
 */
function createManualFrameScheduler(): ManualFrameScheduler {
  let nextFrameHandle = 1;
  const pendingFrames = new Map<number, () => void>();

  return {
    scheduleFrame(flush) {
      const frameHandle = nextFrameHandle;
      nextFrameHandle += 1;
      pendingFrames.set(frameHandle, flush);
      return frameHandle;
    },
    cancelFrame(frameHandle) {
      pendingFrames.delete(frameHandle);
    },
    runNextFrame() {
      const nextPendingFrame = pendingFrames.entries().next().value;
      if (nextPendingFrame === undefined) {
        throw new Error('Expected at least one pending animation frame');
      }

      const [frameHandle, flush] = nextPendingFrame;
      pendingFrames.delete(frameHandle);
      flush();
    },
    pendingFrameCount() {
      return pendingFrames.size;
    },
  };
}

describe('createCoalescedStateDispatcher', () => {
  it('keeps only the latest queued state per scheduled frame', () => {
    const scheduler = createManualFrameScheduler();
    const committedStates: number[] = [];
    const dispatcher = createCoalescedStateDispatcher<number>({
      scheduleFrame: scheduler.scheduleFrame,
      cancelFrame: scheduler.cancelFrame,
      commitState: (nextState) => {
        committedStates.push(nextState);
      },
    });

    dispatcher.queue(1);
    dispatcher.queue(2);
    dispatcher.queue(3);

    expect(scheduler.pendingFrameCount()).toBe(1);
    expect(committedStates).toEqual([]);

    scheduler.runNextFrame();

    expect(committedStates).toEqual([3]);
    expect(scheduler.pendingFrameCount()).toBe(0);
  });

  it('schedules another frame after the previous queued frame flushes', () => {
    const scheduler = createManualFrameScheduler();
    const committedStates: string[] = [];
    const dispatcher = createCoalescedStateDispatcher<string>({
      scheduleFrame: scheduler.scheduleFrame,
      cancelFrame: scheduler.cancelFrame,
      commitState: (nextState) => {
        committedStates.push(nextState);
      },
    });

    dispatcher.queue('alpha');
    scheduler.runNextFrame();
    dispatcher.queue('beta');
    scheduler.runNextFrame();

    expect(committedStates).toEqual(['alpha', 'beta']);
  });

  it('cancels pending frame work and drops queued state on dispose', () => {
    const scheduler = createManualFrameScheduler();
    const committedStates: number[] = [];
    const dispatcher = createCoalescedStateDispatcher<number>({
      scheduleFrame: scheduler.scheduleFrame,
      cancelFrame: scheduler.cancelFrame,
      commitState: (nextState) => {
        committedStates.push(nextState);
      },
    });

    dispatcher.queue(42);
    expect(scheduler.pendingFrameCount()).toBe(1);

    dispatcher.dispose();
    expect(scheduler.pendingFrameCount()).toBe(0);

    dispatcher.queue(7);
    scheduler.runNextFrame();

    expect(committedStates).toEqual([7]);
  });

  it('supports caller-provided queued-state coalescing before frame flush', () => {
    const scheduler = createManualFrameScheduler();
    const committedStates: number[] = [];
    const dispatcher = createCoalescedStateDispatcher<number>({
      scheduleFrame: scheduler.scheduleFrame,
      cancelFrame: scheduler.cancelFrame,
      commitState: (nextState) => {
        committedStates.push(nextState);
      },
      coalesceQueuedState: (queuedState, nextState) => queuedState + nextState,
    });

    dispatcher.queue(1);
    dispatcher.queue(2);
    dispatcher.queue(3);
    scheduler.runNextFrame();

    expect(committedStates).toEqual([6]);
  });
});
