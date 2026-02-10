import { describe, expect, it } from 'vitest';

import { World } from '../../../../../packages/sim-core/src/index.ts';
import { type HostEnvelope } from './protocol.ts';
import { SimCoreEnvelopeHost } from './sim-core-envelope-host.ts';

/**
 * Captures host envelopes from one connected runtime host instance.
 * Mirrors deterministic single-process command/update delivery expectations in
 * `ref/micropolis/src/sim/w_sim.c`.
 */
function connectAndCapture(host: SimCoreEnvelopeHost): {
  envelopes: HostEnvelope[];
  send: (envelope: Parameters<ReturnType<SimCoreEnvelopeHost['connect']>['send']>[0]) => void;
  disconnect: () => void;
} {
  const envelopes: HostEnvelope[] = [];
  const connection = host.connect((envelope) => {
    envelopes.push(envelope);
  });

  return {
    envelopes,
    send: (envelope) => {
      connection.send(envelope);
    },
    disconnect: () => {
      connection.disconnect();
    },
  };
}

describe('SimCoreEnvelopeHost', () => {
  it('accepts hello and emits a protocol-valid snapshot baseline', () => {
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);

    captured.send({
      kind: 'hello',
      roomId: 'local-room',
      clientId: 'local-client',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });

    expect(captured.envelopes).toHaveLength(2);
    expect(captured.envelopes[0]).toEqual({
      kind: 'hello',
      roomId: 'local-room',
      clientId: 'local-client',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
      accepted: true,
    });

    const snapshot = captured.envelopes[1];
    expect(snapshot).toMatchObject({
      kind: 'snapshot',
      roomId: 'local-room',
      clientId: 'local-client',
      tick: 0,
      serverSeq: 1,
    });

    if (snapshot === undefined || snapshot.kind !== 'snapshot') {
      throw new Error('Expected snapshot envelope');
    }

    const map = snapshot.payload.map;
    if (map === undefined || !('tileWords' in map)) {
      throw new Error('Expected snapshot map payload');
    }

    expect(map.width).toBe(World.WORLD_X);
    expect(map.height).toBe(World.WORLD_Y);
    expect(map.tileWords.length).toBe(World.WORLD_X * World.WORLD_Y);
  });

  it('rejects command envelopes and keeps sequencing monotonic', () => {
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);

    captured.send({
      kind: 'hello',
      roomId: 'room-a',
      clientId: 'client-a',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });

    captured.send({
      kind: 'command',
      roomId: 'room-a',
      clientId: 'client-a',
      commandId: 'cmd-1',
      command: {
        kind: 'tool',
        tool: 'road',
        x: 8,
        y: 8,
      },
    });

    const reject = captured.envelopes[2];
    expect(reject).toEqual({
      kind: 'reject',
      roomId: 'room-a',
      clientId: 'client-a',
      tick: 1,
      serverSeq: 2,
      commandId: 'cmd-1',
      reason: 'invalid-command',
    });
  });

  it('serves explicit snapshot requests and stops emitting after disconnect', () => {
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);

    captured.send({
      kind: 'hello',
      roomId: 'room-b',
      clientId: 'client-b',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });
    captured.send({
      kind: 'request_snapshot',
      roomId: 'room-b',
      clientId: 'client-b',
      fromServerSeq: 0,
      reason: 'manual',
    });
    expect(captured.envelopes).toHaveLength(3);
    expect(captured.envelopes[2]).toMatchObject({
      kind: 'snapshot',
      serverSeq: 2,
      tick: 0,
    });

    captured.disconnect();
    captured.send({
      kind: 'request_snapshot',
      roomId: 'room-b',
      clientId: 'client-b',
      fromServerSeq: 2,
      reason: 'manual',
    });

    expect(captured.envelopes).toHaveLength(3);
  });
});
