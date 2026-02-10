import { describe, expect, it } from 'vitest';

import type { SequencedHostEnvelope } from './protocol.ts';
import {
  createInitialRuntimeRealtimeState,
  projectRuntimeRealtimeState,
} from './realtime-state.ts';

/**
 * Builds one sequenced host envelope fixture for realtime projection tests.
 * Mirrors ordered host update sequencing used by the bridge runtime around
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_update.c`.
 */
function createSequencedEnvelope(
  kind: 'snapshot' | 'patch',
  payload: Record<string, unknown>,
): SequencedHostEnvelope {
  return {
    kind,
    roomId: 'room-stage2',
    clientId: 'client-stage2',
    tick: 5,
    serverSeq: 10,
    payload,
  };
}

describe('runtime realtime projection', () => {
  it('hydrates realtime objects from snapshot payloads', () => {
    const initial = createInitialRuntimeRealtimeState();
    const next = projectRuntimeRealtimeState(
      initial,
      createSequencedEnvelope('snapshot', {
        realtime: {
          // Stage 2 payload mirrors `SimSprite` positional fields from
          // `packages/sim-core/src/sim/realtime.ts` (`w_sprite.c` parity port).
          objects: [{ name: 'TRA', type: 1, x: 64, y: 80, frame: 2 }],
        },
      }),
    );

    expect(next.objects).toEqual([{ name: 'TRA', type: 1, x: 64, y: 80, frame: 2 }]);
  });

  it('applies realtime object updates from patch payloads', () => {
    const afterSnapshot = projectRuntimeRealtimeState(
      createInitialRuntimeRealtimeState(),
      createSequencedEnvelope('snapshot', {
        realtime: {
          objects: [{ name: 'SHI', type: 4, x: 32, y: 48, frame: 1 }],
        },
      }),
    );

    const afterPatch = projectRuntimeRealtimeState(
      afterSnapshot,
      createSequencedEnvelope('patch', {
        realtime: {
          objects: [{ name: 'SHI', type: 4, x: 40, y: 56, frame: 2 }],
        },
      }),
    );

    expect(afterPatch.objects).toEqual([{ name: 'SHI', type: 4, x: 40, y: 56, frame: 2 }]);
  });

  it('applies Stage 7 realtime snapshot/delta payload fields', () => {
    const afterSnapshot = projectRuntimeRealtimeState(
      createInitialRuntimeRealtimeState(),
      createSequencedEnvelope('snapshot', {
        realtime: {
          snapshot: [{ id: 'rt-1', name: 'TOR', type: 6, x: 96, y: 112, frame: 1 }],
        },
      }),
    );

    expect(afterSnapshot.objects).toEqual([
      // Type `6` is tornado (`TOR`) from sprite constants in
      // `ref/micropolis/src/sim/headers/sim.h` / `w_sprite.c`.
      { id: 'rt-1', name: 'TOR', type: 6, x: 96, y: 112, frame: 1 },
    ]);

    const afterPatch = projectRuntimeRealtimeState(
      afterSnapshot,
      createSequencedEnvelope('patch', {
        realtime: {
          deltas: [
            {
              kind: 'upsert',
              object: { id: 'rt-1', name: 'TOR', type: 6, x: 112, y: 128, frame: 2 },
            },
            {
              kind: 'upsert',
              object: { id: 'rt-2', name: 'EXP', type: 7, x: 120, y: 128, frame: 1 },
            },
          ],
        },
      }),
    );

    expect(afterPatch.objects).toEqual([
      { id: 'rt-1', name: 'TOR', type: 6, x: 112, y: 128, frame: 2 },
      { id: 'rt-2', name: 'EXP', type: 7, x: 120, y: 128, frame: 1 },
    ]);

    const afterRemove = projectRuntimeRealtimeState(
      afterPatch,
      createSequencedEnvelope('patch', {
        realtime: {
          deltas: [
            {
              kind: 'remove',
              id: 'rt-1',
            },
          ],
        },
      }),
    );

    expect(afterRemove.objects).toEqual([
      { id: 'rt-2', name: 'EXP', type: 7, x: 120, y: 128, frame: 1 },
    ]);
  });

  it('keeps existing realtime objects when patch payload omits realtime field', () => {
    const afterSnapshot = projectRuntimeRealtimeState(
      createInitialRuntimeRealtimeState(),
      createSequencedEnvelope('snapshot', {
        realtime: {
          objects: [{ name: 'COP', type: 2, x: 10, y: 12, frame: 3 }],
        },
      }),
    );

    const unchanged = projectRuntimeRealtimeState(
      afterSnapshot,
      createSequencedEnvelope('patch', {
        hud: {
          funds: 5000,
        },
      }),
    );

    expect(unchanged).toBe(afterSnapshot);
  });

  it('clears realtime objects on snapshot payloads that omit realtime field', () => {
    const afterSnapshot = projectRuntimeRealtimeState(
      createInitialRuntimeRealtimeState(),
      createSequencedEnvelope('snapshot', {
        realtime: {
          objects: [{ name: 'AIR', type: 3, x: 100, y: 120, frame: 4 }],
        },
      }),
    );

    const cleared = projectRuntimeRealtimeState(
      afterSnapshot,
      createSequencedEnvelope('snapshot', {
        map: { width: 1, height: 1, tileWords: [0] },
      }),
    );

    expect(cleared.objects).toEqual([]);
  });
});
