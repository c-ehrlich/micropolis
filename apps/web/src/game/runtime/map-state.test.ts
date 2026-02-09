import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CORE_VERSION,
  DEFAULT_LOCAL_CLIENT_ID,
  DEFAULT_LOCAL_ROOM_ID,
  DEFAULT_PROTOCOL_VERSION,
} from './protocol.ts';
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
    protocolVersion: DEFAULT_PROTOCOL_VERSION,
    coreVersion: DEFAULT_CORE_VERSION,
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
          // C map storage is x-major (`Map[x][y]`) in `s_alloc.c`/`s_fileio.c`:
          // index = x * height + y, so this decodes to runtime row-major [0,1,2,3,4,5].
          tileWords: [0, 3, 1, 4, 2, 5],
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
          tileWordDeltas: [
            { x: 0, y: 0, tileWord: 9 },
            { x: 1, y: 1, tileWord: 10 },
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
          tileWords: [1, 3, 2, 4],
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
          tileWordDeltas: [{ x: 1, y: 0, tileWord: 7 }],
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
          tileWordDeltas: [{ x: 1, y: 1, tileWord: 9 }],
        },
      },
    });

    expect(stale.outcome).toBe('dropped-stale');
    expect(Array.from(stale.state.mapState.tiles)).toEqual(beforeStaleTiles);
    expect(stale.state.mapState.renderEpoch).toBe(beforeStaleEpoch);
  });
});
