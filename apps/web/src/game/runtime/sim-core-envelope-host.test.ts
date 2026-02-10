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
  it('accepts hello and emits a protocol-valid snapshot backed by authoritative sim-core state', () => {
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

    const authorityState = (
      host as unknown as {
        authorityState: {
          store: {
            snapshot(layer: 'map'): Uint16Array | unknown;
          };
        };
      }
    ).authorityState;
    const authoritativeMapLayer = authorityState.store.snapshot('map');
    if (!(authoritativeMapLayer instanceof Uint16Array)) {
      throw new Error('Expected authoritative map layer snapshot to be Uint16Array');
    }
    if (!(map.tileWords instanceof Uint16Array)) {
      throw new Error('Expected snapshot map tileWords to be Uint16Array');
    }

    expect(map.tileWords).not.toBe(authoritativeMapLayer);
    expect(map.tileWords).toEqual(authoritativeMapLayer);
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

  it('routes hello, command, request_snapshot, and disconnect through one active session lifecycle', () => {
    const host = new SimCoreEnvelopeHost();
    const firstSessionEnvelopes: HostEnvelope[] = [];
    const firstSession = host.connect((envelope) => {
      firstSessionEnvelopes.push(envelope);
    });
    firstSession.send({
      kind: 'hello',
      roomId: 'room-first',
      clientId: 'client-first',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });
    expect(firstSessionEnvelopes).toHaveLength(2);

    const secondSessionEnvelopes: HostEnvelope[] = [];
    const secondSession = host.connect((envelope) => {
      secondSessionEnvelopes.push(envelope);
    });

    firstSession.send({
      kind: 'request_snapshot',
      roomId: 'room-first',
      clientId: 'client-first',
      fromServerSeq: 1,
      reason: 'manual',
    });
    firstSession.send({
      kind: 'command',
      roomId: 'room-first',
      clientId: 'client-first',
      commandId: 'cmd-stale',
      command: {
        kind: 'tool',
        tool: 'road',
        x: 12,
        y: 12,
      },
    });
    firstSession.disconnect();

    secondSession.send({
      kind: 'command',
      roomId: 'room-second',
      clientId: 'client-second',
      commandId: 'cmd-before-hello',
      command: {
        kind: 'tool',
        tool: 'road',
        x: 4,
        y: 4,
      },
    });
    secondSession.send({
      kind: 'request_snapshot',
      roomId: 'room-second',
      clientId: 'client-second',
      fromServerSeq: 1,
      reason: 'manual',
    });
    expect(secondSessionEnvelopes).toHaveLength(0);

    secondSession.send({
      kind: 'hello',
      roomId: 'room-second',
      clientId: 'client-second',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });
    expect(secondSessionEnvelopes).toHaveLength(2);
    expect(secondSessionEnvelopes[1]).toMatchObject({
      kind: 'snapshot',
      roomId: 'room-second',
      clientId: 'client-second',
      tick: 0,
      serverSeq: 2,
    });

    secondSession.send({
      kind: 'command',
      roomId: 'room-second',
      clientId: 'client-second',
      commandId: 'cmd-active',
      command: {
        kind: 'tool',
        tool: 'road',
        x: 4,
        y: 4,
      },
    });
    secondSession.send({
      kind: 'request_snapshot',
      roomId: 'room-second',
      clientId: 'client-second',
      fromServerSeq: 3,
      reason: 'manual',
    });
    expect(secondSessionEnvelopes).toHaveLength(4);
    expect(secondSessionEnvelopes[2]).toEqual({
      kind: 'reject',
      roomId: 'room-second',
      clientId: 'client-second',
      tick: 1,
      serverSeq: 3,
      commandId: 'cmd-active',
      reason: 'invalid-command',
    });
    expect(secondSessionEnvelopes[3]).toMatchObject({
      kind: 'snapshot',
      roomId: 'room-second',
      clientId: 'client-second',
      tick: 1,
      serverSeq: 4,
    });

    secondSession.disconnect();
    secondSession.send({
      kind: 'request_snapshot',
      roomId: 'room-second',
      clientId: 'client-second',
      fromServerSeq: 4,
      reason: 'manual',
    });
    expect(secondSessionEnvelopes).toHaveLength(4);
  });
});
