import { describe, expect, test } from 'vitest';

import {
  createStage4CommandAuthority,
  type SimCoreAuthorityTickScheduler,
  SimCoreCommandAuthority,
} from './sim-core-command-authority';

/**
 * Manual interval scheduler for deterministic authority-loop tests.
 * Mirrors timer-driven simulation cadence from `sim_timeout_loop` in
 * `ref/micropolis/src/sim/sim.c` while keeping TypeScript tests synchronous.
 */
class ManualTickScheduler implements SimCoreAuthorityTickScheduler {
  private readonly callbacks = new Map<number, () => void>();
  private nextHandle = 1;

  public setInterval(callback: () => void, _intervalMs: number): unknown {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.callbacks.set(handle, callback);
    return handle;
  }

  public clearInterval(handle: unknown): void {
    this.callbacks.delete(Number(handle));
  }

  public tick(count = 1): void {
    for (let i = 0; i < count; i += 1) {
      for (const callback of this.callbacks.values()) {
        callback();
      }
    }
  }

  /**
   * Returns number of active timer callbacks in this deterministic scheduler.
   * Mirrors assertions around `StartMicropolisTimer`/`StopMicropolisTimer` parity
   * in `ref/micropolis/src/sim/w_util.c`.
   */
  public activeIntervalCount(): number {
    return this.callbacks.size;
  }
}

/**
 * Reads one ack tick from authority command output.
 * Mirrors ack tick assertions used to verify `setSpeed`/`Pause` behavior from
 * `ref/micropolis/src/sim/w_util.c` and frame gating in `ref/micropolis/src/sim/s_sim.c`.
 */
function expectAckTick(events: ReturnType<SimCoreCommandAuthority['processCommand']>): number {
  const ack = events[0];
  expect(ack?.type).toBe('ack');
  if (ack?.type !== 'ack') {
    throw new Error('expected ack event');
  }

  return ack.tick;
}

describe('SimCoreCommandAuthority', () => {
  test('advances authoritative command ticks from the periodic sim-core loop', () => {
    const scheduler = new ManualTickScheduler();
    const authority = new SimCoreCommandAuthority({
      mode: 'local',
      tickIntervalMs: 1,
      tickScheduler: scheduler,
      seed: 1234,
    });

    authority.connect();
    scheduler.tick(5);

    const [ackEvent, patchEvent] = authority.processCommand({
      type: 'tool-command',
      commandId: 'cmd-ticked',
      tool: 'road',
      x: 4,
      y: 6,
    });

    expect(ackEvent?.type).toBe('ack');
    expect(patchEvent?.type).toBe('patch');

    if (ackEvent?.type !== 'ack') {
      throw new Error('expected ack event');
    }
    expect(ackEvent.tick).toBeGreaterThan(0);

    authority.disconnect();
  });

  test('stops and restarts periodic sim ticks across disconnect/connect lifecycle', () => {
    const scheduler = new ManualTickScheduler();
    const authority = new SimCoreCommandAuthority({
      mode: 'local',
      tickIntervalMs: 1,
      tickScheduler: scheduler,
    });

    authority.connect();
    scheduler.tick(3);
    const tickWhileConnected = expectAckTick(
      authority.processCommand({
        type: 'tool-command',
        commandId: 'cmd-connected',
        tool: 'road',
        x: 14,
        y: 14,
      }),
    );

    authority.disconnect();
    scheduler.tick(8);
    const tickWhileDisconnected = expectAckTick(
      authority.processCommand({
        type: 'tool-command',
        commandId: 'cmd-disconnected',
        tool: 'road',
        x: 15,
        y: 15,
      }),
    );
    expect(tickWhileDisconnected).toBe(tickWhileConnected);

    authority.connect();
    scheduler.tick(2);
    const tickAfterReconnect = expectAckTick(
      authority.processCommand({
        type: 'tool-command',
        commandId: 'cmd-reconnected',
        tool: 'road',
        x: 16,
        y: 16,
      }),
    );
    expect(tickAfterReconnect).toBeGreaterThan(tickWhileDisconnected);

    authority.disconnect();
  });

  test('keeps duplicate command idempotency and sim-core invalid-placement rejection behavior', () => {
    const authority = new SimCoreCommandAuthority({ mode: 'local', tickIntervalMs: 0 });

    const first = authority.processCommand({
      type: 'tool-command',
      commandId: 'cmd-1',
      tool: 'road',
      x: 10,
      y: 10,
    });
    const duplicate = authority.processCommand({
      type: 'tool-command',
      commandId: 'cmd-1',
      tool: 'road',
      x: 10,
      y: 10,
    });
    const occupied = authority.processCommand({
      type: 'tool-command',
      commandId: 'cmd-2',
      tool: 'road',
      x: 10,
      y: 10,
    });

    expect(first.map((event) => event.type)).toEqual(['ack', 'patch']);
    expect(duplicate.map((event) => event.type)).toEqual(['ack']);
    expect(occupied.map((event) => event.type)).toEqual(['reject']);

    const rejectEvent = occupied[0];
    if (rejectEvent?.type !== 'reject') {
      throw new Error('expected reject event');
    }
    expect(rejectEvent.code).toBe('INVALID_PLACEMENT');
  });

  test('maps sim-core tool reject outcomes to stable host reject codes', () => {
    const authority = new SimCoreCommandAuthority({
      mode: 'local',
      tickIntervalMs: 0,
      startingFunds: 0,
    });

    const outOfBounds = authority.processCommand({
      type: 'tool-command',
      commandId: 'cmd-oob',
      tool: 'road',
      x: -1,
      y: 10,
    });
    expect(outOfBounds.map((event) => event.type)).toEqual(['reject']);
    const outOfBoundsReject = outOfBounds[0];
    if (outOfBoundsReject?.type !== 'reject') {
      throw new Error('expected out-of-bounds reject event');
    }
    expect(outOfBoundsReject.code).toBe('OUT_OF_BOUNDS');

    const noFunds = authority.processCommand({
      type: 'tool-command',
      commandId: 'cmd-no-funds',
      tool: 'road',
      x: 10,
      y: 10,
    });
    expect(noFunds.map((event) => event.type)).toEqual(['reject']);
    const noFundsReject = noFunds[0];
    if (noFundsReject?.type !== 'reject') {
      throw new Error('expected no-funds reject event');
    }
    expect(noFundsReject.code).toBe('NO_FUNDS');

    const invalidAuthority = new SimCoreCommandAuthority({
      mode: 'local',
      tickIntervalMs: 0,
      startingFunds: 100,
    });
    invalidAuthority.processCommand({
      type: 'tool-command',
      commandId: 'cmd-place-first',
      tool: 'road',
      x: 12,
      y: 12,
    });
    const invalidPlacement = invalidAuthority.processCommand({
      type: 'tool-command',
      commandId: 'cmd-place-invalid',
      tool: 'road',
      x: 12,
      y: 12,
    });
    expect(invalidPlacement.map((event) => event.type)).toEqual(['reject']);
    const invalidPlacementReject = invalidPlacement[0];
    if (invalidPlacementReject?.type !== 'reject') {
      throw new Error('expected invalid-placement reject event');
    }
    expect(invalidPlacementReject.code).toBe('INVALID_PLACEMENT');
  });

  test('replays snapshot baseline plus sequenced tail after a server-seq checkpoint', () => {
    const authority = new SimCoreCommandAuthority({ mode: 'local', tickIntervalMs: 0 });

    authority.processCommand({
      type: 'tool-command',
      commandId: 'cmd-a',
      tool: 'road',
      x: 2,
      y: 2,
    });
    authority.processCommand({
      type: 'tool-command',
      commandId: 'cmd-b',
      tool: 'wire',
      x: 3,
      y: 3,
    });

    const replay = authority.createSnapshotReplay(2);
    const [snapshot, ...tail] = replay;

    expect(snapshot?.type).toBe('snapshot');
    if (snapshot?.type !== 'snapshot') {
      throw new Error('expected snapshot event');
    }

    expect(snapshot.baseServerSeq).toBe(2);
    expect(snapshot.placements).toEqual([{ commandId: 'cmd-a', tool: 'road', x: 2, y: 2 }]);
    expect(tail.map((event) => event.type)).toEqual(['ack', 'patch']);
  });

  test('mirrors Pause/Resume timer stop-start behavior from w_util.c', () => {
    const scheduler = new ManualTickScheduler();
    const authority = new SimCoreCommandAuthority({
      mode: 'local',
      tickIntervalMs: 1,
      tickScheduler: scheduler,
    });

    authority.connect();
    expect(scheduler.activeIntervalCount()).toBe(1);

    authority.processCommand({
      type: 'sim-control-command',
      commandId: 'cmd-pause',
      control: 'pause',
    });
    expect(scheduler.activeIntervalCount()).toBe(0);

    authority.processCommand({
      type: 'sim-control-command',
      commandId: 'cmd-set-speed-while-paused',
      control: 'set-speed',
      speed: 2,
    });
    expect(scheduler.activeIntervalCount()).toBe(0);

    authority.processCommand({
      type: 'sim-control-command',
      commandId: 'cmd-resume',
      control: 'resume',
    });
    expect(scheduler.activeIntervalCount()).toBe(1);

    authority.disconnect();
    expect(scheduler.activeIntervalCount()).toBe(0);
  });

  test('keeps paused tick frozen and restores remembered speed on resume', () => {
    const scheduler = new ManualTickScheduler();
    const authority = new SimCoreCommandAuthority({
      mode: 'local',
      tickIntervalMs: 1,
      tickScheduler: scheduler,
    });

    authority.connect();
    scheduler.tick(3);

    const tickBeforePause = expectAckTick(
      authority.processCommand({
        type: 'tool-command',
        commandId: 'cmd-before-pause',
        tool: 'road',
        x: 7,
        y: 7,
      }),
    );

    authority.processCommand({
      type: 'sim-control-command',
      commandId: 'cmd-pause',
      control: 'pause',
    });

    scheduler.tick(10);
    const tickWhilePaused = expectAckTick(
      authority.processCommand({
        type: 'tool-command',
        commandId: 'cmd-while-paused',
        tool: 'road',
        x: 8,
        y: 8,
      }),
    );
    expect(tickWhilePaused).toBe(tickBeforePause);

    authority.processCommand({
      type: 'sim-control-command',
      commandId: 'cmd-speed-while-paused',
      control: 'set-speed',
      speed: 1,
    });
    authority.processCommand({
      type: 'sim-control-command',
      commandId: 'cmd-resume',
      control: 'resume',
    });

    // Magic numbers trace to C `SimFrame`/`setSpeed` behavior:
    // - `setSpeed` clamps playable speed to 0..3 in `ref/micropolis/src/sim/w_util.c`.
    // - speed 1 advances only every 5th spdCycle in `ref/micropolis/src/sim/s_sim.c`.
    scheduler.tick(4);
    const tickAfterFourSchedulerSteps = expectAckTick(
      authority.processCommand({
        type: 'tool-command',
        commandId: 'cmd-after-four-steps',
        tool: 'road',
        x: 9,
        y: 9,
      }),
    );
    expect(tickAfterFourSchedulerSteps - tickWhilePaused).toBe(1);

    authority.disconnect();
  });

  test('clamps set-speed command into w_util.c playable range', () => {
    const scheduler = new ManualTickScheduler();
    const authority = new SimCoreCommandAuthority({
      mode: 'local',
      tickIntervalMs: 1,
      tickScheduler: scheduler,
    });

    authority.connect();
    scheduler.tick(1);
    const tickBeforeClampTest = expectAckTick(
      authority.processCommand({
        type: 'tool-command',
        commandId: 'cmd-before-clamp',
        tool: 'road',
        x: 11,
        y: 11,
      }),
    );

    authority.processCommand({
      type: 'sim-control-command',
      commandId: 'cmd-set-speed-overflow',
      control: 'set-speed',
      // Magic number source: `SimCmdSpeed` accepts up to 7 in `w_sim.c`,
      // then `setSpeed` clamps to 3 in `w_util.c`.
      speed: 7,
    });
    scheduler.tick(2);
    const tickAfterOverflow = expectAckTick(
      authority.processCommand({
        type: 'tool-command',
        commandId: 'cmd-after-overflow',
        tool: 'road',
        x: 12,
        y: 12,
      }),
    );
    expect(tickAfterOverflow - tickBeforeClampTest).toBe(2);

    authority.processCommand({
      type: 'sim-control-command',
      commandId: 'cmd-set-speed-negative',
      control: 'set-speed',
      speed: -4,
    });
    scheduler.tick(4);
    const tickAfterNegative = expectAckTick(
      authority.processCommand({
        type: 'tool-command',
        commandId: 'cmd-after-negative',
        tool: 'road',
        x: 13,
        y: 13,
      }),
    );
    expect(tickAfterNegative).toBe(tickAfterOverflow);

    authority.disconnect();
  });
});

describe('createStage4CommandAuthority', () => {
  test('rejects deterministic authority without isolated fallback opt-in', () => {
    expect(() =>
      createStage4CommandAuthority({
        mode: 'local',
        authorityMode: 'deterministic',
      }),
    ).toThrow(
      'Deterministic authority mode is restricted to isolated tests/fallback; set allowDeterministicFallback to true.',
    );
  });

  test('keeps deterministic authority available for isolated fallback usage', () => {
    const authority = createStage4CommandAuthority({
      mode: 'local',
      authorityMode: 'deterministic',
      allowDeterministicFallback: true,
    });

    const first = authority.processCommand({
      type: 'tool-command',
      commandId: 'cmd-det-1',
      tool: 'road',
      x: 5,
      y: 5,
    });
    const occupied = authority.processCommand({
      type: 'tool-command',
      commandId: 'cmd-det-2',
      tool: 'road',
      x: 5,
      y: 5,
    });

    expect(first.map((event) => event.type)).toEqual(['ack', 'patch']);
    expect(occupied.map((event) => event.type)).toEqual(['reject']);
  });
});
