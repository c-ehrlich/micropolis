import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CORE_VERSION,
  DEFAULT_LOCAL_CLIENT_ID,
  DEFAULT_LOCAL_ROOM_ID,
  DEFAULT_PROTOCOL_VERSION,
  type HostEnvelope,
  type Stage2ClientCommand,
  type Stage2ToolCommand,
} from './protocol.ts';
import {
  createInitialWebRuntimeState,
  enqueuePendingToolCommandVisual,
  reduceHostEnvelope,
} from './reducer.ts';

/**
 * Builds a valid accepted hello envelope for deterministic Stage 2 runtime tests.
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
 * Creates a deterministic Stage 2 tool command fixture used in pending tests.
 * Mirrors tool intent routing for `DoTool` in `ref/micropolis/src/sim/w_tool.c`.
 */
function createToolCommand(tool: Stage2ToolCommand['tool']): Stage2ToolCommand {
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
    const pauseCommand: Stage2ClientCommand = {
      kind: 'sim-control',
      control: 'pause',
    };

    const next = enqueuePendingToolCommandVisual(afterHello, 'cmd-pause', pauseCommand);
    expect(next).toBe(afterHello);
  });
});
