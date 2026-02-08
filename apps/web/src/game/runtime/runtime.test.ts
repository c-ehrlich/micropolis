import { describe, expect, it } from 'vitest';

import {
  type ClientEnvelope,
  type CoreHost,
  type CoreHostConnection,
  DEFAULT_LOCAL_CLIENT_ID,
  DEFAULT_LOCAL_ROOM_ID,
  type HostEnvelope,
} from './protocol.ts';
import { createWebHostRuntime } from './runtime.ts';

/**
 * In-memory test host that captures outbound envelopes and emits host events.
 * Mirrors local deterministic command/update orchestration intent from
 * `ref/micropolis/src/sim/w_sim.c`, adapted for Stage 2 runtime tests.
 */
class FakeLocalHost implements CoreHost {
  public readonly sent: ClientEnvelope[] = [];

  private onEnvelope: ((envelope: HostEnvelope) => void) | undefined;

  public connect(onEnvelope: (envelope: HostEnvelope) => void): CoreHostConnection {
    this.onEnvelope = onEnvelope;
    return {
      send: (envelope) => {
        this.sent.push(envelope);
      },
      disconnect: () => {
        this.onEnvelope = undefined;
      },
    };
  }

  public emit(envelope: HostEnvelope): void {
    if (this.onEnvelope === undefined) {
      throw new Error('host is not connected');
    }

    this.onEnvelope(envelope);
  }
}

describe('createWebHostRuntime', () => {
  it('sends mandatory hello on connect and transitions to ready on accepted hello', () => {
    const host = new FakeLocalHost();
    const runtime = createWebHostRuntime({ host });

    runtime.connect();

    expect(host.sent).toHaveLength(1);
    expect(host.sent[0]).toEqual({
      kind: 'hello',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      protocolVersion: 'v1',
      coreVersion: 'stage-2',
    });
    expect(runtime.getState().phase).toBe('negotiating');

    host.emit({
      kind: 'hello',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      protocolVersion: 'v1',
      coreVersion: 'stage-2',
      accepted: true,
    });

    expect(runtime.getState().phase).toBe('ready');
    expect(runtime.getState().handshakeComplete).toBe(true);
  });

  it('routes envelopes and requests snapshot when a sequence gap is detected', () => {
    const host = new FakeLocalHost();
    const runtime = createWebHostRuntime({ host });
    const outcomes: string[] = [];
    runtime.subscribe((event) => {
      const envelopeKind = event.envelope?.kind ?? 'none';
      outcomes.push(`${event.outcome}:${envelopeKind}`);
    });

    runtime.connect();
    host.emit({
      kind: 'hello',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      protocolVersion: 'v1',
      coreVersion: 'stage-2',
      accepted: true,
    });
    host.emit({
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 4,
      serverSeq: 1,
      payload: { funds: 5000 },
    });
    host.emit({
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 4,
      // Sequence jump intentionally mirrors out-of-order/drop conditions that
      // must resync in Stage 2 ordering rules mapped to `w_sim.c`/`w_update.c`.
      serverSeq: 3,
      payload: { funds: 5100 },
    });
    host.emit({
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 3,
      serverSeq: 1,
      payload: { stale: true },
    });

    expect(outcomes).toContain('applied:hello');
    expect(outcomes).toContain('applied:patch');
    expect(outcomes).toContain('gap-detected:patch');
    expect(outcomes).toContain('dropped-stale:patch');

    expect(host.sent).toContainEqual({
      kind: 'request_snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      reason: 'sequence-gap',
      fromServerSeq: 2,
    });
  });
});
