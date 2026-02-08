import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCAL_CLIENT_ID, DEFAULT_LOCAL_ROOM_ID, type HostEnvelope } from './protocol.ts';
import { createInitialWebRuntimeState, reduceHostEnvelope } from './reducer.ts';

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
    protocolVersion: 'v1',
    coreVersion: 'stage-2',
    accepted: true,
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
      payload: { map: [] },
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
});
