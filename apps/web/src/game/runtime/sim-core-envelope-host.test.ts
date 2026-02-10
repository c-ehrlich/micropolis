import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  decodeCityFileForMap,
  Tile,
  TileFlag,
  TileMask,
  World,
} from '../../../../../packages/sim-core/src/index.ts';
import { getScenarioDefinition } from '../../../../../packages/sim-io/src/scenarios.ts';
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

/**
 * Reads save-city export bytes from a patch payload.
 * Mirrors `SaveCityAs` byte export delivery from `ref/micropolis/src/sim/s_fileio.c`.
 */
function readSaveCityPayload(payload: unknown): {
  fileName: string;
  cityName: string;
  cityBytes: Uint8Array;
} | null {
  if (payload === null || typeof payload !== 'object') {
    return null;
  }

  const cityIo = (payload as { cityIo?: unknown }).cityIo;
  if (cityIo === null || typeof cityIo !== 'object') {
    return null;
  }

  const save = (cityIo as { save?: unknown }).save;
  if (save === null || typeof save !== 'object') {
    return null;
  }

  const candidate = save as Partial<{
    fileName: string;
    cityName: string;
    cityBytes: Uint8Array;
  }>;
  if (
    typeof candidate.fileName !== 'string' ||
    typeof candidate.cityName !== 'string' ||
    !(candidate.cityBytes instanceof Uint8Array)
  ) {
    return null;
  }

  return {
    fileName: candidate.fileName,
    cityName: candidate.cityName,
    cityBytes: candidate.cityBytes,
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

  it('routes tool/sim-control/city-lifecycle commands through authoritative command semantics', () => {
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
      kind: 'ack',
      roomId: 'room-a',
      clientId: 'client-a',
      tick: 6,
      serverSeq: 11,
      commandId: 'cmd-new-city',
    });
    expect(captured.envelopes[12]).toMatchObject({
      kind: 'snapshot',
      roomId: 'room-a',
      clientId: 'client-a',
      tick: 6,
      serverSeq: 12,
    });
  });

  it('routes save-city/load-city through sim-io helpers and restores saved state on load', () => {
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
          snapshot(layer: 'map'): Uint16Array | unknown;
          getLayer(layer: 'map'): Uint16Array | unknown;
        };
      };
    };

    captured.send({
      kind: 'hello',
      roomId: 'room-io',
      clientId: 'client-io',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });

    captured.send({
      kind: 'command',
      roomId: 'room-io',
      clientId: 'client-io',
      commandId: 'cmd-save-city',
      command: {
        kind: 'city-io',
        action: 'save-city',
        fileName: 'sim-core-envelope-roundtrip',
      },
    });

    expect(captured.envelopes[2]).toEqual({
      kind: 'ack',
      roomId: 'room-io',
      clientId: 'client-io',
      tick: 1,
      serverSeq: 2,
      commandId: 'cmd-save-city',
    });

    const savePatch = captured.envelopes[3];
    expect(savePatch).toMatchObject({
      kind: 'patch',
      roomId: 'room-io',
      clientId: 'client-io',
      tick: 1,
      serverSeq: 3,
    });
    if (savePatch === undefined || savePatch.kind !== 'patch') {
      throw new Error('expected save-city patch');
    }

    const savePayload = readSaveCityPayload(savePatch.payload);
    if (savePayload === null) {
      throw new Error('expected save-city payload');
    }
    expect(savePayload.fileName).toBe('sim-core-envelope-roundtrip.cty');
    expect(savePayload.cityName).toBe('sim-core-envelope-roundtrip');
    // Magic-number source: classic `.cty` byte size packed by `saveFile` in
    // `ref/micropolis/src/sim/s_fileio.c`.
    expect(savePayload.cityBytes.byteLength).toBe(27120);

    const savedCity = decodeCityFileForMap(savePayload.cityBytes, {
      width: World.WORLD_X,
      height: World.WORLD_Y,
    });
    const restoreX = 10;
    const restoreY = 10;
    const restoreIndex = restoreX * World.WORLD_Y + restoreY;
    const savedTileWord = savedCity.map[restoreIndex];
    if (savedTileWord === undefined) {
      throw new Error(`expected saved map word at index ${restoreIndex}`);
    }
    const changedTileWord = savedTileWord === Tile.DIRT ? Tile.RIVER : Tile.DIRT;
    const savedFunds = hostInternals.authorityState.simState.TotalFunds;

    hostInternals.authorityState.store.beginTick();
    try {
      const mapLayer = hostInternals.authorityState.store.getLayer('map');
      if (!(mapLayer instanceof Uint16Array)) {
        throw new Error('expected map layer Uint16Array');
      }
      mapLayer[restoreIndex] = changedTileWord;
    } finally {
      hostInternals.authorityState.store.commitTick();
    }
    hostInternals.authorityState.simState.TotalFunds = 1;

    captured.send({
      kind: 'command',
      roomId: 'room-io',
      clientId: 'client-io',
      commandId: 'cmd-load-city',
      command: {
        kind: 'city-io',
        action: 'load-city',
        fileName: 'sim-core-envelope-roundtrip.cty',
        cityBytes: savePayload.cityBytes,
      },
    });

    expect(captured.envelopes[4]).toEqual({
      kind: 'ack',
      roomId: 'room-io',
      clientId: 'client-io',
      tick: 2,
      serverSeq: 4,
      commandId: 'cmd-load-city',
    });
    expect(captured.envelopes[5]).toMatchObject({
      kind: 'snapshot',
      roomId: 'room-io',
      clientId: 'client-io',
      tick: 2,
      serverSeq: 5,
    });

    const reloadedMap = hostInternals.authorityState.store.snapshot('map');
    if (!(reloadedMap instanceof Uint16Array)) {
      throw new Error('expected reloaded map layer Uint16Array');
    }
    expect(reloadedMap[restoreIndex]).toBe(savedTileWord);
    expect(hostInternals.authorityState.simState.TotalFunds).toBe(savedFunds);
  });

  it('rejects malformed load-city bytes with invalid-city-file', () => {
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);

    captured.send({
      kind: 'hello',
      roomId: 'room-io-reject',
      clientId: 'client-io-reject',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });

    captured.send({
      kind: 'command',
      roomId: 'room-io-reject',
      clientId: 'client-io-reject',
      commandId: 'cmd-load-bad-city',
      command: {
        kind: 'city-io',
        action: 'load-city',
        fileName: 'broken.cty',
        cityBytes: new Uint8Array([1, 2, 3]),
      },
    });

    expect(captured.envelopes[2]).toEqual({
      kind: 'reject',
      roomId: 'room-io-reject',
      clientId: 'client-io-reject',
      tick: 1,
      serverSeq: 2,
      commandId: 'cmd-load-bad-city',
      reason: 'invalid-city-file',
    });
  });

  it('round-trips save/load/scenario commands deterministically through snapshot replay tail', async () => {
    const scenario = getScenarioDefinition(2);
    const scenarioBytes = new Uint8Array(
      readFileSync(
        new URL(`../../../../../ref/micropolis/res/${scenario.fileName}`, import.meta.url),
      ),
    );
    const host = new SimCoreEnvelopeHost({
      scenarioResourceLoader: async (_fileName: string) => scenarioBytes,
    });
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
          snapshot(layer: 'map'): Uint16Array | unknown;
        };
      };
    };

    captured.send({
      kind: 'hello',
      roomId: 'room-io-scenario-roundtrip',
      clientId: 'client-io-scenario-roundtrip',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });
    captured.send({
      kind: 'command',
      roomId: 'room-io-scenario-roundtrip',
      clientId: 'client-io-scenario-roundtrip',
      commandId: 'cmd-save-roundtrip',
      command: {
        kind: 'city-io',
        action: 'save-city',
        fileName: 'roundtrip-save',
      },
    });

    const savePatch = captured.envelopes.find(
      (envelope): envelope is Extract<HostEnvelope, { kind: 'patch' }> =>
        envelope.kind === 'patch' && readSaveCityPayload(envelope.payload) !== null,
    );
    if (savePatch === undefined) {
      throw new Error('expected save-city patch envelope');
    }
    const savePayload = readSaveCityPayload(savePatch.payload);
    if (savePayload === null) {
      throw new Error('expected save-city patch payload');
    }
    // Magic-number source: `.cty` byte size produced by `saveFile` in
    // `ref/micropolis/src/sim/s_fileio.c`.
    expect(savePayload.cityBytes.byteLength).toBe(27120);

    const savedCity = decodeCityFileForMap(savePayload.cityBytes, {
      width: World.WORLD_X,
      height: World.WORLD_Y,
    });
    const restoreX = 11;
    const restoreY = 11;
    const restoreIndex = restoreX * World.WORLD_Y + restoreY;
    const savedTileWord = savedCity.map[restoreIndex];
    if (savedTileWord === undefined) {
      throw new Error(`expected saved map word at index ${restoreIndex}`);
    }
    const changedTileWord = savedTileWord === Tile.DIRT ? Tile.RIVER : Tile.DIRT;

    hostInternals.authorityState.store.beginTick();
    try {
      const mapLayer = hostInternals.authorityState.store.getLayer('map');
      if (!(mapLayer instanceof Uint16Array)) {
        throw new Error('expected map layer Uint16Array');
      }
      mapLayer[restoreIndex] = changedTileWord;
    } finally {
      hostInternals.authorityState.store.commitTick();
    }
    hostInternals.authorityState.simState.TotalFunds = 1;

    captured.send({
      kind: 'command',
      roomId: 'room-io-scenario-roundtrip',
      clientId: 'client-io-scenario-roundtrip',
      commandId: 'cmd-load-roundtrip',
      command: {
        kind: 'city-io',
        action: 'load-city',
        fileName: savePayload.fileName,
        cityBytes: savePayload.cityBytes,
      },
    });
    captured.send({
      kind: 'command',
      roomId: 'room-io-scenario-roundtrip',
      clientId: 'client-io-scenario-roundtrip',
      commandId: 'cmd-scenario-roundtrip',
      command: {
        kind: 'scenario',
        action: 'load-scenario',
        scenarioId: scenario.id,
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    const scenarioMap = hostInternals.authorityState.store.snapshot('map');
    if (!(scenarioMap instanceof Uint16Array)) {
      throw new Error('expected scenario map snapshot');
    }
    const authoritativeScenarioMap = Uint16Array.from(scenarioMap);

    const requestReplay = () => {
      const startIndex = captured.envelopes.length;
      captured.send({
        kind: 'request_snapshot',
        roomId: 'room-io-scenario-roundtrip',
        clientId: 'client-io-scenario-roundtrip',
        fromServerSeq: savePatch.serverSeq,
        reason: 'manual',
      });
      return captured.envelopes.slice(startIndex);
    };

    const replayOne = requestReplay();
    expect(replayOne).toHaveLength(5);
    expect(replayOne[0]).toMatchObject({
      kind: 'snapshot',
    });
    expect(replayOne[1]).toMatchObject({
      kind: 'ack',
      commandId: 'cmd-load-roundtrip',
    });
    expect(replayOne[2]).toMatchObject({
      kind: 'snapshot',
    });
    expect(replayOne[3]).toMatchObject({
      kind: 'ack',
      commandId: 'cmd-scenario-roundtrip',
    });
    expect(replayOne[4]).toMatchObject({
      kind: 'snapshot',
    });
    let previousReplayTick = 0;
    for (const envelope of replayOne) {
      if (envelope.kind === 'hello') {
        throw new Error('replay response should not include hello envelopes');
      }
      expect(envelope.tick).toBeGreaterThanOrEqual(previousReplayTick);
      previousReplayTick = envelope.tick;
    }

    const replayLoadSnapshot = replayOne[2];
    if (replayLoadSnapshot === undefined || replayLoadSnapshot.kind !== 'snapshot') {
      throw new Error('expected replay load snapshot');
    }
    const replayLoadMap = replayLoadSnapshot.payload.map;
    if (replayLoadMap === undefined || !('tileWords' in replayLoadMap)) {
      throw new Error('expected replay load map payload');
    }
    expect(replayLoadMap.tileWords[restoreIndex]).toBe(savedTileWord);

    const replayScenarioSnapshot = replayOne[4];
    if (replayScenarioSnapshot === undefined || replayScenarioSnapshot.kind !== 'snapshot') {
      throw new Error('expected replay scenario snapshot');
    }
    const replayScenarioMap = replayScenarioSnapshot.payload.map;
    if (replayScenarioMap === undefined || !('tileWords' in replayScenarioMap)) {
      throw new Error('expected replay scenario map payload');
    }
    expect(replayScenarioMap.tileWords).toEqual(authoritativeScenarioMap);

    const replayTwo = requestReplay();
    expect(replayTwo).toHaveLength(5);
    const dropServerSeq = (envelope: HostEnvelope) => {
      if (envelope.kind === 'hello') {
        throw new Error('replay response should not include hello envelopes');
      }
      const { serverSeq: _serverSeq, ...withoutServerSeq } = envelope;
      return withoutServerSeq;
    };
    expect(replayTwo.map(dropServerSeq)).toEqual(replayOne.map(dropServerSeq));
  });

  it('loads scenario bytes asynchronously through loadScenarioLikeC', async () => {
    const scenario = getScenarioDefinition(2);
    const scenarioBytes = new Uint8Array(
      readFileSync(
        new URL(`../../../../../ref/micropolis/res/${scenario.fileName}`, import.meta.url),
      ),
    );
    let resolveScenarioBytes: ((value: Uint8Array) => void) | undefined;
    const pendingScenarioBytes = new Promise<Uint8Array>((resolve) => {
      resolveScenarioBytes = resolve;
    });
    const scenarioResourceLoader = vi.fn((_fileName: string) => pendingScenarioBytes);
    const host = new SimCoreEnvelopeHost({ scenarioResourceLoader });
    const hostInternals = host as unknown as {
      authorityState: {
        store: {
          snapshot(layer: 'map'): Uint16Array | unknown;
        };
        simState: {
          ScenarioID: number;
          CityTime: number;
          TotalFunds: number;
          CityTax: number;
          SimSpeed: number;
          SimMetaSpeed: number;
        };
      };
      cityFileName: string;
      cityName: string;
    };
    const envelopes: HostEnvelope[] = [];
    const authoritativeScenarioStateAtEnvelope: Array<{
      scenarioId: number;
      cityTime: number;
      totalFunds: number;
    }> = [];
    const authoritativeMapAtEnvelope: Uint16Array[] = [];
    const connection = host.connect((envelope) => {
      authoritativeScenarioStateAtEnvelope.push({
        scenarioId: hostInternals.authorityState.simState.ScenarioID,
        cityTime: hostInternals.authorityState.simState.CityTime,
        totalFunds: hostInternals.authorityState.simState.TotalFunds,
      });
      const authoritativeMap = hostInternals.authorityState.store.snapshot('map');
      if (!(authoritativeMap instanceof Uint16Array)) {
        throw new Error('Expected authoritative map layer snapshot to be Uint16Array');
      }
      authoritativeMapAtEnvelope.push(Uint16Array.from(authoritativeMap));
      envelopes.push(envelope);
    });

    connection.send({
      kind: 'hello',
      roomId: 'room-scenario',
      clientId: 'client-scenario',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });
    connection.send({
      kind: 'command',
      roomId: 'room-scenario',
      clientId: 'client-scenario',
      commandId: 'cmd-load-scenario',
      command: {
        kind: 'scenario',
        action: 'load-scenario',
        scenarioId: scenario.id,
      },
    });

    expect(scenarioResourceLoader).toHaveBeenCalledWith(scenario.fileName);
    expect(envelopes).toHaveLength(2);
    expect(envelopes.some((envelope) => envelope.kind === 'ack')).toBe(false);

    const resolve = resolveScenarioBytes;
    if (resolve === undefined) {
      throw new Error('expected scenario loader resolver');
    }
    resolve(scenarioBytes);
    await Promise.resolve();
    await Promise.resolve();

    const scenarioAckIndex = envelopes.findIndex(
      (envelope) => envelope.kind === 'ack' && envelope.commandId === 'cmd-load-scenario',
    );
    expect(scenarioAckIndex).toBe(2);
    expect(authoritativeScenarioStateAtEnvelope[scenarioAckIndex]).toEqual({
      scenarioId: scenario.id,
      cityTime: scenario.startCityTime,
      totalFunds: scenario.startFunds,
    });
    expect(envelopes[scenarioAckIndex]).toEqual({
      kind: 'ack',
      roomId: 'room-scenario',
      clientId: 'client-scenario',
      tick: 1,
      serverSeq: 2,
      commandId: 'cmd-load-scenario',
    });
    const scenarioSnapshotIndex = scenarioAckIndex + 1;
    const scenarioSnapshot = envelopes[scenarioSnapshotIndex];
    expect(scenarioSnapshot).toMatchObject({
      kind: 'snapshot',
      roomId: 'room-scenario',
      clientId: 'client-scenario',
      tick: 1,
      serverSeq: 3,
    });
    if (scenarioSnapshot === undefined || scenarioSnapshot.kind !== 'snapshot') {
      throw new Error('expected scenario snapshot envelope immediately after scenario ack');
    }
    const scenarioSnapshotMap = scenarioSnapshot.payload.map;
    if (scenarioSnapshotMap === undefined || !('tileWords' in scenarioSnapshotMap)) {
      throw new Error('expected scenario snapshot map payload');
    }
    expect(scenarioSnapshotMap.tileWords).toEqual(
      authoritativeMapAtEnvelope[scenarioSnapshotIndex],
    );

    expect(hostInternals.authorityState.simState.ScenarioID).toBe(scenario.id);
    expect(hostInternals.authorityState.simState.CityTime).toBe(scenario.startCityTime);
    expect(hostInternals.authorityState.simState.TotalFunds).toBe(scenario.startFunds);
    // Magic numbers source: `LoadScenario` assigns `CityTax = 7` and calls
    // `setSpeed(3)` in `ref/micropolis/src/sim/s_fileio.c`.
    expect(hostInternals.authorityState.simState.CityTax).toBe(7);
    expect(hostInternals.authorityState.simState.SimSpeed).toBe(3);
    expect(hostInternals.authorityState.simState.SimMetaSpeed).toBe(3);
    expect(hostInternals.cityName).toBe(scenario.name);
    expect(hostInternals.cityFileName).toBe(`${scenario.fileName}.cty`);
  });

  it('rejects scenario load when async scenario bytes are invalid', async () => {
    const host = new SimCoreEnvelopeHost({
      scenarioResourceLoader: async (_fileName: string) => new Uint8Array([1, 2, 3]),
    });
    const captured = connectAndCapture(host);

    captured.send({
      kind: 'hello',
      roomId: 'room-scenario-reject',
      clientId: 'client-scenario-reject',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });
    captured.send({
      kind: 'command',
      roomId: 'room-scenario-reject',
      clientId: 'client-scenario-reject',
      commandId: 'cmd-bad-scenario',
      command: {
        kind: 'scenario',
        action: 'load-scenario',
        scenarioId: 2,
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(
      captured.envelopes.some(
        (envelope) => envelope.kind === 'ack' && envelope.commandId === 'cmd-bad-scenario',
      ),
    ).toBe(false);

    expect(captured.envelopes[2]).toEqual({
      kind: 'reject',
      roomId: 'room-scenario-reject',
      clientId: 'client-scenario-reject',
      tick: 1,
      serverSeq: 2,
      commandId: 'cmd-bad-scenario',
      reason: 'invalid-scenario-file',
    });
  });

  it('rejects scenario load when scenario resource loading fails', async () => {
    const host = new SimCoreEnvelopeHost({
      scenarioResourceLoader: async (_fileName: string) => {
        throw new Error('failed to read scenario bytes');
      },
    });
    const captured = connectAndCapture(host);

    captured.send({
      kind: 'hello',
      roomId: 'room-scenario-load-failure',
      clientId: 'client-scenario-load-failure',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });
    captured.send({
      kind: 'command',
      roomId: 'room-scenario-load-failure',
      clientId: 'client-scenario-load-failure',
      commandId: 'cmd-scenario-load-failure',
      command: {
        kind: 'scenario',
        action: 'load-scenario',
        scenarioId: 2,
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(
      captured.envelopes.some(
        (envelope) => envelope.kind === 'ack' && envelope.commandId === 'cmd-scenario-load-failure',
      ),
    ).toBe(false);

    expect(captured.envelopes[2]).toEqual({
      kind: 'reject',
      roomId: 'room-scenario-load-failure',
      clientId: 'client-scenario-load-failure',
      tick: 1,
      serverSeq: 2,
      commandId: 'cmd-scenario-load-failure',
      reason: 'invalid-scenario-file',
    });
  });

  it('rejects scenario load when scenario id resolution fails before bytes are loaded', async () => {
    const scenarioResourceLoader = vi.fn(async (_fileName: string) => new Uint8Array([1, 2, 3]));
    const host = new SimCoreEnvelopeHost({ scenarioResourceLoader });
    const captured = connectAndCapture(host);

    captured.send({
      kind: 'hello',
      roomId: 'room-scenario-id-reject',
      clientId: 'client-scenario-id-reject',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });
    captured.send({
      kind: 'command',
      roomId: 'room-scenario-id-reject',
      clientId: 'client-scenario-id-reject',
      commandId: 'cmd-scenario-id-reject',
      command: {
        kind: 'scenario',
        action: 'load-scenario',
        scenarioId: Number.NaN,
      },
    });
    await Promise.resolve();

    expect(
      captured.envelopes.some(
        (envelope) => envelope.kind === 'ack' && envelope.commandId === 'cmd-scenario-id-reject',
      ),
    ).toBe(false);

    expect(captured.envelopes.some((envelope) => envelope.kind === 'reject')).toBe(true);
    expect(captured.envelopes[2]).toMatchObject({
      kind: 'reject',
      roomId: 'room-scenario-id-reject',
      clientId: 'client-scenario-id-reject',
      commandId: 'cmd-scenario-id-reject',
      reason: 'invalid-scenario-file',
    });
    expect(scenarioResourceLoader).not.toHaveBeenCalled();
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

  it('acks wire placement on straight road tiles and applies the C crossing tile', () => {
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);
    const x = 22;
    const y = 22;
    const tileIndex = x * World.WORLD_Y + y;
    const hostInternals = host as unknown as {
      authorityState: {
        store: {
          beginTick(): void;
          commitTick(): void;
          getLayer(layer: 'map'): Uint16Array | unknown;
          snapshot(layer: 'map'): Uint16Array | unknown;
        };
      };
    };

    hostInternals.authorityState.store.beginTick();
    try {
      const mapLayer = hostInternals.authorityState.store.getLayer('map');
      if (!(mapLayer instanceof Uint16Array)) {
        throw new Error('expected map layer Uint16Array');
      }
      mapLayer[tileIndex] = Tile.ROADS | TileFlag.BULLBIT | TileFlag.BURNBIT;
    } finally {
      hostInternals.authorityState.store.commitTick();
    }

    captured.send({
      kind: 'hello',
      roomId: 'room-wire-on-road',
      clientId: 'client-wire-on-road',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });
    captured.send({
      kind: 'command',
      roomId: 'room-wire-on-road',
      clientId: 'client-wire-on-road',
      commandId: 'cmd-wire-on-road',
      command: {
        kind: 'tool',
        tool: 'wire',
        x,
        y,
      },
    });

    expect(captured.envelopes[2]).toEqual({
      kind: 'ack',
      roomId: 'room-wire-on-road',
      clientId: 'client-wire-on-road',
      tick: 1,
      serverSeq: 2,
      commandId: 'cmd-wire-on-road',
    });
    expect(captured.envelopes[3]).toEqual({
      kind: 'patch',
      roomId: 'room-wire-on-road',
      clientId: 'client-wire-on-road',
      tick: 1,
      serverSeq: 3,
      payload: {},
    });

    const mapAfter = hostInternals.authorityState.store.snapshot('map');
    if (!(mapAfter instanceof Uint16Array)) {
      throw new Error('expected authoritative map layer snapshot to be Uint16Array');
    }
    const tileAfter = mapAfter[tileIndex];
    if (tileAfter === undefined) {
      throw new Error(`expected map tile at index ${tileIndex}`);
    }
    // `_LayWire` in `ref/micropolis/src/sim/w_con.c` maps road tile 66 (`ROADS`)
    // to 77 (`HROADPOWER`) for wire-on-road placement.
    expect(tileAfter & TileMask.LOMASK).toBe(Tile.HROADPOWER);
    expect(tileAfter & TileFlag.CONDBIT).not.toBe(0);
  });

  it('rejects wire placement on unsupported road shapes while preserving funds', () => {
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);
    const x = 24;
    const y = 24;
    const tileIndex = x * World.WORLD_Y + y;
    const hostInternals = host as unknown as {
      authorityState: {
        simState: {
          TotalFunds: number;
        };
        store: {
          beginTick(): void;
          commitTick(): void;
          getLayer(layer: 'map'): Uint16Array | unknown;
          snapshot(layer: 'map'): Uint16Array | unknown;
        };
      };
    };

    hostInternals.authorityState.store.beginTick();
    try {
      const mapLayer = hostInternals.authorityState.store.getLayer('map');
      if (!(mapLayer instanceof Uint16Array)) {
        throw new Error('expected map layer Uint16Array');
      }
      mapLayer[tileIndex] = Tile.INTERSECTION | TileFlag.BULLBIT | TileFlag.BURNBIT;
    } finally {
      hostInternals.authorityState.store.commitTick();
    }

    const fundsBefore = hostInternals.authorityState.simState.TotalFunds;
    captured.send({
      kind: 'hello',
      roomId: 'room-wire-road-reject',
      clientId: 'client-wire-road-reject',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });
    captured.send({
      kind: 'command',
      roomId: 'room-wire-road-reject',
      clientId: 'client-wire-road-reject',
      commandId: 'cmd-wire-road-reject',
      command: {
        kind: 'tool',
        tool: 'wire',
        x,
        y,
      },
    });

    // `_LayWire` in `ref/micropolis/src/sim/w_con.c` accepts only road base
    // tiles 66/67 for wire-on-road; other road shapes return 0, and `DoTool`
    // in `ref/micropolis/src/sim/w_tool.c` treats that as non-success.
    expect(captured.envelopes[2]).toEqual({
      kind: 'reject',
      roomId: 'room-wire-road-reject',
      clientId: 'client-wire-road-reject',
      tick: 1,
      serverSeq: 2,
      commandId: 'cmd-wire-road-reject',
      reason: 'invalid-placement',
    });

    const mapAfter = hostInternals.authorityState.store.snapshot('map');
    if (!(mapAfter instanceof Uint16Array)) {
      throw new Error('expected authoritative map layer snapshot to be Uint16Array');
    }
    const tileAfter = mapAfter[tileIndex];
    if (tileAfter === undefined) {
      throw new Error(`expected map tile at index ${tileIndex}`);
    }
    // `ConnecTile` in `ref/micropolis/src/sim/w_con.c` still calls `_FixZone`
    // after `_LayWire` returns 0; for an isolated unsupported road shape this
    // normalizes via `_RoadTable[0]` to base road tile 66 (`ROADS`).
    expect(tileAfter & TileMask.LOMASK).toBe(Tile.ROADS);
    expect(hostInternals.authorityState.simState.TotalFunds).toBe(fundsBefore);
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
    expect(secondSessionEnvelopes).toHaveLength(6);
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
    expect(secondSessionEnvelopes[5]).toEqual({
      kind: 'patch',
      roomId: 'room-second',
      clientId: 'client-second',
      tick: 1,
      serverSeq: 6,
      payload: {},
    });

    secondSession.disconnect();
    secondSession.send({
      kind: 'request_snapshot',
      roomId: 'room-second',
      clientId: 'client-second',
      fromServerSeq: 4,
      reason: 'manual',
    });
    expect(secondSessionEnvelopes).toHaveLength(6);
  });

  it('clamps request_snapshot replay cursor to valid range before baseline + tail replay', () => {
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);

    captured.send({
      kind: 'hello',
      roomId: 'room-snapshot-cursor-clamp',
      clientId: 'client-snapshot-cursor-clamp',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });
    captured.send({
      kind: 'command',
      roomId: 'room-snapshot-cursor-clamp',
      clientId: 'client-snapshot-cursor-clamp',
      commandId: 'cmd-pause',
      command: {
        kind: 'sim-control',
        control: 'pause',
      },
    });

    captured.send({
      kind: 'request_snapshot',
      roomId: 'room-snapshot-cursor-clamp',
      clientId: 'client-snapshot-cursor-clamp',
      fromServerSeq: 99,
      reason: 'manual',
    });

    expect(captured.envelopes[4]).toMatchObject({
      kind: 'snapshot',
      roomId: 'room-snapshot-cursor-clamp',
      clientId: 'client-snapshot-cursor-clamp',
      tick: 1,
      serverSeq: 4,
    });
    expect(captured.envelopes).toHaveLength(5);

    captured.send({
      kind: 'request_snapshot',
      roomId: 'room-snapshot-cursor-clamp',
      clientId: 'client-snapshot-cursor-clamp',
      fromServerSeq: -20,
      reason: 'manual',
    });

    expect(captured.envelopes[5]).toMatchObject({
      kind: 'snapshot',
      roomId: 'room-snapshot-cursor-clamp',
      clientId: 'client-snapshot-cursor-clamp',
      tick: 1,
      serverSeq: 5,
    });
    expect(captured.envelopes[6]).toEqual({
      kind: 'ack',
      roomId: 'room-snapshot-cursor-clamp',
      clientId: 'client-snapshot-cursor-clamp',
      tick: 1,
      serverSeq: 6,
      commandId: 'cmd-pause',
    });
    expect(captured.envelopes[7]).toEqual({
      kind: 'patch',
      roomId: 'room-snapshot-cursor-clamp',
      clientId: 'client-snapshot-cursor-clamp',
      tick: 1,
      serverSeq: 7,
      payload: {},
    });
  });

  it('emits deterministic snapshot baseline plus ordered replay tail for request_snapshot', () => {
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);

    captured.send({
      kind: 'hello',
      roomId: 'room-snapshot-replay-tail',
      clientId: 'client-snapshot-replay-tail',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });
    captured.send({
      kind: 'command',
      roomId: 'room-snapshot-replay-tail',
      clientId: 'client-snapshot-replay-tail',
      commandId: 'cmd-pause',
      command: {
        kind: 'sim-control',
        control: 'pause',
      },
    });
    captured.send({
      kind: 'command',
      roomId: 'room-snapshot-replay-tail',
      clientId: 'client-snapshot-replay-tail',
      commandId: 'cmd-play',
      command: {
        kind: 'sim-control',
        control: 'play',
      },
    });

    captured.send({
      kind: 'request_snapshot',
      roomId: 'room-snapshot-replay-tail',
      clientId: 'client-snapshot-replay-tail',
      fromServerSeq: 3,
      reason: 'sequence-gap',
    });

    expect(captured.envelopes[6]).toMatchObject({
      kind: 'snapshot',
      roomId: 'room-snapshot-replay-tail',
      clientId: 'client-snapshot-replay-tail',
      tick: 2,
      serverSeq: 6,
    });
    expect(captured.envelopes[7]).toEqual({
      kind: 'ack',
      roomId: 'room-snapshot-replay-tail',
      clientId: 'client-snapshot-replay-tail',
      tick: 2,
      serverSeq: 7,
      commandId: 'cmd-play',
    });
    expect(captured.envelopes[8]).toEqual({
      kind: 'patch',
      roomId: 'room-snapshot-replay-tail',
      clientId: 'client-snapshot-replay-tail',
      tick: 2,
      serverSeq: 8,
      payload: {},
    });
  });

  it('keeps serverSeq strictly increasing across sync and async sequenced envelope emission', async () => {
    const scenario = getScenarioDefinition(2);
    let resolveScenarioBytes: ((value: Uint8Array) => void) | undefined;
    const pendingScenarioBytes = new Promise<Uint8Array>((resolve) => {
      resolveScenarioBytes = resolve;
    });
    const scenarioResourceLoader = vi.fn((_fileName: string) => pendingScenarioBytes);
    const host = new SimCoreEnvelopeHost({ scenarioResourceLoader });
    const captured = connectAndCapture(host);

    captured.send({
      kind: 'hello',
      roomId: 'room-seq-monotonic',
      clientId: 'client-seq-monotonic',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });

    captured.send({
      kind: 'command',
      roomId: 'room-seq-monotonic',
      clientId: 'client-seq-monotonic',
      commandId: 'cmd-scenario-pending',
      command: {
        kind: 'scenario',
        action: 'load-scenario',
        scenarioId: scenario.id,
      },
    });
    captured.send({
      kind: 'command',
      roomId: 'room-seq-monotonic',
      clientId: 'client-seq-monotonic',
      commandId: 'cmd-pause-while-scenario-pending',
      command: {
        kind: 'sim-control',
        control: 'pause',
      },
    });
    captured.send({
      kind: 'request_snapshot',
      roomId: 'room-seq-monotonic',
      clientId: 'client-seq-monotonic',
      fromServerSeq: 0,
      reason: 'manual',
    });

    const resolve = resolveScenarioBytes;
    if (resolve === undefined) {
      throw new Error('expected scenario loader resolver');
    }
    resolve(
      new Uint8Array(
        readFileSync(
          new URL(`../../../../../ref/micropolis/res/${scenario.fileName}`, import.meta.url),
        ),
      ),
    );
    await Promise.resolve();
    await Promise.resolve();

    const sequencedEnvelopes = captured.envelopes.filter(
      (envelope): envelope is Exclude<HostEnvelope, { kind: 'hello' }> => envelope.kind !== 'hello',
    );
    expect(sequencedEnvelopes.length).toBeGreaterThan(0);

    let previousServerSeq = 0;
    for (const envelope of sequencedEnvelopes) {
      expect(envelope.serverSeq).toBeGreaterThan(previousServerSeq);
      previousServerSeq = envelope.serverSeq;
    }
  });

  it('keeps tick non-regressing across async settlement and internal tick cursor regression', async () => {
    const scenario = getScenarioDefinition(2);
    let resolveScenarioBytes: ((value: Uint8Array) => void) | undefined;
    const pendingScenarioBytes = new Promise<Uint8Array>((resolve) => {
      resolveScenarioBytes = resolve;
    });
    const scenarioResourceLoader = vi.fn((_fileName: string) => pendingScenarioBytes);
    const host = new SimCoreEnvelopeHost({ scenarioResourceLoader });
    const captured = connectAndCapture(host);

    captured.send({
      kind: 'hello',
      roomId: 'room-tick-monotonic',
      clientId: 'client-tick-monotonic',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });

    captured.send({
      kind: 'command',
      roomId: 'room-tick-monotonic',
      clientId: 'client-tick-monotonic',
      commandId: 'cmd-scenario-pending',
      command: {
        kind: 'scenario',
        action: 'load-scenario',
        scenarioId: scenario.id,
      },
    });
    captured.send({
      kind: 'command',
      roomId: 'room-tick-monotonic',
      clientId: 'client-tick-monotonic',
      commandId: 'cmd-pause-before-regression',
      command: {
        kind: 'sim-control',
        control: 'pause',
      },
    });

    const internalHost = host as unknown as {
      tick: number;
    };
    internalHost.tick = 0;

    captured.send({
      kind: 'command',
      roomId: 'room-tick-monotonic',
      clientId: 'client-tick-monotonic',
      commandId: 'cmd-play-after-regression',
      command: {
        kind: 'sim-control',
        control: 'play',
      },
    });
    captured.send({
      kind: 'request_snapshot',
      roomId: 'room-tick-monotonic',
      clientId: 'client-tick-monotonic',
      fromServerSeq: 0,
      reason: 'manual',
    });

    const resolve = resolveScenarioBytes;
    if (resolve === undefined) {
      throw new Error('expected scenario loader resolver');
    }
    resolve(
      new Uint8Array(
        readFileSync(
          new URL(`../../../../../ref/micropolis/res/${scenario.fileName}`, import.meta.url),
        ),
      ),
    );
    await Promise.resolve();
    await Promise.resolve();

    const sequencedEnvelopes = captured.envelopes.filter(
      (envelope): envelope is Exclude<HostEnvelope, { kind: 'hello' }> => envelope.kind !== 'hello',
    );
    expect(sequencedEnvelopes.length).toBeGreaterThan(0);

    let previousTick = 0;
    for (const envelope of sequencedEnvelopes) {
      expect(envelope.tick).toBeGreaterThanOrEqual(previousTick);
      previousTick = envelope.tick;
    }

    const playAck = captured.envelopes.find(
      (envelope): envelope is Extract<HostEnvelope, { kind: 'ack' }> =>
        envelope.kind === 'ack' && envelope.commandId === 'cmd-play-after-regression',
    );
    const scenarioAck = captured.envelopes.find(
      (envelope): envelope is Extract<HostEnvelope, { kind: 'ack' }> =>
        envelope.kind === 'ack' && envelope.commandId === 'cmd-scenario-pending',
    );
    if (playAck === undefined || scenarioAck === undefined) {
      throw new Error('expected play and scenario acknowledgements');
    }

    expect(scenarioAck.tick).toBeGreaterThanOrEqual(playAck.tick);
  });

  it('keeps serverSeq strictly increasing when the internal sequence cursor regresses', () => {
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);

    captured.send({
      kind: 'hello',
      roomId: 'room-seq-regression-guard',
      clientId: 'client-seq-regression-guard',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });
    captured.send({
      kind: 'request_snapshot',
      roomId: 'room-seq-regression-guard',
      clientId: 'client-seq-regression-guard',
      fromServerSeq: 0,
      reason: 'manual',
    });

    const internalHost = host as unknown as {
      serverSeq: number;
    };
    internalHost.serverSeq = 0;

    captured.send({
      kind: 'request_snapshot',
      roomId: 'room-seq-regression-guard',
      clientId: 'client-seq-regression-guard',
      fromServerSeq: 0,
      reason: 'manual',
    });

    const sequencedEnvelopes = captured.envelopes.filter(
      (envelope): envelope is Exclude<HostEnvelope, { kind: 'hello' }> => envelope.kind !== 'hello',
    );
    expect(sequencedEnvelopes).toHaveLength(3);
    const [firstSnapshot, secondSnapshot, thirdSnapshot] = sequencedEnvelopes;
    if (
      firstSnapshot === undefined ||
      secondSnapshot === undefined ||
      thirdSnapshot === undefined
    ) {
      throw new Error('expected sequenced snapshots');
    }

    expect(firstSnapshot.kind).toBe('snapshot');
    expect(secondSnapshot.kind).toBe('snapshot');
    expect(thirdSnapshot.kind).toBe('snapshot');
    expect(secondSnapshot.serverSeq).toBe(firstSnapshot.serverSeq + 1);
    expect(thirdSnapshot.serverSeq).toBe(secondSnapshot.serverSeq + 1);
  });
});
