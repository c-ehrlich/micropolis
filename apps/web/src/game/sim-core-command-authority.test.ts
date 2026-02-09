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

  test('keeps duplicate command idempotency and occupied-tile rejection behavior', () => {
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
    expect(rejectEvent.code).toBe('TILE_OCCUPIED');
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
});

describe('createStage4CommandAuthority', () => {
  test('keeps deterministic authority available for isolated fallback usage', () => {
    const authority = createStage4CommandAuthority({
      mode: 'local',
      authorityMode: 'deterministic',
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
