import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { World } from '../../../../../packages/sim-core/src/index.ts';
import { type HostEnvelope } from './protocol.ts';
import { SimCoreEnvelopeHost } from './sim-core-envelope-host.ts';

const SIM_CORE_ENVELOPE_HOST_SOURCE_URL = new URL('./sim-core-envelope-host.ts', import.meta.url);

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
  it('does not include demo synthetic tile bootstrap or demo placement dependencies', () => {
    const sourceText = readFileSync(SIM_CORE_ENVELOPE_HOST_SOURCE_URL, 'utf8');

    expect(sourceText).not.toContain('buildInitialDemoMapTiles');
    expect(sourceText).not.toContain('applyDemoToolCommand');
    expect(sourceText).not.toContain('applyDemoWireToolCommand');
    expect(sourceText).not.toContain('canPlaceDemoZoneOnTile');
    expect(sourceText).not.toContain('collectDemoWireFixupCoordinates');
    expect(sourceText).not.toContain('fixDemoWireTileAt');
    expect(sourceText).not.toContain('./demo-map-host.ts');
  });

  it('accepts createPlayableRuntimeHost compatibility options while call sites migrate', () => {
    const scenarioResourceLoader = vi.fn((_fileName: string) => new Uint8Array([1, 2, 3]));
    const host = new SimCoreEnvelopeHost({
      enableAmbientTicks: false,
      patchIntervalMs: 10,
      seedRealtimeDemoObject: false,
      scenarioResourceLoader,
    });
    const captured = connectAndCapture(host);

    captured.send({
      kind: 'hello',
      roomId: 'compat-room',
      clientId: 'compat-client',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });

    expect(captured.envelopes).toHaveLength(2);
    expect(captured.envelopes[0]).toEqual({
      kind: 'hello',
      roomId: 'compat-room',
      clientId: 'compat-client',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
      accepted: true,
    });
    expect(captured.envelopes[1]).toMatchObject({
      kind: 'snapshot',
      roomId: 'compat-room',
      clientId: 'compat-client',
      tick: 0,
      serverSeq: 1,
    });
    expect(scenarioResourceLoader).not.toHaveBeenCalled();
  });

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

  it('serves protocol-valid ack/patch for query and reject for unsupported commands', () => {
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
      commandId: 'cmd-query',
      command: {
        kind: 'tool',
        tool: 'query',
        x: 8,
        y: 8,
      },
    });
    captured.send({
      kind: 'command',
      roomId: 'room-a',
      clientId: 'client-a',
      commandId: 'cmd-road',
      command: {
        kind: 'tool',
        tool: 'road',
        x: 8,
        y: 8,
      },
    });

    // Mirrors C command/update envelope ordering intent from `w_sim.c` + `w_update.c`:
    // command settlement is sequenced before same-tick update projection.
    expect(captured.envelopes[2]).toEqual({
      kind: 'ack',
      roomId: 'room-a',
      clientId: 'client-a',
      tick: 1,
      serverSeq: 2,
      commandId: 'cmd-query',
    });
    expect(captured.envelopes[3]).toEqual({
      kind: 'patch',
      roomId: 'room-a',
      clientId: 'client-a',
      tick: 1,
      serverSeq: 3,
      payload: {},
    });

    const reject = captured.envelopes[4];
    expect(reject).toEqual({
      kind: 'reject',
      roomId: 'room-a',
      clientId: 'client-a',
      tick: 2,
      serverSeq: 4,
      commandId: 'cmd-road',
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
