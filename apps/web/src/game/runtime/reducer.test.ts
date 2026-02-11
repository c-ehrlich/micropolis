import { describe, expect, it } from 'vitest';

import {
  type SimContext,
  type SimState,
  Tile,
  TileFlag,
  World,
} from '../../../../../packages/sim-core/src/index.ts';
import { sendMes } from '../../../../../packages/sim-core/src/systems/messages.ts';
import {
  DEFAULT_CORE_VERSION,
  DEFAULT_LOCAL_CLIENT_ID,
  DEFAULT_LOCAL_ROOM_ID,
  DEFAULT_PROTOCOL_VERSION,
  type HostEnvelope,
  type PlayableClientCommand,
  type PlayableToolCommand,
} from './protocol.ts';
import {
  createInitialWebRuntimeState,
  enqueuePendingToolCommandVisual,
  reduceHostEnvelope,
} from './reducer.ts';
import { SimCoreEnvelopeHost } from './sim-core-envelope-host.ts';

/**
 * Builds a valid accepted hello envelope for deterministic Playable Runtime runtime tests.
 * Mirrors startup validation gate expectations mapped from
 * `ref/micropolis/src/sim/w_sim.c`.
 */
function createAcceptedHelloEnvelope(): HostEnvelope {
  return {
    kind: 'hello',
    roomId: DEFAULT_LOCAL_ROOM_ID,
    clientId: DEFAULT_LOCAL_CLIENT_ID,
    protocolVersion: DEFAULT_PROTOCOL_VERSION,
    coreVersion: DEFAULT_CORE_VERSION,
    accepted: true,
  };
}

/**
 * Creates a deterministic Playable Runtime tool command fixture used in pending tests.
 * Mirrors tool intent routing for `DoTool` in `ref/micropolis/src/sim/w_tool.c`.
 */
function createToolCommand(tool: PlayableToolCommand['tool']): PlayableToolCommand {
  return {
    kind: 'tool',
    tool,
    x: 10,
    y: 10,
  };
}

describe('reduceHostEnvelope', () => {
  it('ignores non-hello envelopes until hello completes', () => {
    const state = createInitialWebRuntimeState();

    const result = reduceHostEnvelope(state, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 1,
      serverSeq: 1,
      payload: {},
    });

    expect(result.outcome).toBe('ignored-until-hello');
    expect(result.state).toEqual(state);
    expect(result.effect).toEqual({ kind: 'none' });
  });

  it('applies hello and then applies in-order envelopes while tracking seq/tick', () => {
    const state = createInitialWebRuntimeState();
    const afterHello = reduceHostEnvelope(state, createAcceptedHelloEnvelope());

    const afterPatch = reduceHostEnvelope(afterHello.state, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      // These values model ordered event progression from C command/update loops
      // (`w_sim.c` + `w_update.c`), where sequence increases one step at a time.
      tick: 3,
      serverSeq: 1,
      payload: { funds: 1000 },
    });

    expect(afterHello.state.handshakeComplete).toBe(true);
    expect(afterPatch.outcome).toBe('applied');
    expect(afterPatch.state.lastAppliedServerSeq).toBe(1);
    expect(afterPatch.state.lastAppliedTick).toBe(3);
  });

  it('treats the first sequenced envelope as the ordering baseline even when serverSeq jumps', () => {
    const state = createInitialWebRuntimeState();
    const afterHello = reduceHostEnvelope(state, createAcceptedHelloEnvelope()).state;

    const baselineSnapshot = reduceHostEnvelope(afterHello, {
      kind: 'snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      // Mirrors bridge `initial_event` sequencing semantics mapped from
      // `ref/micropolis/src/sim/s_sim.c` monotonic time progression:
      // first accepted transport event establishes the baseline cursor.
      tick: 4,
      serverSeq: 12,
      payload: {
        map: { width: 1, height: 1, tileWords: [5] },
      },
    });

    expect(baselineSnapshot.outcome).toBe('applied');
    expect(baselineSnapshot.state.lastAppliedServerSeq).toBe(12);
    expect(baselineSnapshot.state.lastAppliedTick).toBe(4);

    const inOrderTail = reduceHostEnvelope(baselineSnapshot.state, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 4,
      serverSeq: 13,
      payload: {
        map: { tileWordDeltas: [{ x: 0, y: 0, tileWord: 7 }] },
      },
    });

    expect(inOrderTail.outcome).toBe('applied');
    expect(inOrderTail.state.lastAppliedServerSeq).toBe(13);
    expect(inOrderTail.state.mapState.tiles[0]).toBe(7);
  });

  it('keeps strict gap handling after a serverSeq=0 baseline snapshot', () => {
    const state = createInitialWebRuntimeState();
    const afterHello = reduceHostEnvelope(state, createAcceptedHelloEnvelope()).state;

    const baselineSnapshot = reduceHostEnvelope(afterHello, {
      kind: 'snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      // Bridge V1 sequencing allows an initial baseline at sequence 0; this mirrors
      // replay baselines in bridge recovery streams mapped from `sim.c` update loops.
      tick: 0,
      serverSeq: 0,
      payload: {
        map: { width: 1, height: 1, tileWords: [3] },
      },
    });
    expect(baselineSnapshot.outcome).toBe('applied');
    expect(baselineSnapshot.state.lastAppliedServerSeq).toBe(0);

    const gap = reduceHostEnvelope(baselineSnapshot.state, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 0,
      serverSeq: 2,
      payload: {
        map: { tileWordDeltas: [{ x: 0, y: 0, tileWord: 9 }] },
      },
    });

    expect(gap.outcome).toBe('gap-detected');
    expect(gap.effect).toEqual({
      kind: 'request_snapshot',
      reason: 'sequence-gap',
      fromServerSeq: 1,
    });
    expect(gap.state.lastAppliedServerSeq).toBe(0);
    expect(gap.state.mapState.tiles[0]).toBe(3);
  });

  it('keeps sequenced ordering rules unchanged when envelopes carry sound deltas', () => {
    const state = createInitialWebRuntimeState();
    const afterHello = reduceHostEnvelope(state, createAcceptedHelloEnvelope()).state;
    const baselineSnapshot = reduceHostEnvelope(afterHello, {
      kind: 'snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      // `w_update.c` update sequencing is monotonic; bridge state must enforce
      // the same `serverSeq` ordering even when `MakeSound` payloads are attached.
      tick: 8,
      serverSeq: 20,
      payload: {
        map: { width: 1, height: 1, tileWords: [11] },
      },
      soundDeltas: [
        { channel: 'city', soundSpec: 'Siren' },
        { channel: 'warning', soundSpec: 'Explosion High' },
      ],
    });
    expect(baselineSnapshot.outcome).toBe('applied');
    expect(baselineSnapshot.state.lastAppliedServerSeq).toBe(20);

    const inOrder = reduceHostEnvelope(baselineSnapshot.state, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 9,
      serverSeq: 21,
      payload: {
        map: { tileWordDeltas: [{ x: 0, y: 0, tileWord: 12 }] },
      },
      soundDeltas: [{ channel: 'edit', soundSpec: 'Bulldozer' }],
    });
    expect(inOrder.outcome).toBe('applied');
    expect(inOrder.state.lastAppliedServerSeq).toBe(21);
    expect(inOrder.state.mapState.tiles[0]).toBe(12);

    const stale = reduceHostEnvelope(inOrder.state, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 9,
      serverSeq: 21,
      payload: {
        map: { tileWordDeltas: [{ x: 0, y: 0, tileWord: 13 }] },
      },
      soundDeltas: [{ channel: 'city', soundSpec: 'HonkHonk-Med' }],
    });
    expect(stale.outcome).toBe('dropped-stale');
    expect(stale.state.lastAppliedServerSeq).toBe(21);
    expect(stale.state.mapState.tiles[0]).toBe(12);

    const gap = reduceHostEnvelope(inOrder.state, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 9,
      serverSeq: 23,
      payload: {
        map: { tileWordDeltas: [{ x: 0, y: 0, tileWord: 14 }] },
      },
      soundDeltas: [{ channel: 'warning', soundSpec: 'UhUh' }],
    });
    expect(gap.outcome).toBe('gap-detected');
    expect(gap.state.lastAppliedServerSeq).toBe(21);
    expect(gap.effect).toEqual({
      kind: 'request_snapshot',
      reason: 'sequence-gap',
      fromServerSeq: 22,
    });
  });

  it('uses canonical hello `message` when the host rejects handshake', () => {
    const state = createInitialWebRuntimeState();
    const rejected = reduceHostEnvelope(state, {
      kind: 'hello',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      coreVersion: DEFAULT_CORE_VERSION,
      accepted: false,
      message: 'protocol mismatch',
    });

    expect(rejected.outcome).toBe('hello-rejected');
    expect(rejected.state.phase).toBe('failed');
    expect(rejected.state.handshakeComplete).toBe(false);
    expect(rejected.state.handshakeError).toBe('protocol mismatch');
  });

  it('drops stale envelopes', () => {
    const state = createInitialWebRuntimeState();
    const afterHello = reduceHostEnvelope(state, createAcceptedHelloEnvelope()).state;
    const afterFirst = reduceHostEnvelope(afterHello, {
      kind: 'ack',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 5,
      serverSeq: 1,
      commandId: 'cmd-1',
    }).state;

    const stale = reduceHostEnvelope(afterFirst, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 4,
      serverSeq: 1,
      payload: { stale: true },
    });

    expect(stale.outcome).toBe('dropped-stale');
    expect(stale.state.lastAppliedServerSeq).toBe(1);
    expect(stale.state.lastAppliedTick).toBe(5);
    expect(stale.effect).toEqual({ kind: 'none' });
  });

  it('detects sequence gaps and requests snapshot from the expected seq', () => {
    const state = createInitialWebRuntimeState();
    const afterHello = reduceHostEnvelope(state, createAcceptedHelloEnvelope()).state;
    const afterFirst = reduceHostEnvelope(afterHello, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 7,
      serverSeq: 1,
      payload: { baseline: true },
    }).state;

    const gap = reduceHostEnvelope(afterFirst, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 7,
      // Gap is intentional: jump from seq 1 to seq 3 to verify resync behavior.
      serverSeq: 3,
      payload: { skipped: 2 },
    });

    expect(gap.outcome).toBe('gap-detected');
    expect(gap.state.phase).toBe('resyncing');
    expect(gap.state.lastAppliedServerSeq).toBe(1);
    expect(gap.effect).toEqual({
      kind: 'request_snapshot',
      reason: 'sequence-gap',
      fromServerSeq: 2,
    });
  });

  it('keeps expanded authoritative projection state unchanged for stale drops and sequence gaps', () => {
    const state = createInitialWebRuntimeState();
    const afterHello = reduceHostEnvelope(state, createAcceptedHelloEnvelope()).state;
    const afterSnapshot = reduceHostEnvelope(afterHello, {
      kind: 'snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      // Mirrors monotonic simulation/frame progression assumptions from
      // `ref/micropolis/src/sim/s_sim.c` and `ref/micropolis/src/sim/sim.c`.
      tick: 10,
      serverSeq: 10,
      payload: {
        map: { width: 1, height: 1, tileWords: [5] },
        hud: {
          fundsLabel: 'Funds: $20,000',
          date: { label: 'Jan 1900', month: 0, year: 1900 },
          demand: { r: 0, c: 0, i: 0 },
          speed: 1,
        },
        messages: [
          {
            // C message ids are integer table indexes in `s_msg.c`.
            id: 14,
            text: 'Residents demand police stations.',
          },
        ],
        realtime: {
          // Fields map to `SimSprite` in `packages/sim-core/src/sim/realtime.ts`,
          // the TypeScript port of `ref/micropolis/src/sim/w_sprite.c`.
          objects: [{ name: 'TRA', type: 1, x: 64, y: 80, frame: 2 }],
        },
      },
    }).state;
    const baselineProjection = reduceHostEnvelope(afterSnapshot, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 11,
      serverSeq: 11,
      payload: {
        map: { tileWordDeltas: [{ x: 0, y: 0, tileWord: 7 }] },
        hud: { speed: 2 },
        messageDeltas: [{ id: 16, text: 'Taxes are too high.' }],
        realtime: {
          objects: [{ name: 'TRA', type: 1, x: 80, y: 96, frame: 3 }],
        },
      },
    }).state;

    const stale = reduceHostEnvelope(baselineProjection, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 12,
      // Stale duplicate sequence should be dropped without projection changes.
      serverSeq: 11,
      payload: {
        map: { tileWordDeltas: [{ x: 0, y: 0, tileWord: 9 }] },
        hud: { speed: 3 },
        messageDeltas: [{ id: 17, text: 'Road maintenance is low.' }],
        realtime: {
          objects: [{ name: 'TRA', type: 1, x: 96, y: 112, frame: 4 }],
        },
      },
    });
    expect(stale.outcome).toBe('dropped-stale');
    expect(stale.state).toBe(baselineProjection);
    expect(stale.effect).toEqual({ kind: 'none' });

    const gap = reduceHostEnvelope(baselineProjection, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 12,
      // Gap from expected seq 12 to 13 must request snapshot resync.
      serverSeq: 13,
      payload: {
        map: { tileWordDeltas: [{ x: 0, y: 0, tileWord: 9 }] },
        hud: { speed: 3 },
        messageDeltas: [{ id: 17, text: 'Road maintenance is low.' }],
        realtime: {
          objects: [{ name: 'TRA', type: 1, x: 96, y: 112, frame: 4 }],
        },
      },
    });

    expect(gap.outcome).toBe('gap-detected');
    expect(gap.state.phase).toBe('resyncing');
    expect(gap.state.mapState).toBe(baselineProjection.mapState);
    expect(gap.state.hudState).toBe(baselineProjection.hudState);
    expect(gap.state.realtimeState).toBe(baselineProjection.realtimeState);
    expect(gap.effect).toEqual({
      kind: 'request_snapshot',
      reason: 'sequence-gap',
      fromServerSeq: 12,
    });
  });

  it('requests resync when tick regresses even if serverSeq is in-order', () => {
    const state = createInitialWebRuntimeState();
    const afterHello = reduceHostEnvelope(state, createAcceptedHelloEnvelope()).state;
    const afterFirst = reduceHostEnvelope(afterHello, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      // Mirrors monotonic tick progression intent in `s_sim.c` (`CityTime` never decreases),
      // reusing the same small deterministic sequence vectors as bridge sequencing tests.
      tick: 7,
      serverSeq: 1,
      payload: { baseline: true },
    }).state;

    const tickRegression = reduceHostEnvelope(afterFirst, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 6,
      serverSeq: 2,
      payload: { regressed: true },
    });

    expect(tickRegression.outcome).toBe('gap-detected');
    expect(tickRegression.state.phase).toBe('resyncing');
    expect(tickRegression.state.lastAppliedServerSeq).toBe(1);
    expect(tickRegression.effect).toEqual({
      kind: 'request_snapshot',
      reason: 'sequence-gap',
      fromServerSeq: 2,
    });
  });

  it('clears pending visuals when a sequence gap forces resync', () => {
    const state = createInitialWebRuntimeState();
    const afterHello = reduceHostEnvelope(state, createAcceptedHelloEnvelope()).state;
    const withPending = enqueuePendingToolCommandVisual(
      afterHello,
      'cmd-gap',
      createToolCommand('road'),
    );
    const afterFirst = reduceHostEnvelope(withPending, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 7,
      serverSeq: 1,
      payload: { baseline: true },
    }).state;

    const gap = reduceHostEnvelope(afterFirst, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 7,
      serverSeq: 3,
      payload: { skipped: 2 },
    });

    expect(gap.state.phase).toBe('resyncing');
    expect(gap.state.pendingTools).toHaveLength(0);
    expect(gap.effect).toEqual({
      kind: 'request_snapshot',
      reason: 'sequence-gap',
      fromServerSeq: 2,
    });
  });

  it('requests a resync snapshot when host sends a resync directive', () => {
    const state = createInitialWebRuntimeState();
    const afterHello = reduceHostEnvelope(state, createAcceptedHelloEnvelope()).state;
    const afterPatch = reduceHostEnvelope(afterHello, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 4,
      serverSeq: 1,
      payload: { baseline: true },
    }).state;

    const afterResync = reduceHostEnvelope(afterPatch, {
      kind: 'resync',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 4,
      serverSeq: 3,
      reason: 'server-gap-detected',
    });

    expect(afterResync.outcome).toBe('applied');
    expect(afterResync.state.phase).toBe('resyncing');
    expect(afterResync.state.lastAppliedServerSeq).toBe(3);
    expect(afterResync.effect).toEqual({
      kind: 'request_snapshot',
      reason: 'resync',
      fromServerSeq: 4,
    });
  });

  it('accepts snapshot rebases during resync and preserves ordered patch progression', () => {
    const state = createInitialWebRuntimeState();
    const afterHello = reduceHostEnvelope(state, createAcceptedHelloEnvelope()).state;
    const afterPatch = reduceHostEnvelope(afterHello, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 4,
      serverSeq: 1,
      payload: { baseline: true },
    }).state;
    const afterResync = reduceHostEnvelope(afterPatch, {
      kind: 'resync',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 4,
      serverSeq: 2,
      reason: 'server-gap-detected',
    }).state;

    const rebasedSnapshot = reduceHostEnvelope(afterResync, {
      kind: 'snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 8,
      // Reconnect/resync snapshots can jump forward to current authority seq.
      serverSeq: 12,
      payload: {
        map: { width: 1, height: 1, tileWords: [5] },
      },
    });
    expect(rebasedSnapshot.outcome).toBe('applied');
    expect(rebasedSnapshot.state.phase).toBe('ready');
    expect(rebasedSnapshot.state.lastAppliedServerSeq).toBe(12);

    const afterTailPatch = reduceHostEnvelope(rebasedSnapshot.state, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 9,
      serverSeq: 13,
      payload: {
        map: { tileWordDeltas: [{ x: 0, y: 0, tileWord: 7 }] },
      },
    });
    expect(afterTailPatch.outcome).toBe('applied');
    expect(afterTailPatch.state.lastAppliedServerSeq).toBe(13);

    const stale = reduceHostEnvelope(afterTailPatch.state, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 9,
      serverSeq: 12,
      payload: {
        map: { tileWordDeltas: [{ x: 0, y: 0, tileWord: 9 }] },
      },
    });
    expect(stale.outcome).toBe('dropped-stale');
    expect(stale.state.lastAppliedServerSeq).toBe(13);
  });

  it('reconstructs map/hud/messages identically from snapshot checkpoint replay plus patch tail', () => {
    const start = reduceHostEnvelope(
      createInitialWebRuntimeState(),
      createAcceptedHelloEnvelope(),
    ).state;

    const liveAfterSnapshot = reduceHostEnvelope(start, {
      kind: 'snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 10,
      serverSeq: 1,
      payload: {
        map: { width: 1, height: 1, tileWords: [5] },
        hud: {
          fundsLabel: 'Funds: $20,000',
          date: { label: 'Jan 1900', month: 0, year: 1900 },
          demand: { r: 0, c: 0, i: 0 },
          speed: 1,
          options: {
            autoBudget: true,
            autoGo: true,
            autoBulldoze: true,
            disasters: true,
            userSoundOn: true,
            doAnimation: true,
            doMessages: true,
            doNotices: true,
          },
        },
        messages: [
          {
            // C message ids are integer table indexes in `s_msg.c`.
            id: 14,
            text: 'Residents demand police stations.',
          },
        ],
      },
    }).state;
    const liveAfterPatchOne = reduceHostEnvelope(liveAfterSnapshot, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 11,
      serverSeq: 2,
      payload: {
        map: { tileWordDeltas: [{ x: 0, y: 0, tileWord: 7 }] },
        hud: {
          speed: 2,
        },
        messageDeltas: [{ id: 16, text: 'Taxes are too high.' }],
      },
    }).state;
    const liveFinal = reduceHostEnvelope(liveAfterPatchOne, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 12,
      serverSeq: 3,
      payload: {
        map: { tileWordDeltas: [{ x: 0, y: 0, tileWord: 9 }] },
        hud: {
          speed: 3,
        },
        messageDeltas: [{ id: 17, text: 'Road maintenance is low.' }],
      },
    }).state;

    const replayCheckpoint = reduceHostEnvelope(start, {
      kind: 'snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 11,
      serverSeq: 2,
      payload: {
        map: { width: 1, height: 1, tileWords: [7] },
        hud: {
          fundsLabel: 'Funds: $20,000',
          date: { label: 'Jan 1900', month: 0, year: 1900 },
          demand: { r: 0, c: 0, i: 0 },
          speed: 2,
          options: {
            autoBudget: true,
            autoGo: true,
            autoBulldoze: true,
            disasters: true,
            userSoundOn: true,
            doAnimation: true,
            doMessages: true,
            doNotices: true,
          },
        },
        messages: [
          {
            id: 14,
            text: 'Residents demand police stations.',
            tick: 10,
            serverSeq: 1,
          },
          {
            id: 16,
            text: 'Taxes are too high.',
            tick: 11,
            serverSeq: 2,
          },
        ],
      },
    }).state;
    const replayFinal = reduceHostEnvelope(replayCheckpoint, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 12,
      serverSeq: 3,
      payload: {
        map: { tileWordDeltas: [{ x: 0, y: 0, tileWord: 9 }] },
        hud: {
          speed: 3,
        },
        messageDeltas: [{ id: 17, text: 'Road maintenance is low.' }],
      },
    }).state;

    expect(Array.from(replayFinal.mapState.tiles)).toEqual(Array.from(liveFinal.mapState.tiles));
    expect(replayFinal.hudState).toEqual(liveFinal.hudState);
  });

  it('creates pending command visuals and settles them on ack', () => {
    const state = createInitialWebRuntimeState();
    const afterHello = reduceHostEnvelope(state, createAcceptedHelloEnvelope()).state;
    const withPending = enqueuePendingToolCommandVisual(
      afterHello,
      'cmd-road',
      createToolCommand('road'),
    );

    expect(withPending.pendingTools).toHaveLength(1);
    expect(withPending.pendingTools[0]?.commandId).toBe('cmd-road');

    const afterAck = reduceHostEnvelope(withPending, {
      kind: 'ack',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 1,
      serverSeq: 1,
      commandId: 'cmd-road',
    });

    expect(afterAck.outcome).toBe('applied');
    expect(afterAck.state.pendingTools).toHaveLength(0);
    expect(afterAck.state.lastRejectReason).toBeNull();
  });

  it('projects optional realtime object payloads from snapshot and patch envelopes', () => {
    const state = createInitialWebRuntimeState();
    const afterHello = reduceHostEnvelope(state, createAcceptedHelloEnvelope()).state;

    const afterSnapshot = reduceHostEnvelope(afterHello, {
      kind: 'snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 1,
      serverSeq: 1,
      payload: {
        realtime: {
          // Fields map to `SimSprite` shape from `packages/sim-core/src/sim/realtime.ts`,
          // the TypeScript parity port of `ref/micropolis/src/sim/w_sprite.c`.
          objects: [{ name: 'TRA', type: 1, x: 64, y: 80, frame: 2 }],
        },
      },
    });

    expect(afterSnapshot.state.realtimeState.objects).toEqual([
      { name: 'TRA', type: 1, x: 64, y: 80, frame: 2 },
    ]);

    const afterPatch = reduceHostEnvelope(afterSnapshot.state, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 2,
      serverSeq: 2,
      payload: {
        realtime: {
          objects: [{ name: 'TRA', type: 1, x: 80, y: 96, frame: 3 }],
        },
      },
    });

    expect(afterPatch.state.realtimeState.objects).toEqual([
      { name: 'TRA', type: 1, x: 80, y: 96, frame: 3 },
    ]);
  });

  it('consumes sim-core envelope-host snapshot/patch payload schemas without reducer regressions', () => {
    const host = new SimCoreEnvelopeHost();
    const envelopes: HostEnvelope[] = [];
    const connection = host.connect((envelope) => {
      envelopes.push(envelope);
    });
    const hostInternals = host as unknown as {
      authorityState: {
        simState: SimState;
        simContext: SimContext;
        store: {
          beginTick(): void;
          commitTick(): void;
          getLayer(layer: 'map'): Uint16Array | unknown;
        };
      };
    };
    const wireX = 22;
    const wireY = 22;
    const mapIndex = wireX * World.WORLD_Y + wireY;

    hostInternals.authorityState.store.beginTick();
    try {
      const mapLayer = hostInternals.authorityState.store.getLayer('map');
      if (!(mapLayer instanceof Uint16Array)) {
        throw new Error('expected authoritative map layer to be Uint16Array');
      }
      mapLayer[mapIndex] = Tile.ROADS | TileFlag.BULLBIT | TileFlag.BURNBIT;
    } finally {
      hostInternals.authorityState.store.commitTick();
    }

    connection.send({
      kind: 'hello',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      coreVersion: DEFAULT_CORE_VERSION,
    });
    connection.send({
      kind: 'command',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      commandId: 'cmd-wire-schema',
      command: {
        kind: 'tool',
        tool: 'wire',
        x: wireX,
        y: wireY,
      },
    });
    expect(
      sendMes(hostInternals.authorityState.simState, hostInternals.authorityState.simContext, 14),
    ).toBe(true);
    hostInternals.authorityState.simContext.hooks.generateCopter();
    connection.send({
      kind: 'command',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      commandId: 'cmd-pause-schema',
      command: {
        kind: 'sim-control',
        control: 'pause',
      },
    });

    const wireAck = envelopes.find(
      (envelope): envelope is Extract<HostEnvelope, { kind: 'ack' }> =>
        envelope.kind === 'ack' && envelope.commandId === 'cmd-wire-schema',
    );
    expect(wireAck).toBeDefined();
    const wirePatch = envelopes.find((envelope) => {
      return envelope.kind === 'patch' && envelope.serverSeq === (wireAck?.serverSeq ?? -1) + 1;
    });
    if (wirePatch === undefined || wirePatch.kind !== 'patch') {
      throw new Error('expected patch envelope immediately after wire ack');
    }
    const wireMapPayload = wirePatch.payload.map;
    if (wireMapPayload === undefined || !('tileWordDeltas' in wireMapPayload)) {
      throw new Error('expected canonical map tileWordDeltas payload after wire command');
    }
    const wireDelta = wireMapPayload.tileWordDeltas.find(
      (delta) => delta.x === wireX && delta.y === wireY,
    );
    expect(wireDelta).toBeDefined();
    expect(wireMapPayload.redrawPlan).toMatchObject({
      reason: 'patch-rects',
      fullRedraw: false,
    });
    const pauseAck = envelopes.find(
      (envelope): envelope is Extract<HostEnvelope, { kind: 'ack' }> =>
        envelope.kind === 'ack' && envelope.commandId === 'cmd-pause-schema',
    );
    expect(pauseAck).toBeDefined();
    const pausePatch = envelopes.find((envelope) => {
      return envelope.kind === 'patch' && envelope.serverSeq === (pauseAck?.serverSeq ?? -1) + 1;
    });
    if (pausePatch === undefined || pausePatch.kind !== 'patch') {
      throw new Error('expected patch envelope immediately after pause ack');
    }
    const pauseRealtime = pausePatch.payload.realtime;
    expect(pauseRealtime).toBeDefined();
    expect(Array.isArray(pauseRealtime?.objects)).toBe(true);
    expect(Array.isArray(pauseRealtime?.deltas)).toBe(true);

    let reducedState = createInitialWebRuntimeState();
    for (const envelope of envelopes) {
      const reduction = reduceHostEnvelope(reducedState, envelope);
      expect(reduction.outcome).toBe('applied');
      reducedState = reduction.state;
    }

    const rowMajorIndex = wireY * reducedState.mapState.width + wireX;
    expect(reducedState.handshakeComplete).toBe(true);
    expect(reducedState.mapState.hasSnapshot).toBe(true);
    expect(reducedState.mapState.width).toBe(World.WORLD_X);
    expect(reducedState.mapState.height).toBe(World.WORLD_Y);
    expect(reducedState.mapState.tiles[rowMajorIndex]).toBe(wireDelta?.tileWord);
    expect(reducedState.hudState.messages.some((message) => message.id === 14)).toBe(true);
    expect(reducedState.realtimeState.objects).toEqual(pauseRealtime?.objects ?? []);
  });

  it('keeps authoritative projection state unchanged when enqueueing pending tool visuals', () => {
    const state = createInitialWebRuntimeState();
    const afterHello = reduceHostEnvelope(state, createAcceptedHelloEnvelope()).state;
    const afterSnapshot = reduceHostEnvelope(afterHello, {
      kind: 'snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 1,
      serverSeq: 1,
      payload: {
        map: { width: 1, height: 1, tileWords: [5] },
        hud: {
          fundsLabel: 'Funds: $5000',
        },
      },
    }).state;

    const withPending = enqueuePendingToolCommandVisual(
      afterSnapshot,
      'cmd-pending',
      createToolCommand('road'),
    );

    expect(withPending.pendingTools).toHaveLength(1);
    expect(withPending.mapState).toBe(afterSnapshot.mapState);
    expect(withPending.hudState).toBe(afterSnapshot.hudState);
    expect(withPending.realtimeState).toBe(afterSnapshot.realtimeState);
    expect(withPending.lastAppliedServerSeq).toBe(afterSnapshot.lastAppliedServerSeq);
    expect(withPending.lastAppliedTick).toBe(afterSnapshot.lastAppliedTick);
  });

  it('rolls back pending visual markers on reject', () => {
    const state = createInitialWebRuntimeState();
    const afterHello = reduceHostEnvelope(state, createAcceptedHelloEnvelope()).state;
    const withPending = enqueuePendingToolCommandVisual(
      afterHello,
      'cmd-out-of-bounds',
      createToolCommand('res'),
    );

    const afterReject = reduceHostEnvelope(withPending, {
      kind: 'reject',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 1,
      serverSeq: 1,
      commandId: 'cmd-out-of-bounds',
      reason: 'out-of-bounds',
    });

    expect(afterReject.outcome).toBe('applied');
    expect(afterReject.state.pendingTools).toHaveLength(0);
    expect(afterReject.state.lastRejectReason).toBe('out-of-bounds');
  });

  it('correlates duplicate command outcomes by commandId without settling other pending markers', () => {
    const state = createInitialWebRuntimeState();
    const afterHello = reduceHostEnvelope(state, createAcceptedHelloEnvelope()).state;
    const withFirst = enqueuePendingToolCommandVisual(
      afterHello,
      'cmd-1',
      createToolCommand('road'),
    );
    const withSecond = enqueuePendingToolCommandVisual(
      withFirst,
      'cmd-2',
      createToolCommand('rail'),
    );

    const afterFirstAck = reduceHostEnvelope(withSecond, {
      kind: 'ack',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 1,
      serverSeq: 1,
      commandId: 'cmd-1',
    }).state;
    const afterDuplicateAck = reduceHostEnvelope(afterFirstAck, {
      kind: 'ack',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 2,
      serverSeq: 2,
      commandId: 'cmd-1',
    }).state;
    const afterDuplicateReject = reduceHostEnvelope(afterDuplicateAck, {
      kind: 'reject',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 3,
      serverSeq: 3,
      commandId: 'cmd-1',
      reason: 'duplicate',
    }).state;

    expect(afterFirstAck.pendingTools.map((pending) => pending.commandId)).toEqual(['cmd-2']);
    expect(afterDuplicateAck.pendingTools.map((pending) => pending.commandId)).toEqual(['cmd-2']);
    expect(afterDuplicateReject.pendingTools.map((pending) => pending.commandId)).toEqual([
      'cmd-2',
    ]);
  });

  it('does not enqueue pending visuals for non-tool commands', () => {
    const state = createInitialWebRuntimeState();
    const afterHello = reduceHostEnvelope(state, createAcceptedHelloEnvelope()).state;
    const pauseCommand: PlayableClientCommand = {
      kind: 'sim-control',
      control: 'pause',
    };

    const next = enqueuePendingToolCommandVisual(afterHello, 'cmd-pause', pauseCommand);
    expect(next).toBe(afterHello);
  });
});
