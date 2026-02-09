import { describe, expect, it } from 'vitest';

import {
  createInitialRuntimeMapState,
  projectRuntimeMapState,
  type RuntimeMapState,
} from './map-state.ts';
import {
  DEFAULT_LOCAL_CLIENT_ID,
  DEFAULT_LOCAL_ROOM_ID,
  type HostMapPatchTileWordDelta,
  type SequencedHostEnvelope,
} from './protocol.ts';

/**
 * Applies one ordered envelope stream to runtime map projection state.
 * Mirrors snapshot baseline + patch tail replay semantics used for map recovery
 * in `ref/micropolis/spec/integration/SPEC.md`.
 */
function applyMapEnvelopeStream(
  state: RuntimeMapState,
  envelopes: readonly SequencedHostEnvelope[],
): RuntimeMapState {
  return envelopes.reduce((nextState, envelope) => {
    return projectRuntimeMapState(nextState, envelope);
  }, state);
}

/**
 * Builds one authoritative snapshot envelope fixture for map projection tests.
 * Mirrors map snapshot payload ownership in `ref/micropolis/src/sim/w_update.c`.
 * Parity note: `tileWords` fixtures intentionally use C x-major ordering.
 */
function createSnapshotEnvelope(
  serverSeq: number,
  tick: number,
  width: number,
  height: number,
  tileWords: readonly number[],
): SequencedHostEnvelope {
  return {
    kind: 'snapshot',
    roomId: DEFAULT_LOCAL_ROOM_ID,
    clientId: DEFAULT_LOCAL_CLIENT_ID,
    tick,
    serverSeq,
    payload: {
      map: {
        width,
        height,
        tileWords,
      },
    },
  };
}

/**
 * Builds one authoritative patch envelope fixture for map projection tests.
 * Mirrors coordinate-addressed `Map[x][y]` mutation intent in
 * `ref/micropolis/src/sim/w_tool.c` and `ref/micropolis/src/sim/w_con.c`.
 * Parity note: this keeps coordinate deltas (not legacy linear indexes).
 */
function createPatchEnvelope(
  serverSeq: number,
  tick: number,
  tileWordDeltas: readonly HostMapPatchTileWordDelta[],
): SequencedHostEnvelope {
  return {
    kind: 'patch',
    roomId: DEFAULT_LOCAL_ROOM_ID,
    clientId: DEFAULT_LOCAL_CLIENT_ID,
    tick,
    serverSeq,
    payload: {
      map: {
        tileWordDeltas,
      },
    },
  };
}

/**
 * Builds one sequenced non-map envelope for draw-mode reset coverage.
 * Mirrors command-ack sequencing participation in `ref/micropolis/src/sim/w_sim.c`.
 */
function createAckEnvelope(
  serverSeq: number,
  tick: number,
  commandId: string,
): SequencedHostEnvelope {
  return {
    kind: 'ack',
    roomId: DEFAULT_LOCAL_ROOM_ID,
    clientId: DEFAULT_LOCAL_CLIENT_ID,
    tick,
    serverSeq,
    commandId,
  };
}

describe('runtime map projection', () => {
  it('applies snapshot baseline then patch deltas into row-major runtime tiles', () => {
    const initial = createInitialRuntimeMapState();
    const afterSnapshot = projectRuntimeMapState(
      initial,
      createSnapshotEnvelope(
        1,
        0,
        3,
        2,
        // C map storage is x-major (`Map[x][y]`) in `s_alloc.c`/`s_fileio.c`:
        // `index = x * height + y`, so this decodes to runtime row-major
        // `[0, 1, 2, 3, 4, 5]`.
        [0, 3, 1, 4, 2, 5],
      ),
    );

    expect(afterSnapshot.hasSnapshot).toBe(true);
    expect(afterSnapshot.drawMode).toBe('snapshot');
    expect(afterSnapshot.renderEpoch).toBe(1);
    expect(Array.from(afterSnapshot.tiles)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(Array.from(afterSnapshot.dirtyTileIndexes)).toEqual([]);

    const afterPatch = projectRuntimeMapState(
      afterSnapshot,
      createPatchEnvelope(2, 1, [
        { x: 0, y: 0, tileWord: 9 },
        { x: 2, y: 1, tileWord: 10 },
      ]),
    );

    expect(afterPatch.drawMode).toBe('patch');
    expect(afterPatch.renderEpoch).toBe(2);
    expect(Array.from(afterPatch.dirtyTileIndexes)).toEqual([0, 5]);
    expect(Array.from(afterPatch.tiles)).toEqual([9, 1, 2, 3, 4, 10]);
  });

  it('reconstructs the same map from snapshot replay plus patch tail', () => {
    const initial = createInitialRuntimeMapState();

    const fullHistoryState = applyMapEnvelopeStream(initial, [
      createSnapshotEnvelope(1, 0, 3, 2, [0, 3, 1, 4, 2, 5]),
      createPatchEnvelope(2, 1, [
        { x: 0, y: 0, tileWord: 9 },
        { x: 2, y: 1, tileWord: 10 },
      ]),
      createPatchEnvelope(3, 2, [{ x: 1, y: 1, tileWord: 11 }]),
    ]);

    const replayState = applyMapEnvelopeStream(initial, [
      createSnapshotEnvelope(
        2,
        1,
        3,
        2,
        // This snapshot baseline represents state after serverSeq=2:
        // row-major `[9, 1, 2, 3, 4, 10]` encoded back to C x-major order.
        [9, 3, 1, 4, 2, 10],
      ),
      createPatchEnvelope(3, 2, [{ x: 1, y: 1, tileWord: 11 }]),
    ]);

    expect(Array.from(fullHistoryState.tiles)).toEqual([9, 1, 2, 3, 11, 10]);
    expect(Array.from(replayState.tiles)).toEqual([9, 1, 2, 3, 11, 10]);
    expect(Array.from(replayState.tiles)).toEqual(Array.from(fullHistoryState.tiles));
    expect(Array.from(replayState.dirtyTileIndexes)).toEqual([4]);
    expect(replayState.drawMode).toBe('patch');
  });

  it('resets draw mode markers to none after non-map sequenced envelopes', () => {
    const initial = createInitialRuntimeMapState();
    const afterSnapshot = projectRuntimeMapState(
      initial,
      createSnapshotEnvelope(1, 0, 3, 2, [0, 3, 1, 4, 2, 5]),
    );
    const afterPatch = projectRuntimeMapState(
      afterSnapshot,
      createPatchEnvelope(2, 1, [{ x: 0, y: 0, tileWord: 9 }]),
    );

    expect(afterPatch.drawMode).toBe('patch');
    expect(Array.from(afterPatch.dirtyTileIndexes)).toEqual([0]);

    const afterAck = projectRuntimeMapState(afterPatch, createAckEnvelope(3, 1, 'cmd-1'));

    expect(afterAck.drawMode).toBe('none');
    expect(Array.from(afterAck.dirtyTileIndexes)).toEqual([]);
    expect(afterAck.renderEpoch).toBe(afterPatch.renderEpoch);
    expect(Array.from(afterAck.tiles)).toEqual(Array.from(afterPatch.tiles));
  });

  it('clears one-shot snapshot draw markers when a patch produces no tile changes', () => {
    const initial = createInitialRuntimeMapState();
    const afterSnapshot = projectRuntimeMapState(
      initial,
      createSnapshotEnvelope(1, 0, 3, 2, [0, 3, 1, 4, 2, 5]),
    );

    expect(afterSnapshot.drawMode).toBe('snapshot');

    const noOpPatch = projectRuntimeMapState(
      afterSnapshot,
      createPatchEnvelope(2, 1, [
        // This tile already has value `0` at runtime row-major index 0.
        { x: 0, y: 0, tileWord: 0 },
      ]),
    );

    expect(noOpPatch.drawMode).toBe('none');
    expect(Array.from(noOpPatch.dirtyTileIndexes)).toEqual([]);
    expect(noOpPatch.renderEpoch).toBe(afterSnapshot.renderEpoch);
    expect(Array.from(noOpPatch.tiles)).toEqual(Array.from(afterSnapshot.tiles));
  });
});
