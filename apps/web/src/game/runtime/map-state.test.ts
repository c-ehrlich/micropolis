import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCAL_CLIENT_ID, DEFAULT_LOCAL_ROOM_ID } from './protocol.ts';
import { createInitialWebRuntimeState, reduceHostEnvelope } from './reducer.ts';

/**
 * Produces an accepted hello envelope for deterministic map-stream tests.
 * Mirrors handshake gate behavior mapped from `ref/micropolis/src/sim/w_sim.c`.
 */
function createAcceptedHelloEnvelope() {
  return {
    kind: 'hello' as const,
    roomId: DEFAULT_LOCAL_ROOM_ID,
    clientId: DEFAULT_LOCAL_CLIENT_ID,
    protocolVersion: 'v1',
    coreVersion: 'stage-2',
    accepted: true,
  };
}

describe('runtime map projection', () => {
  it('applies snapshot baseline then in-order map patch deltas', () => {
    const initial = createInitialWebRuntimeState();
    const afterHello = reduceHostEnvelope(initial, createAcceptedHelloEnvelope()).state;

    const afterSnapshot = reduceHostEnvelope(afterHello, {
      kind: 'snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 0,
      serverSeq: 1,
      payload: {
        map: {
          width: 3,
          height: 2,
          tiles: [0, 1, 2, 3, 4, 5],
        },
      },
    });

    expect(afterSnapshot.outcome).toBe('applied');
    expect(afterSnapshot.state.mapState.hasSnapshot).toBe(true);
    expect(afterSnapshot.state.mapState.drawMode).toBe('snapshot');
    expect(Array.from(afterSnapshot.state.mapState.tiles)).toEqual([0, 1, 2, 3, 4, 5]);

    const afterPatch = reduceHostEnvelope(afterSnapshot.state, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      // Sequence/tick progression mirrors ordered host application guarantees in
      // `ref/micropolis/src/sim/w_map.c` update entry points for Stage 2.
      tick: 1,
      serverSeq: 2,
      payload: {
        map: {
          tiles: [
            { index: 0, tile: 9 },
            { index: 4, tile: 10 },
          ],
        },
      },
    });

    expect(afterPatch.outcome).toBe('applied');
    expect(afterPatch.state.mapState.drawMode).toBe('patch');
    expect(Array.from(afterPatch.state.mapState.dirtyTileIndexes)).toEqual([0, 4]);
    expect(Array.from(afterPatch.state.mapState.tiles)).toEqual([9, 1, 2, 3, 10, 5]);
  });

  it('drops stale map patches and preserves rendered map state', () => {
    const initial = createInitialWebRuntimeState();
    const afterHello = reduceHostEnvelope(initial, createAcceptedHelloEnvelope()).state;
    const afterSnapshot = reduceHostEnvelope(afterHello, {
      kind: 'snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 0,
      serverSeq: 1,
      payload: {
        map: {
          width: 2,
          height: 2,
          tiles: [1, 2, 3, 4],
        },
      },
    }).state;
    const afterPatch = reduceHostEnvelope(afterSnapshot, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 1,
      serverSeq: 2,
      payload: {
        map: {
          tiles: [{ index: 1, tile: 7 }],
        },
      },
    }).state;

    const beforeStaleTiles = Array.from(afterPatch.mapState.tiles);
    const beforeStaleEpoch = afterPatch.mapState.renderEpoch;
    const stale = reduceHostEnvelope(afterPatch, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 1,
      serverSeq: 2,
      payload: {
        map: {
          tiles: [{ index: 3, tile: 9 }],
        },
      },
    });

    expect(stale.outcome).toBe('dropped-stale');
    expect(Array.from(stale.state.mapState.tiles)).toEqual(beforeStaleTiles);
    expect(stale.state.mapState.renderEpoch).toBe(beforeStaleEpoch);
  });
});
