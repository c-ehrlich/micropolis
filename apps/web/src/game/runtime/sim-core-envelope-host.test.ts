import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { Tile, World } from '../../../../../packages/sim-core/src/index.ts';
import { type HostEnvelope, PLAYABLE_TOOL_SPECS } from './protocol.ts';
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

  it('routes tool commands and sim-control commands through authoritative command semantics', () => {
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
      commandId: 'cmd-query-oob',
      command: {
        kind: 'tool',
        tool: 'query',
        x: -1,
        y: 8,
      },
    });
    captured.send({
      kind: 'command',
      roomId: 'room-a',
      clientId: 'client-a',
      commandId: 'cmd-pause',
      command: {
        kind: 'sim-control',
        control: 'pause',
      },
    });
    captured.send({
      kind: 'command',
      roomId: 'room-a',
      clientId: 'client-a',
      commandId: 'cmd-set-speed-paused',
      command: {
        kind: 'sim-control',
        control: 'set-speed',
        speed: 2,
      },
    });
    captured.send({
      kind: 'command',
      roomId: 'room-a',
      clientId: 'client-a',
      commandId: 'cmd-play',
      command: {
        kind: 'sim-control',
        control: 'play',
      },
    });
    captured.send({
      kind: 'command',
      roomId: 'room-a',
      clientId: 'client-a',
      commandId: 'cmd-new-city',
      command: {
        kind: 'city-lifecycle',
        action: 'new-city',
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

    expect(captured.envelopes[4]).toEqual({
      kind: 'reject',
      roomId: 'room-a',
      clientId: 'client-a',
      tick: 2,
      serverSeq: 4,
      commandId: 'cmd-query-oob',
      reason: 'out-of-bounds',
    });

    expect(captured.envelopes[5]).toEqual({
      kind: 'ack',
      roomId: 'room-a',
      clientId: 'client-a',
      tick: 3,
      serverSeq: 5,
      commandId: 'cmd-pause',
    });
    expect(captured.envelopes[6]).toEqual({
      kind: 'patch',
      roomId: 'room-a',
      clientId: 'client-a',
      tick: 3,
      serverSeq: 6,
      payload: {},
    });
    expect(captured.envelopes[7]).toEqual({
      kind: 'ack',
      roomId: 'room-a',
      clientId: 'client-a',
      tick: 4,
      serverSeq: 7,
      commandId: 'cmd-set-speed-paused',
    });
    expect(captured.envelopes[8]).toEqual({
      kind: 'patch',
      roomId: 'room-a',
      clientId: 'client-a',
      tick: 4,
      serverSeq: 8,
      payload: {},
    });
    expect(captured.envelopes[9]).toEqual({
      kind: 'ack',
      roomId: 'room-a',
      clientId: 'client-a',
      tick: 5,
      serverSeq: 9,
      commandId: 'cmd-play',
    });
    expect(captured.envelopes[10]).toEqual({
      kind: 'patch',
      roomId: 'room-a',
      clientId: 'client-a',
      tick: 5,
      serverSeq: 10,
      payload: {},
    });
    expect(captured.envelopes[11]).toEqual({
      kind: 'reject',
      roomId: 'room-a',
      clientId: 'client-a',
      tick: 6,
      serverSeq: 11,
      commandId: 'cmd-new-city',
      reason: 'invalid-command',
    });
  });

  it('applies C-equivalent pause/play/set-speed transitions in authoritative sim state', () => {
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);
    const hostInternals = host as unknown as {
      authorityState: {
        simState: {
          SimSpeed: number;
          SimMetaSpeed: number;
        };
      };
      simPaused: boolean;
      simPausedSpeed: number;
    };

    captured.send({
      kind: 'hello',
      roomId: 'room-speed-state',
      clientId: 'client-speed-state',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });

    // Source of magic numbers:
    // - `setSpeed(short)` clamps playable speed into `0..3` in `ref/micropolis/src/sim/w_util.c`.
    // - default `SimSpeed` starts at `3` in sim-core (`createSimState` parity baseline).
    expect(hostInternals.authorityState.simState.SimSpeed).toBe(3);
    expect(hostInternals.authorityState.simState.SimMetaSpeed).toBe(3);
    expect(hostInternals.simPaused).toBe(false);

    captured.send({
      kind: 'command',
      roomId: 'room-speed-state',
      clientId: 'client-speed-state',
      commandId: 'cmd-speed-pause',
      command: {
        kind: 'sim-control',
        control: 'pause',
      },
    });
    expect(hostInternals.authorityState.simState.SimSpeed).toBe(0);
    expect(hostInternals.authorityState.simState.SimMetaSpeed).toBe(0);
    expect(hostInternals.simPaused).toBe(true);
    expect(hostInternals.simPausedSpeed).toBe(3);

    captured.send({
      kind: 'command',
      roomId: 'room-speed-state',
      clientId: 'client-speed-state',
      commandId: 'cmd-speed-set-while-paused',
      command: {
        kind: 'sim-control',
        control: 'set-speed',
        speed: 2,
      },
    });
    expect(hostInternals.authorityState.simState.SimSpeed).toBe(0);
    expect(hostInternals.authorityState.simState.SimMetaSpeed).toBe(2);
    expect(hostInternals.simPaused).toBe(true);
    expect(hostInternals.simPausedSpeed).toBe(2);

    captured.send({
      kind: 'command',
      roomId: 'room-speed-state',
      clientId: 'client-speed-state',
      commandId: 'cmd-speed-play',
      command: {
        kind: 'sim-control',
        control: 'play',
      },
    });
    expect(hostInternals.authorityState.simState.SimSpeed).toBe(2);
    expect(hostInternals.authorityState.simState.SimMetaSpeed).toBe(2);
    expect(hostInternals.simPaused).toBe(false);
    expect(hostInternals.simPausedSpeed).toBe(2);
  });

  it('supports every playable tool currently exposed by route "/"', () => {
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);

    captured.send({
      kind: 'hello',
      roomId: 'room-tools',
      clientId: 'client-tools',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });

    const toolRejectReasons = new Set(['out-of-bounds', 'no-funds', 'invalid-placement']);
    for (const [index, spec] of PLAYABLE_TOOL_SPECS.entries()) {
      const commandId = `cmd-tool-${spec.tool}`;
      const startEnvelopeCount = captured.envelopes.length;
      captured.send({
        kind: 'command',
        roomId: 'room-tools',
        clientId: 'client-tools',
        commandId,
        command: {
          kind: 'tool',
          tool: spec.tool,
          x: 10 + index * 6,
          y: 10 + Math.trunc(index / 4) * 6,
        },
      });

      const newEnvelopes = captured.envelopes.slice(startEnvelopeCount);
      expect(newEnvelopes.length).toBeGreaterThan(0);

      const settlement = newEnvelopes[0];
      if (settlement === undefined) {
        throw new Error(`missing settlement for ${spec.tool}`);
      }

      if (settlement.kind === 'ack') {
        expect(settlement.commandId).toBe(commandId);
        expect(newEnvelopes[1]).toMatchObject({
          kind: 'patch',
          roomId: 'room-tools',
          clientId: 'client-tools',
          tick: settlement.tick,
          serverSeq: settlement.serverSeq + 1,
          payload: {},
        });
        continue;
      }

      expect(settlement.kind).toBe('reject');
      if (settlement.kind !== 'reject') {
        continue;
      }

      expect(settlement.commandId).toBe(commandId);
      expect(settlement.reason).not.toBe('invalid-command');
      expect(toolRejectReasons.has(settlement.reason)).toBe(true);
    }
  });

  it('treats SimState.TotalFunds as canonical before tool evaluation', () => {
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);
    const hostInternals = host as unknown as {
      authorityState: {
        simState: {
          TotalFunds: number;
        };
        toolContext: {
          funds: number;
        };
      };
    };
    const authorityState = hostInternals.authorityState;

    // `CostOf[road_tool]` is 10 in `ref/micropolis/src/sim/w_tool.c`;
    // with canonical funds forced to 0 this must reject as no-funds.
    authorityState.simState.TotalFunds = 0;
    authorityState.toolContext.funds = 20_000;

    captured.send({
      kind: 'hello',
      roomId: 'room-funds-sync',
      clientId: 'client-funds-sync',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });
    captured.send({
      kind: 'command',
      roomId: 'room-funds-sync',
      clientId: 'client-funds-sync',
      commandId: 'cmd-road-no-funds',
      command: {
        kind: 'tool',
        tool: 'road',
        x: 12,
        y: 12,
      },
    });

    const reject = captured.envelopes[2];
    expect(reject).toEqual({
      kind: 'reject',
      roomId: 'room-funds-sync',
      clientId: 'client-funds-sync',
      tick: 1,
      serverSeq: 2,
      commandId: 'cmd-road-no-funds',
      reason: 'no-funds',
    });
    expect(authorityState.simState.TotalFunds).toBe(0);
    expect(authorityState.toolContext.funds).toBe(0);
  });

  it('synchronizes tool-spend funds back into SimState.TotalFunds after evaluation', () => {
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);
    const hostInternals = host as unknown as {
      authorityState: {
        simState: {
          TotalFunds: number;
        };
        store: {
          beginTick(): void;
          commitTick(): void;
          getLayer(layer: 'map'): Uint16Array | unknown;
        };
        toolContext: {
          funds: number;
        };
      };
    };
    const authorityState = hostInternals.authorityState;
    const x = 20;
    const y = 20;

    authorityState.store.beginTick();
    try {
      const mapLayer = authorityState.store.getLayer('map');
      if (!(mapLayer instanceof Uint16Array)) {
        throw new Error('expected map layer Uint16Array');
      }
      mapLayer[x * World.WORLD_Y + y] = Tile.DIRT;
    } finally {
      authorityState.store.commitTick();
    }

    authorityState.simState.TotalFunds = 100;
    authorityState.toolContext.funds = 0;

    captured.send({
      kind: 'hello',
      roomId: 'room-funds-spend',
      clientId: 'client-funds-spend',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });
    captured.send({
      kind: 'command',
      roomId: 'room-funds-spend',
      clientId: 'client-funds-spend',
      commandId: 'cmd-road-spend',
      command: {
        kind: 'tool',
        tool: 'road',
        x,
        y,
      },
    });

    // `CostOf[road_tool]` is 10 in `ref/micropolis/src/sim/w_tool.c`.
    expect(captured.envelopes[2]).toEqual({
      kind: 'ack',
      roomId: 'room-funds-spend',
      clientId: 'client-funds-spend',
      tick: 1,
      serverSeq: 2,
      commandId: 'cmd-road-spend',
    });
    expect(captured.envelopes[3]).toEqual({
      kind: 'patch',
      roomId: 'room-funds-spend',
      clientId: 'client-funds-spend',
      tick: 1,
      serverSeq: 3,
      payload: {},
    });
    expect(authorityState.simState.TotalFunds).toBe(90);
    expect(authorityState.toolContext.funds).toBe(90);
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
        kind: 'sim-control',
        control: 'pause',
      },
    });
    secondSession.send({
      kind: 'request_snapshot',
      roomId: 'room-second',
      clientId: 'client-second',
      fromServerSeq: 3,
      reason: 'manual',
    });
    expect(secondSessionEnvelopes).toHaveLength(5);
    expect(secondSessionEnvelopes[2]).toEqual({
      kind: 'ack',
      roomId: 'room-second',
      clientId: 'client-second',
      tick: 1,
      serverSeq: 3,
      commandId: 'cmd-active',
    });
    expect(secondSessionEnvelopes[3]).toEqual({
      kind: 'patch',
      roomId: 'room-second',
      clientId: 'client-second',
      tick: 1,
      serverSeq: 4,
      payload: {},
    });
    expect(secondSessionEnvelopes[4]).toMatchObject({
      kind: 'snapshot',
      roomId: 'room-second',
      clientId: 'client-second',
      tick: 1,
      serverSeq: 5,
    });

    secondSession.disconnect();
    secondSession.send({
      kind: 'request_snapshot',
      roomId: 'room-second',
      clientId: 'client-second',
      fromServerSeq: 4,
      reason: 'manual',
    });
    expect(secondSessionEnvelopes).toHaveLength(5);
  });
});
