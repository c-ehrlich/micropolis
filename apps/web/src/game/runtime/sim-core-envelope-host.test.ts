import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { getCoreBridgeV1SnapshotTileIndex } from '../../../../../packages/core-bridge/src/types.ts';
import {
  cityDimensionsForMap,
  decodeCityFileForMap,
  Tile,
  TileFlag,
  TileMask,
  World,
} from '../../../../../packages/sim-core/src/index.ts';
import { sendMes, sendMesAt } from '../../../../../packages/sim-core/src/systems/messages.ts';
import { getScenarioDefinition } from '../../../../../packages/sim-io/src/scenarios.ts';
import { projectRealtimeOverlaySprites } from '../map/map-canvas.tsx';
import { PLAYABLE_DISASTER_CHOICES } from './playable-disaster-choices.ts';
import {
  type HostEnvelope,
  type HostHudMessagePayload,
  type HostHudPayload,
  type HostMapPatchPayload,
  type HostPatchPayload,
  type HostRealtimePayload,
  type HostSnapshotPayload,
  type HostSoundDeltaPayload,
  PLAYABLE_TOOL_SPECS,
} from './protocol.ts';
import { createInitialWebRuntimeState, reduceHostEnvelope } from './reducer.ts';
import { SimCoreEnvelopeHost } from './sim-core-envelope-host.ts';

const SIM_CORE_ENVELOPE_HOST_SOURCE_URL = new URL('./sim-core-envelope-host.ts', import.meta.url);
// C `saveFile`/`_load_file` classic city dimensions in `ref/micropolis/src/sim/s_fileio.c`.
const CLASSIC_CITY_FILE_BYTE_LENGTH = cityDimensionsForMap(World.WORLD_X, World.WORLD_Y).byteLength;
// C `LoadScenario` always applies `CityTax = 7` and `setSpeed(3)` in `s_fileio.c`.
const LOAD_SCENARIO_CITY_TAX = 7;
const LOAD_SCENARIO_SIM_SPEED = 3;

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

/**
 * Reads map patch payloads from patch envelopes when the host emits
 * coordinate-addressed tile deltas.
 * Mirrors map payload ownership projected from `DoUpdateMap` in
 * `ref/micropolis/src/sim/w_map.c`.
 */
function readMapPatchPayloadFromEnvelope(envelope: HostEnvelope): HostMapPatchPayload | null {
  if (envelope.kind !== 'patch') {
    return null;
  }

  const mapPayload = (envelope.payload as { map?: unknown }).map;
  if (mapPayload === null || typeof mapPayload !== 'object') {
    return null;
  }

  const tileWordDeltas = (mapPayload as { tileWordDeltas?: unknown }).tileWordDeltas;
  if (!Array.isArray(tileWordDeltas)) {
    return null;
  }

  return mapPayload as HostMapPatchPayload;
}

/**
 * Reads HUD payloads from snapshot/patch envelopes.
 * Mirrors `DoUpdateHeads` projection ownership from `ref/micropolis/src/sim/w_update.c`.
 */
function readHudPayloadFromEnvelope(envelope: HostEnvelope): HostHudPayload | null {
  if (envelope.kind !== 'patch' && envelope.kind !== 'snapshot') {
    return null;
  }

  const hudPayload = (envelope.payload as { hud?: unknown }).hud;
  if (hudPayload === null || typeof hudPayload !== 'object') {
    return null;
  }

  return hudPayload as HostHudPayload;
}

/**
 * Reads message-delta payload entries from patch envelopes.
 * Mirrors `SendMes` / `SendMesAt` delta delivery ownership in
 * `ref/micropolis/src/sim/s_msg.c`.
 */
function readMessageDeltasFromEnvelope(
  envelope: HostEnvelope,
): readonly HostHudMessagePayload[] | null {
  if (envelope.kind !== 'patch') {
    return null;
  }

  const messageDeltas = (envelope.payload as { messageDeltas?: unknown }).messageDeltas;
  if (!Array.isArray(messageDeltas)) {
    return null;
  }

  return messageDeltas as readonly HostHudMessagePayload[];
}

/**
 * Reads legacy `payload.messages` compatibility entries from snapshot/patch envelopes.
 * Mirrors migration-era append/feed compatibility kept alongside `SendMes` payload
 * projection in `ref/micropolis/src/sim/s_msg.c`.
 */
function readLegacyMessagesFromEnvelope(
  envelope: HostEnvelope,
): readonly HostHudMessagePayload[] | null {
  if (envelope.kind !== 'patch' && envelope.kind !== 'snapshot') {
    return null;
  }

  const messages = (envelope.payload as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) {
    return null;
  }

  return messages as readonly HostHudMessagePayload[];
}

/**
 * Reads legacy `hud.message` compatibility data from snapshot/patch envelopes.
 * Mirrors single visible-message ownership in `SetMessageField`/`doMessage` from
 * `ref/micropolis/src/sim/s_msg.c`.
 */
function readLegacyHudMessageFromEnvelope(envelope: HostEnvelope): HostHudMessagePayload | null {
  if (envelope.kind !== 'patch' && envelope.kind !== 'snapshot') {
    return null;
  }

  const hudPayload = readHudPayloadFromEnvelope(envelope);
  if (hudPayload === null || hudPayload.message === undefined) {
    return null;
  }

  return hudPayload.message;
}

/**
 * Reads realtime payloads from snapshot/patch envelopes.
 * Mirrors sprite payload projection ownership from `ref/micropolis/src/sim/w_sprite.c`.
 */
function readRealtimePayloadFromEnvelope(envelope: HostEnvelope): HostRealtimePayload | null {
  if (envelope.kind !== 'patch' && envelope.kind !== 'snapshot') {
    return null;
  }

  const realtimePayload = (envelope.payload as { realtime?: unknown }).realtime;
  if (realtimePayload === null || typeof realtimePayload !== 'object') {
    return null;
  }

  return realtimePayload as HostRealtimePayload;
}

/**
 * Reads optional sound-delta payload entries from sequenced host envelopes.
 * Mirrors `MakeSound`/`MakeSoundOn` transport ownership from
 * `ref/micropolis/src/sim/w_sound.c`.
 */
function readSoundDeltasFromEnvelope(
  envelope: HostEnvelope,
): readonly HostSoundDeltaPayload[] | null {
  if (envelope.kind === 'hello' || envelope.soundDeltas === undefined) {
    return null;
  }

  return envelope.soundDeltas;
}

/**
 * Rewrites one host realtime payload to explicit snapshot/delta transport fields.
 * Mirrors bridge migration toward deterministic baseline + incremental sprite
 * updates from `DrawObjects`/sprite lifecycle behavior in
 * `ref/micropolis/src/sim/w_sprite.c`, while dropping legacy `objects` compatibility.
 */
function toSnapshotDeltaRealtimeTransportEnvelope(envelope: HostEnvelope): HostEnvelope {
  if (envelope.kind !== 'patch' && envelope.kind !== 'snapshot') {
    return envelope;
  }

  const realtimePayload = envelope.payload.realtime;
  if (realtimePayload === undefined) {
    return envelope;
  }

  const normalizedRealtimePayload: HostRealtimePayload =
    envelope.kind === 'snapshot'
      ? { snapshot: realtimePayload.snapshot ?? realtimePayload.objects ?? [] }
      : { deltas: realtimePayload.deltas ?? [] };

  if (envelope.kind === 'snapshot') {
    const payload: HostSnapshotPayload = {
      ...envelope.payload,
      realtime: normalizedRealtimePayload,
    };
    return {
      ...envelope,
      payload,
    };
  }

  const payload: HostPatchPayload = {
    ...envelope.payload,
    realtime: normalizedRealtimePayload,
  };
  return {
    ...envelope,
    payload,
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
  });

  it('accepts scenario resource loader overrides for scenario command tests', () => {
    const scenarioResourceLoader = vi.fn((_fileName: string) => new Uint8Array([1, 2, 3]));
    const host = new SimCoreEnvelopeHost({
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
    const hud = readHudPayloadFromEnvelope(snapshot);
    if (hud === null) {
      throw new Error('Expected snapshot HUD payload');
    }

    expect(map.width).toBe(World.WORLD_X);
    expect(map.height).toBe(World.WORLD_Y);
    expect(map.tileWords.length).toBe(World.WORLD_X * World.WORLD_Y);

    const authorityState = (
      host as unknown as {
        authorityState: {
          simState: {
            TotalFunds: number;
          };
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

    expect(hud.funds).toBe(authorityState.simState.TotalFunds);
    expect(hud.fundsLabel).toBeTypeOf('string');
    expect(hud.date).toMatchObject({
      label: expect.any(String),
      month: expect.any(Number),
      year: expect.any(Number),
    });
    expect(hud.demand).toEqual({
      r: expect.any(Number),
      c: expect.any(Number),
      i: expect.any(Number),
    });
    expect(hud.options).toMatchObject({
      autoBudget: expect.any(Boolean),
      autoGo: expect.any(Boolean),
      autoBulldoze: expect.any(Boolean),
      disasters: expect.any(Boolean),
      userSoundOn: expect.any(Boolean),
      doAnimation: expect.any(Boolean),
      doMessages: expect.any(Boolean),
      doNotices: expect.any(Boolean),
    });

    expect(map.tileWords).not.toBe(authoritativeMapLayer);
    expect(map.tileWords).toEqual(authoritativeMapLayer);
  });

  it('serializes snapshot map words using bridge x-major index math from sim-core storage', () => {
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);
    const hostInternals = host as unknown as {
      authorityState: {
        store: {
          beginTick(): void;
          commitTick(): void;
          getLayer(layer: 'map'): Uint16Array | unknown;
        };
      };
    };

    const width = World.WORLD_X;
    const height = World.WORLD_Y;
    // Index formula source: classic contiguous `Map[x][y]` storage in
    // `ref/micropolis/src/sim/s_alloc.c` / `ref/micropolis/src/sim/s_fileio.c`
    // where bridge snapshots use `index = x * height + y`.
    const probes = [
      { x: 1, y: 2, bridgeTileWord: 0x1111, rowMajorTileWord: 0x2111 },
      { x: 3, y: 4, bridgeTileWord: 0x1222, rowMajorTileWord: 0x2222 },
      { x: 7, y: 5, bridgeTileWord: 0x1333, rowMajorTileWord: 0x2333 },
    ] as const;

    hostInternals.authorityState.store.beginTick();
    try {
      const mapLayer = hostInternals.authorityState.store.getLayer('map');
      if (!(mapLayer instanceof Uint16Array)) {
        throw new Error('Expected map layer Uint16Array');
      }

      for (const probe of probes) {
        const bridgeIndex = getCoreBridgeV1SnapshotTileIndex(probe.x, probe.y, height);
        const rowMajorIndex = probe.y * width + probe.x;
        mapLayer[bridgeIndex] = probe.bridgeTileWord;
        mapLayer[rowMajorIndex] = probe.rowMajorTileWord;
      }
    } finally {
      hostInternals.authorityState.store.commitTick();
    }

    captured.send({
      kind: 'hello',
      roomId: 'x-major-room',
      clientId: 'x-major-client',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });

    const snapshot = captured.envelopes[1];
    if (snapshot === undefined || snapshot.kind !== 'snapshot') {
      throw new Error('Expected snapshot envelope');
    }
    const map = snapshot.payload.map;
    if (map === undefined || !('tileWords' in map)) {
      throw new Error('Expected snapshot map payload');
    }

    for (const probe of probes) {
      const bridgeIndex = getCoreBridgeV1SnapshotTileIndex(probe.x, probe.y, height);
      expect(map.tileWords[bridgeIndex]).toBe(probe.bridgeTileWord);
    }
  });

  it('ports realtime snapshot/delta/object payloads from sim-core sprite hooks without forced copter seeding', () => {
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);
    const hostInternals = host as unknown as {
      authorityState: {
        simContext: {
          hooks: {
            generateCopter(): void;
            destroyAllSprites(): void;
          };
        };
      };
    };

    captured.send({
      kind: 'hello',
      roomId: 'room-realtime-hooks',
      clientId: 'client-realtime-hooks',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });

    const initialSnapshot = captured.envelopes[1];
    if (initialSnapshot === undefined || initialSnapshot.kind !== 'snapshot') {
      throw new Error('expected initial snapshot envelope');
    }
    const initialRealtime = readRealtimePayloadFromEnvelope(initialSnapshot);
    if (initialRealtime === null) {
      throw new Error('expected initial realtime snapshot payload');
    }
    // C sprite type ids from `ref/micropolis/src/sim/headers/sim.h` only appear
    // when simulation triggers create them (`w_sprite.c`); no host-side forced seed.
    expect(initialRealtime.snapshot).toEqual([]);
    expect(initialRealtime.objects).toEqual([]);

    hostInternals.authorityState.simContext.hooks.generateCopter();
    captured.send({
      kind: 'command',
      roomId: 'room-realtime-hooks',
      clientId: 'client-realtime-hooks',
      commandId: 'cmd-realtime-pause',
      command: {
        kind: 'sim-control',
        control: 'pause',
      },
    });

    const patchWithCopter = captured.envelopes.at(-1);
    if (patchWithCopter === undefined || patchWithCopter.kind !== 'patch') {
      throw new Error('expected patch envelope after realtime copter hook');
    }
    const realtimeAfterCopter = readRealtimePayloadFromEnvelope(patchWithCopter);
    if (realtimeAfterCopter === null) {
      throw new Error('expected realtime patch payload after realtime copter hook');
    }
    const copterObject = realtimeAfterCopter.objects?.[0];
    if (copterObject === undefined || typeof copterObject.id !== 'string') {
      throw new Error('expected realtime copter object with bridge id');
    }
    // Sprite type `2` is copter (`COP`) in `sim.h` / `w_sprite.c`.
    expect(copterObject.type).toBe(2);
    expect(realtimeAfterCopter.deltas).toEqual([
      {
        kind: 'upsert',
        object: expect.objectContaining({
          id: copterObject.id,
          type: 2,
          x: copterObject.x,
          y: copterObject.y,
        }),
      },
    ]);

    captured.send({
      kind: 'command',
      roomId: 'room-realtime-hooks',
      clientId: 'client-realtime-hooks',
      commandId: 'cmd-realtime-play',
      command: {
        kind: 'sim-control',
        control: 'play',
      },
    });

    const patchWithoutSpriteChange = captured.envelopes.at(-1);
    if (patchWithoutSpriteChange === undefined || patchWithoutSpriteChange.kind !== 'patch') {
      throw new Error('expected patch envelope after realtime play command');
    }
    const realtimeWithoutSpriteChange = readRealtimePayloadFromEnvelope(patchWithoutSpriteChange);
    if (realtimeWithoutSpriteChange === null) {
      throw new Error('expected realtime patch payload after realtime play command');
    }
    expect(realtimeWithoutSpriteChange.objects).toEqual(realtimeAfterCopter.objects);
    expect(realtimeWithoutSpriteChange.deltas).toEqual([]);

    hostInternals.authorityState.simContext.hooks.destroyAllSprites();
    captured.send({
      kind: 'command',
      roomId: 'room-realtime-hooks',
      clientId: 'client-realtime-hooks',
      commandId: 'cmd-realtime-speed',
      command: {
        kind: 'sim-control',
        control: 'set-speed',
        speed: 3,
      },
    });

    const patchAfterDestroy = captured.envelopes.at(-1);
    if (patchAfterDestroy === undefined || patchAfterDestroy.kind !== 'patch') {
      throw new Error('expected patch envelope after realtime sprite destroy');
    }
    const realtimeAfterDestroy = readRealtimePayloadFromEnvelope(patchAfterDestroy);
    if (realtimeAfterDestroy === null) {
      throw new Error('expected realtime patch payload after realtime sprite destroy');
    }
    expect(realtimeAfterDestroy.objects).toEqual([]);
    expect(realtimeAfterDestroy.deltas).toEqual([
      {
        kind: 'remove',
        id: copterObject.id,
      },
    ]);
  });

  it('keeps realtime overlays functional with realtime snapshot + delta transport', () => {
    const roomId = 'room-realtime-snapshot-deltas';
    const clientId = 'client-realtime-snapshot-deltas';
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);
    const hostInternals = host as unknown as {
      authorityState: {
        simContext: {
          hooks: {
            generateCopter(): void;
            destroyAllSprites(): void;
          };
        };
      };
    };

    captured.send({
      kind: 'hello',
      roomId,
      clientId,
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });

    hostInternals.authorityState.simContext.hooks.generateCopter();
    captured.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: 'cmd-realtime-overlay-pause',
      command: {
        kind: 'sim-control',
        control: 'pause',
      },
    });

    hostInternals.authorityState.simContext.hooks.destroyAllSprites();
    captured.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: 'cmd-realtime-overlay-speed',
      command: {
        kind: 'sim-control',
        control: 'set-speed',
        speed: 3,
      },
    });

    const transported = captured.envelopes.map(toSnapshotDeltaRealtimeTransportEnvelope);
    let reducedState = createInitialWebRuntimeState({ roomId, clientId });
    let overlaysAfterUpsert: ReturnType<typeof projectRealtimeOverlaySprites> | undefined;
    let overlaysAfterRemove: ReturnType<typeof projectRealtimeOverlaySprites> | undefined;

    for (const envelope of transported) {
      const reduction = reduceHostEnvelope(reducedState, envelope);
      expect(reduction.outcome).toBe('applied');
      reducedState = reduction.state;

      if (envelope.kind !== 'patch') {
        continue;
      }
      const deltas = envelope.payload.realtime?.deltas;
      if (deltas === undefined) {
        continue;
      }

      const overlays = projectRealtimeOverlaySprites({
        objects: reducedState.realtimeState.objects,
        tileSize: 16,
        mapWidth: reducedState.mapState.width,
        mapHeight: reducedState.mapState.height,
      });
      if (deltas.some((delta) => delta.kind === 'upsert')) {
        overlaysAfterUpsert = overlays;
      }
      if (deltas.some((delta) => delta.kind === 'remove')) {
        overlaysAfterRemove = overlays;
      }
    }

    if (overlaysAfterUpsert === undefined) {
      throw new Error('expected upsert delta patch to project realtime overlays');
    }
    if (overlaysAfterRemove === undefined) {
      throw new Error('expected remove delta patch to project realtime overlays');
    }

    // Sprite type `2` is copter (`COP`) in `ref/micropolis/src/sim/headers/sim.h`.
    expect(overlaysAfterUpsert.some((overlay) => overlay.label === 'COP')).toBe(true);
    expect(overlaysAfterUpsert.some((overlay) => overlay.key.startsWith('id:rt-'))).toBe(true);
    expect(overlaysAfterRemove).toEqual([]);
    expect(reducedState.realtimeState.objects).toEqual([]);
  });

  it('only enables manual disaster triggers after the host session is ready', () => {
    const host = new SimCoreEnvelopeHost();
    expect(host.triggerManualRealtimeEvent('earthquake')).toBe(false);

    const captured = connectAndCapture(host);
    expect(host.triggerManualRealtimeEvent('earthquake')).toBe(false);

    captured.send({
      kind: 'hello',
      roomId: 'room-manual-disaster-ready',
      clientId: 'client-manual-disaster-ready',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });

    expect(host.triggerManualRealtimeEvent('earthquake')).toBe(true);
    expect(captured.envelopes.at(-1)?.kind).toBe('patch');

    captured.disconnect();
    expect(host.triggerManualRealtimeEvent('earthquake')).toBe(false);
  });

  it('keeps manual disaster message/realtime payload sequencing aligned with Micropolis C disaster paths', () => {
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);
    const roomId = 'room-manual-disaster-path';
    const clientId = 'client-manual-disaster-path';

    captured.send({
      kind: 'hello',
      roomId,
      clientId,
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });

    expect(host.triggerManualRealtimeEvent('earthquake')).toBe(true);
    const earthquakePatch = captured.envelopes.at(-1);
    if (earthquakePatch === undefined || earthquakePatch.kind !== 'patch') {
      throw new Error('expected earthquake manual-disaster patch envelope');
    }
    const earthquakeMessages = readMessageDeltasFromEnvelope(earthquakePatch) ?? [];
    // Message id `-23` comes from `makeEarthquake` -> `sendMesAt` in
    // `packages/sim-core/src/systems/disasters.ts`, mirroring `MakeEarthquake`
    // in `ref/micropolis/src/sim/s_disast.c`.
    expect(earthquakeMessages.some((message) => message.id === -23)).toBe(true);
    // `doMessage` in `s_msg.c` requeues the positive text id for the next
    // heads cycle; the same cycle should only dispatch the picture id.
    expect(earthquakeMessages.some((message) => message.id === 23)).toBe(false);
    expect(readRealtimePayloadFromEnvelope(earthquakePatch)).toBeNull();

    expect(host.triggerManualRealtimeEvent('tornado')).toBe(true);
    const tornadoPatch = captured.envelopes.at(-1);
    if (tornadoPatch === undefined || tornadoPatch.kind !== 'patch') {
      throw new Error('expected tornado manual-disaster patch envelope');
    }
    const tornadoMessages = readMessageDeltasFromEnvelope(tornadoPatch) ?? [];
    // Message id `-22` comes from `makeTornado` -> `sendMessage` in
    // `packages/sim-core/src/sim/realtime.ts`, mirroring `MakeTornado`
    // in `ref/micropolis/src/sim/w_sprite.c`.
    const tornadoPictureMessage = tornadoMessages.find((message) => message.id === -22);
    if (
      tornadoPictureMessage === undefined ||
      tornadoPictureMessage.x === undefined ||
      tornadoPictureMessage.y === undefined
    ) {
      throw new Error('expected tornado picture message with map coordinates');
    }
    expect(tornadoMessages.some((message) => message.id === 22)).toBe(false);

    const tornadoRealtime = readRealtimePayloadFromEnvelope(tornadoPatch);
    if (tornadoRealtime === null) {
      throw new Error('expected realtime payload after tornado manual-disaster trigger');
    }
    const tornadoObject = tornadoRealtime.objects?.find((object) => object.type === 6);
    if (tornadoObject === undefined) {
      throw new Error('expected tornado realtime object in payload');
    }
    // Sprite type `6` is tornado (`TOR`) in `sim.h` and `w_sprite.c`, exposed
    // by `SPRITE_TYPE.TOR` in `packages/sim-core/src/sim/realtime.ts`.
    expect(
      tornadoRealtime.deltas?.some((delta) => delta.kind === 'upsert' && delta.object.type === 6),
    ).toBe(true);
    // w_sprite.c `MakeTornado` sends `SendMesAt(-22, (x >> 4) + 3, (y >> 4) + 2)`.
    expect(tornadoPictureMessage.x).toBe((tornadoObject.x >> 4) + 3);
    expect(tornadoPictureMessage.y).toBe((tornadoObject.y >> 4) + 2);

    expect(host.triggerManualRealtimeEvent('tornado')).toBe(true);
    const repeatedTornadoPatch = captured.envelopes.at(-1);
    if (repeatedTornadoPatch === undefined || repeatedTornadoPatch.kind !== 'patch') {
      throw new Error('expected repeated tornado manual-disaster patch envelope');
    }
    const repeatedTornadoMessages = readMessageDeltasFromEnvelope(repeatedTornadoPatch) ?? [];
    // On the next heads cycle, `doMessage` flips the queued picture id to text id.
    expect(repeatedTornadoMessages.some((message) => message.id === -22)).toBe(false);
    expect(repeatedTornadoMessages.some((message) => message.id === 22)).toBe(true);
    const repeatedTornadoRealtime = readRealtimePayloadFromEnvelope(repeatedTornadoPatch);
    if (repeatedTornadoRealtime === null) {
      throw new Error('expected realtime payload after repeated tornado trigger');
    }
    expect(
      repeatedTornadoRealtime.deltas?.some(
        (delta) => delta.kind === 'upsert' && delta.object.type === 6,
      ),
    ).toBe(false);

    expect(host.triggerManualRealtimeEvent('monster')).toBe(true);
    const monsterPatch = captured.envelopes.at(-1);
    if (monsterPatch === undefined || monsterPatch.kind !== 'patch') {
      throw new Error('expected monster manual-disaster patch envelope');
    }
    const monsterMessages = readMessageDeltasFromEnvelope(monsterPatch) ?? [];
    const monsterPictureMessage = monsterMessages.find((message) => message.id === -21);
    if (
      monsterPictureMessage === undefined ||
      monsterPictureMessage.x === undefined ||
      monsterPictureMessage.y === undefined
    ) {
      throw new Error('expected monster picture message with map coordinates');
    }
    expect(monsterMessages.some((message) => message.id === 21)).toBe(false);
    const monsterRealtime = readRealtimePayloadFromEnvelope(monsterPatch);
    if (monsterRealtime === null) {
      throw new Error('expected realtime payload after monster manual-disaster trigger');
    }
    const monsterObject = monsterRealtime.objects?.find((object) => object.type === 5);
    if (monsterObject === undefined) {
      throw new Error('expected monster realtime object in payload');
    }
    // Sprite type `5` is monster (`GOD`) in `packages/sim-core/src/sim/realtime.ts`,
    // mirroring monster sprite dispatch from `w_sprite.c`.
    expect(
      monsterRealtime.deltas?.some((delta) => delta.kind === 'upsert' && delta.object.type === 5),
    ).toBe(true);
    // w_sprite.c `MonsterHere` sends `SendMesAt(-21, x + 5, y)` after creating
    // sprite position `(x << 4) + 48, (y << 4)`.
    expect(monsterPictureMessage.x).toBe((monsterObject.x >> 4) + 2);
    expect(monsterPictureMessage.y).toBe(monsterObject.y >> 4);

    expect(host.triggerManualRealtimeEvent('monster')).toBe(true);
    const repeatedMonsterPatch = captured.envelopes.at(-1);
    if (repeatedMonsterPatch === undefined || repeatedMonsterPatch.kind !== 'patch') {
      throw new Error('expected repeated monster manual-disaster patch envelope');
    }
    const repeatedMonsterMessages = readMessageDeltasFromEnvelope(repeatedMonsterPatch) ?? [];
    expect(repeatedMonsterMessages.some((message) => message.id === -21)).toBe(false);
    expect(repeatedMonsterMessages.some((message) => message.id === 21)).toBe(true);
    const repeatedMonsterRealtime = readRealtimePayloadFromEnvelope(repeatedMonsterPatch);
    if (repeatedMonsterRealtime === null) {
      throw new Error('expected realtime payload after repeated monster trigger');
    }
    expect(
      repeatedMonsterRealtime.deltas?.some(
        (delta) => delta.kind === 'upsert' && delta.object.type === 5,
      ),
    ).toBe(false);
  });

  it('accepts every playable disaster choice id and emits one patch per trigger', () => {
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);

    captured.send({
      kind: 'hello',
      roomId: 'room-manual-disaster-all-choices',
      clientId: 'client-manual-disaster-all-choices',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });

    const envelopeCountBeforeDisasters = captured.envelopes.length;
    for (const choice of PLAYABLE_DISASTER_CHOICES) {
      expect(host.triggerManualRealtimeEvent(choice.id)).toBe(true);
    }

    const disasterEnvelopes = captured.envelopes.slice(envelopeCountBeforeDisasters);
    expect(disasterEnvelopes).toHaveLength(PLAYABLE_DISASTER_CHOICES.length);
    expect(disasterEnvelopes.every((envelope) => envelope.kind === 'patch')).toBe(true);
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
    // Default city funds are 20,000 in Micropolis init/new-city flows
    // (`ref/micropolis/src/sim/s_init.c` via startup state wiring).
    expect(captured.envelopes[3]).toMatchObject({
      kind: 'patch',
      roomId: 'room-a',
      clientId: 'client-a',
      tick: 1,
      serverSeq: 3,
      payload: {
        hud: {
          funds: 20_000,
          fundsLabel: 'Funds: $20,000',
        },
      },
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
      payload: {
        hud: {
          speed: 0,
        },
      },
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
      payload: {
        hud: {
          speed: 2,
        },
      },
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

  it('captures makeSound/sendMes/sendMesAt hooks into patch deltas and preserves replay metadata on snapshots', () => {
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);
    const hostInternals = host as unknown as {
      tick: number;
      drainPendingSoundDeltasForTick(tick?: number): HostSoundDeltaPayload[];
      authorityState: {
        simState: Parameters<typeof sendMes>[0];
        simContext: Parameters<typeof sendMes>[1];
      };
    };

    captured.send({
      kind: 'hello',
      roomId: 'room-message-hooks',
      clientId: 'client-message-hooks',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });

    // Message-id source: `SendMessages` warning ids in `ref/micropolis/src/sim/s_msg.c`.
    expect(
      sendMesAt(
        hostInternals.authorityState.simState,
        hostInternals.authorityState.simContext,
        14,
        7,
        9,
      ),
    ).toBe(true);
    // sim-core numeric `makeSound(channel,sound)` ids from
    // `packages/sim-core/src/systems/messages.ts`, mirroring `doMessage`
    // `MakeSound("city", "Siren")` in `ref/micropolis/src/sim/s_msg.c`.
    hostInternals.authorityState.simContext.hooks.makeSound(0, 4);
    expect(hostInternals.drainPendingSoundDeltasForTick(hostInternals.tick)).toEqual([
      {
        channel: 'city',
        soundSpec: 'Siren',
      },
    ]);
    captured.send({
      kind: 'command',
      roomId: 'room-message-hooks',
      clientId: 'client-message-hooks',
      commandId: 'cmd-pause-message-hooks',
      command: {
        kind: 'sim-control',
        control: 'pause',
      },
    });

    expect(
      sendMes(hostInternals.authorityState.simState, hostInternals.authorityState.simContext, 16),
    ).toBe(true);
    captured.send({
      kind: 'command',
      roomId: 'room-message-hooks',
      clientId: 'client-message-hooks',
      commandId: 'cmd-play-message-hooks',
      command: {
        kind: 'sim-control',
        control: 'play',
      },
    });

    const pausePatch = captured.envelopes[3];
    if (pausePatch === undefined) {
      throw new Error('expected pause patch envelope');
    }
    const pauseMessageDeltas = readMessageDeltasFromEnvelope(pausePatch);
    if (pauseMessageDeltas === null) {
      throw new Error('expected pause patch message deltas');
    }
    expect(pauseMessageDeltas).toContainEqual({
      id: 14,
      text: 'Residents demand police stations.',
      x: 7,
      y: 9,
      tick: 1,
      serverSeq: 3,
    });

    const playPatch = captured.envelopes[5];
    if (playPatch === undefined) {
      throw new Error('expected play patch envelope');
    }
    const playMessageDeltas = readMessageDeltasFromEnvelope(playPatch);
    if (playMessageDeltas === null) {
      throw new Error('expected play patch message deltas');
    }
    expect(playMessageDeltas).toContainEqual({
      id: 16,
      text: 'City taxes are too high.',
      tick: 2,
      serverSeq: 5,
    });

    captured.send({
      kind: 'request_snapshot',
      roomId: 'room-message-hooks',
      clientId: 'client-message-hooks',
      fromServerSeq: 5,
      reason: 'manual',
    });

    const replaySnapshot = captured.envelopes[6];
    if (replaySnapshot === undefined || replaySnapshot.kind !== 'snapshot') {
      throw new Error('expected replay snapshot envelope');
    }
    const replayMessages = replaySnapshot.payload.messages;
    if (replayMessages === undefined) {
      throw new Error('expected replay snapshot messages payload');
    }
    const sendMesAtMessage = replayMessages.find(
      (message) => message.id === 14 && message.x === 7 && message.y === 9,
    );
    const sendMesMessage = replayMessages.find(
      (message) => message.id === 16 && message.x === undefined && message.y === undefined,
    );
    expect(sendMesAtMessage).toMatchObject({
      tick: 1,
      serverSeq: 3,
    });
    expect(sendMesMessage).toMatchObject({
      tick: 2,
      serverSeq: 5,
    });
  });

  it('keeps replay snapshot message metadata deterministic even if a prior replay payload is mutated', () => {
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);
    const hostInternals = host as unknown as {
      authorityState: {
        simState: Parameters<typeof sendMes>[0];
        simContext: Parameters<typeof sendMes>[1];
      };
    };

    captured.send({
      kind: 'hello',
      roomId: 'room-replay-metadata',
      clientId: 'client-replay-metadata',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });

    // Message-id source: `SendMessages` warning ids in `ref/micropolis/src/sim/s_msg.c`.
    expect(
      sendMesAt(
        hostInternals.authorityState.simState,
        hostInternals.authorityState.simContext,
        14,
        7,
        9,
      ),
    ).toBe(true);
    captured.send({
      kind: 'command',
      roomId: 'room-replay-metadata',
      clientId: 'client-replay-metadata',
      commandId: 'cmd-pause-replay-metadata',
      command: {
        kind: 'sim-control',
        control: 'pause',
      },
    });

    captured.send({
      kind: 'request_snapshot',
      roomId: 'room-replay-metadata',
      clientId: 'client-replay-metadata',
      fromServerSeq: 3,
      reason: 'manual',
    });

    const firstReplay = captured.envelopes[4];
    if (firstReplay === undefined || firstReplay.kind !== 'snapshot') {
      throw new Error('expected first replay snapshot envelope');
    }
    const firstReplayMessages = firstReplay.payload.messages;
    if (firstReplayMessages === undefined || firstReplayMessages.length === 0) {
      throw new Error('expected first replay snapshot messages payload');
    }

    const firstReplayMessage = firstReplayMessages[0];
    if (firstReplayMessage === undefined) {
      throw new Error('expected first replay message');
    }
    firstReplayMessage.text = 'mutated-replay-text';
    firstReplayMessage.tick = 777;
    firstReplayMessage.serverSeq = 777;

    captured.send({
      kind: 'request_snapshot',
      roomId: 'room-replay-metadata',
      clientId: 'client-replay-metadata',
      fromServerSeq: 3,
      reason: 'manual',
    });

    const secondReplay = captured.envelopes[5];
    if (secondReplay === undefined || secondReplay.kind !== 'snapshot') {
      throw new Error('expected second replay snapshot envelope');
    }
    const secondReplayMessage = secondReplay.payload.messages?.find(
      (message) => message.id === 14 && message.x === 7 && message.y === 9,
    );
    expect(secondReplayMessage).toMatchObject({
      text: 'Residents demand police stations.',
      tick: 1,
      serverSeq: 3,
    });
  });

  it('keeps canonical and compatibility message fields aligned without reducer duplication', () => {
    const roomId = 'room-message-compatibility';
    const clientId = 'client-message-compatibility';
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);
    const hostInternals = host as unknown as {
      authorityState: {
        simState: Parameters<typeof sendMes>[0];
        simContext: Parameters<typeof sendMes>[1];
      };
    };

    captured.send({
      kind: 'hello',
      roomId,
      clientId,
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });

    // Message-id source: `SendMessages` warning ids in `ref/micropolis/src/sim/s_msg.c`.
    expect(
      sendMesAt(
        hostInternals.authorityState.simState,
        hostInternals.authorityState.simContext,
        14,
        7,
        9,
      ),
    ).toBe(true);
    captured.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: 'cmd-pause-message-compatibility',
      command: {
        kind: 'sim-control',
        control: 'pause',
      },
    });

    const messagePatch = captured.envelopes[3];
    if (messagePatch === undefined || messagePatch.kind !== 'patch') {
      throw new Error('expected message patch envelope');
    }
    const canonicalMessageDeltas = readMessageDeltasFromEnvelope(messagePatch);
    if (canonicalMessageDeltas === null || canonicalMessageDeltas.length === 0) {
      throw new Error('expected canonical message delta payload');
    }
    const legacyMessages = readLegacyMessagesFromEnvelope(messagePatch);
    if (legacyMessages === null || legacyMessages.length === 0) {
      throw new Error('expected legacy messages compatibility payload');
    }
    expect(legacyMessages).toEqual(canonicalMessageDeltas);
    expect(readLegacyHudMessageFromEnvelope(messagePatch)).toEqual(
      canonicalMessageDeltas[canonicalMessageDeltas.length - 1],
    );

    captured.send({
      kind: 'request_snapshot',
      roomId,
      clientId,
      fromServerSeq: messagePatch.serverSeq,
      reason: 'manual',
    });

    const replaySnapshot = captured.envelopes[4];
    if (replaySnapshot === undefined || replaySnapshot.kind !== 'snapshot') {
      throw new Error('expected replay snapshot envelope');
    }
    if (
      replaySnapshot.payload.messages === undefined ||
      replaySnapshot.payload.messageDeltas === undefined
    ) {
      throw new Error('expected snapshot canonical + compatibility message fields');
    }
    expect(replaySnapshot.payload.messageDeltas).toEqual(replaySnapshot.payload.messages);
    expect(readLegacyHudMessageFromEnvelope(replaySnapshot)).toEqual(
      replaySnapshot.payload.messages[replaySnapshot.payload.messages.length - 1],
    );

    let liveState = createInitialWebRuntimeState({ roomId, clientId });
    for (const envelope of captured.envelopes.slice(0, 4)) {
      const reduction = reduceHostEnvelope(liveState, envelope);
      expect(reduction.outcome).toBe('applied');
      liveState = reduction.state;
    }
    expect(liveState.hudState.messages.filter((message) => message.id === 14)).toHaveLength(1);

    const helloEnvelope = captured.envelopes[0];
    if (helloEnvelope === undefined || helloEnvelope.kind !== 'hello') {
      throw new Error('expected hello envelope');
    }
    const replayHelloReduction = reduceHostEnvelope(
      createInitialWebRuntimeState({ roomId, clientId }),
      helloEnvelope,
    );
    expect(replayHelloReduction.outcome).toBe('applied');
    const replaySnapshotReduction = reduceHostEnvelope(replayHelloReduction.state, replaySnapshot);
    expect(replaySnapshotReduction.outcome).toBe('applied');
    expect(
      replaySnapshotReduction.state.hudState.messages.filter((message) => message.id === 14),
    ).toHaveLength(1);
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
    expect(savePayload.cityBytes.byteLength).toBe(CLASSIC_CITY_FILE_BYTE_LENGTH);

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
    expect(savePayload.cityBytes.byteLength).toBe(CLASSIC_CITY_FILE_BYTE_LENGTH);

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
    expect(hostInternals.authorityState.simState.CityTax).toBe(LOAD_SCENARIO_CITY_TAX);
    expect(hostInternals.authorityState.simState.SimSpeed).toBe(LOAD_SCENARIO_SIM_SPEED);
    expect(hostInternals.authorityState.simState.SimMetaSpeed).toBe(LOAD_SCENARIO_SIM_SPEED);
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
        const patchEnvelope = newEnvelopes[1];
        expect(patchEnvelope).toMatchObject({
          kind: 'patch',
          roomId: 'room-tools',
          clientId: 'client-tools',
          tick: settlement.tick,
          serverSeq: settlement.serverSeq + 1,
        });
        if (patchEnvelope === undefined || patchEnvelope.kind !== 'patch') {
          throw new Error(`missing patch envelope for ${spec.tool}`);
        }

        const mapPatch = readMapPatchPayloadFromEnvelope(patchEnvelope);
        if (spec.tool === 'query') {
          expect(mapPatch).toBeNull();
          continue;
        }

        if (mapPatch === null) {
          throw new Error(`expected map patch payload for ${spec.tool}`);
        }
        expect(mapPatch.tileWordDeltas.length).toBeGreaterThan(0);
        expect(mapPatch.redrawPlan).toMatchObject({
          reason: 'patch-rects',
          fullRedraw: false,
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

  it('covers parity-oriented tool/map/HUD/message/realtime behavior in one deterministic host flow', () => {
    const roomId = 'room-parity-certification';
    const clientId = 'client-parity-certification';
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);
    const x = 28;
    const y = 28;
    const tileIndex = x * World.WORLD_Y + y;
    const hostInternals = host as unknown as {
      authorityState: {
        simState: Parameters<typeof sendMes>[0] & {
          TotalFunds: number;
        };
        simContext: Parameters<typeof sendMes>[1] & {
          hooks: {
            generateCopter(): void;
          };
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

    hostInternals.authorityState.store.beginTick();
    try {
      const mapLayer = hostInternals.authorityState.store.getLayer('map');
      if (!(mapLayer instanceof Uint16Array)) {
        throw new Error('expected map layer Uint16Array');
      }
      mapLayer[tileIndex] = Tile.DIRT;
    } finally {
      hostInternals.authorityState.store.commitTick();
    }

    hostInternals.authorityState.simState.TotalFunds = 100;
    hostInternals.authorityState.toolContext.funds = 100;

    captured.send({
      kind: 'hello',
      roomId,
      clientId,
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });
    captured.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: 'cmd-road-parity-certification',
      command: {
        kind: 'tool',
        tool: 'road',
        x,
        y,
      },
    });

    expect(captured.envelopes[2]).toEqual({
      kind: 'ack',
      roomId,
      clientId,
      tick: 1,
      serverSeq: 2,
      commandId: 'cmd-road-parity-certification',
    });

    const roadPatchEnvelope = captured.envelopes[3];
    if (roadPatchEnvelope === undefined) {
      throw new Error('expected road patch envelope');
    }
    const roadMapPatch = readMapPatchPayloadFromEnvelope(roadPatchEnvelope);
    if (roadMapPatch === null) {
      throw new Error('expected road map patch payload');
    }
    expect(roadMapPatch.redrawPlan).toMatchObject({
      reason: 'patch-rects',
      fullRedraw: false,
    });
    const roadDeltaAtCommand = roadMapPatch.tileWordDeltas.find(
      (delta) => delta.x === x && delta.y === y,
    );
    if (roadDeltaAtCommand === undefined) {
      throw new Error('expected road map delta at command coordinates');
    }
    expect(roadDeltaAtCommand.tileWord & TileMask.LOMASK).not.toBe(Tile.DIRT);
    const roadHudPatch = readHudPayloadFromEnvelope(roadPatchEnvelope);
    if (roadHudPatch === null) {
      throw new Error('expected road HUD patch payload');
    }
    // `CostOf[road_tool]` is 10 in `ref/micropolis/src/sim/w_tool.c`.
    expect(roadHudPatch.funds).toBe(90);
    expect(roadHudPatch.fundsLabel).toBe('Funds: $90');
    expect(hostInternals.authorityState.simState.TotalFunds).toBe(90);
    expect(hostInternals.authorityState.toolContext.funds).toBe(90);

    // Message-id source: `SendMessages` warning ids in `ref/micropolis/src/sim/s_msg.c`.
    expect(
      sendMesAt(
        hostInternals.authorityState.simState,
        hostInternals.authorityState.simContext,
        14,
        7,
        9,
      ),
    ).toBe(true);
    hostInternals.authorityState.simContext.hooks.generateCopter();
    captured.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: 'cmd-pause-parity-certification',
      command: {
        kind: 'sim-control',
        control: 'pause',
      },
    });

    expect(captured.envelopes[4]).toEqual({
      kind: 'ack',
      roomId,
      clientId,
      tick: 2,
      serverSeq: 4,
      commandId: 'cmd-pause-parity-certification',
    });
    const parityPatchEnvelope = captured.envelopes[5];
    if (parityPatchEnvelope === undefined) {
      throw new Error('expected parity certification patch envelope');
    }
    const messageDeltas = readMessageDeltasFromEnvelope(parityPatchEnvelope);
    if (messageDeltas === null) {
      throw new Error('expected message delta payload in parity certification patch');
    }
    expect(messageDeltas).toContainEqual({
      id: 14,
      text: 'Residents demand police stations.',
      x: 7,
      y: 9,
      tick: 2,
      serverSeq: 5,
    });
    expect(readLegacyHudMessageFromEnvelope(parityPatchEnvelope)).toMatchObject({
      id: 14,
      x: 7,
      y: 9,
    });

    const realtimePatch = readRealtimePayloadFromEnvelope(parityPatchEnvelope);
    if (realtimePatch === null) {
      throw new Error('expected realtime payload in parity certification patch');
    }
    const copterObject = realtimePatch.objects?.find((object) => object.type === 2);
    if (copterObject === undefined) {
      throw new Error('expected copter realtime object in parity certification patch');
    }
    // Sprite type `2` is copter (`COP`) in `ref/micropolis/src/sim/headers/sim.h`.
    expect(
      realtimePatch.deltas?.some(
        (delta) =>
          delta.kind === 'upsert' && delta.object.type === 2 && delta.object.id === copterObject.id,
      ),
    ).toBe(true);

    let reducedState = createInitialWebRuntimeState({ roomId, clientId });
    for (const envelope of captured.envelopes.slice(0, 6)) {
      const reduction = reduceHostEnvelope(reducedState, envelope);
      expect(reduction.outcome).toBe('applied');
      reducedState = reduction.state;
    }

    const roadRowMajorIndex = y * reducedState.mapState.width + x;
    expect(reducedState.mapState.tiles[roadRowMajorIndex]).not.toBe(Tile.DIRT);
    expect(reducedState.hudState.fundsLabel).toBe('Funds: $90');
    expect(
      reducedState.hudState.messages.some((message) => message.id === 14 && message.x === 7),
    ).toBe(true);
    expect(reducedState.realtimeState.objects.some((object) => object.type === 2)).toBe(true);
  });

  it.each([
    {
      caseId: 'road-66',
      roadTile: Tile.ROADS,
      expectedWireRoadTile: Tile.HROADPOWER,
    },
    {
      caseId: 'road-67',
      // `_LayWire` in `ref/micropolis/src/sim/w_con.c` has a second straight-road
      // case for tile id 67 (`Road #2`) even though it is not exported as a named
      // tile constant in `sim.h`.
      roadTile: 67,
      expectedWireRoadTile: Tile.VROADPOWER,
    },
  ])(
    'acks wire placement on straight road tiles and applies the C crossing tile ($caseId)',
    ({ caseId, roadTile, expectedWireRoadTile }) => {
      const host = new SimCoreEnvelopeHost();
      const captured = connectAndCapture(host);
      const x = 22;
      const y = 22;
      const tileIndex = x * World.WORLD_Y + y;
      const roomId = `room-wire-on-road-${caseId}`;
      const clientId = `client-wire-on-road-${caseId}`;
      const commandId = `cmd-wire-on-road-${caseId}`;
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
        mapLayer[tileIndex] = roadTile | TileFlag.BULLBIT | TileFlag.BURNBIT;
      } finally {
        hostInternals.authorityState.store.commitTick();
      }

      captured.send({
        kind: 'hello',
        roomId,
        clientId,
        protocolVersion: 'core-bridge/v1',
        coreVersion: 'test-core',
      });
      captured.send({
        kind: 'command',
        roomId,
        clientId,
        commandId,
        command: {
          kind: 'tool',
          tool: 'wire',
          x,
          y,
        },
      });

      expect(captured.envelopes[2]).toEqual({
        kind: 'ack',
        roomId,
        clientId,
        tick: 1,
        serverSeq: 2,
        commandId,
      });
      expect(captured.envelopes[3]).toMatchObject({
        kind: 'patch',
        roomId,
        clientId,
        tick: 1,
        serverSeq: 3,
      });
      const wirePatchEnvelope = captured.envelopes[3];
      if (wirePatchEnvelope === undefined) {
        throw new Error('expected wire patch envelope');
      }
      const wirePatchPayload = readMapPatchPayloadFromEnvelope(wirePatchEnvelope);
      if (wirePatchPayload === null) {
        throw new Error('expected wire map patch payload');
      }
      expect(wirePatchPayload.redrawPlan).toMatchObject({
        reason: 'patch-rects',
        fullRedraw: false,
      });
      const wireDelta = wirePatchPayload.tileWordDeltas.find(
        (delta) => delta.x === x && delta.y === y,
      );
      if (wireDelta === undefined) {
        throw new Error('expected wire tile delta at command coordinates');
      }
      // `_LayWire` in `ref/micropolis/src/sim/w_con.c` maps road tile 66 to 77
      // and road tile 67 to 78 for wire-on-road placement.
      expect(wireDelta.tileWord & TileMask.LOMASK).toBe(expectedWireRoadTile);
      expect(wireDelta.tileWord & TileFlag.CONDBIT).not.toBe(0);
      const tileAfter = wireDelta.tileWord;

      const mapAfter = hostInternals.authorityState.store.snapshot('map');
      if (!(mapAfter instanceof Uint16Array)) {
        throw new Error('expected authoritative map layer snapshot to be Uint16Array');
      }
      const authoritativeTileAfter = mapAfter[tileIndex];
      if (authoritativeTileAfter === undefined) {
        throw new Error(`expected map tile at index ${tileIndex}`);
      }
      expect(authoritativeTileAfter).toBe(tileAfter);
    },
  );

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
    expect(captured.envelopes[3]).toMatchObject({
      kind: 'patch',
      roomId: 'room-funds-spend',
      clientId: 'client-funds-spend',
      tick: 1,
      serverSeq: 3,
    });
    const spendPatchEnvelope = captured.envelopes[3];
    if (spendPatchEnvelope === undefined) {
      throw new Error('expected spend patch envelope');
    }
    const spendMapPatch = readMapPatchPayloadFromEnvelope(spendPatchEnvelope);
    if (spendMapPatch === null) {
      throw new Error('expected spend map patch payload');
    }
    expect(spendMapPatch.tileWordDeltas.length).toBeGreaterThan(0);
    expect(spendMapPatch.redrawPlan).toMatchObject({
      reason: 'patch-rects',
      fullRedraw: false,
    });
    const spendHudPayload = readHudPayloadFromEnvelope(spendPatchEnvelope);
    if (spendHudPayload === null) {
      throw new Error('expected spend HUD patch payload');
    }
    // `CostOf[road_tool]` is 10 in `ref/micropolis/src/sim/w_tool.c`, so
    // `TotalFunds` and emitted heads should both drop from 100 to 90.
    expect(spendHudPayload.funds).toBe(90);
    expect(spendHudPayload.fundsLabel).toBe('Funds: $90');
    expect(authorityState.simState.TotalFunds).toBe(90);
    expect(authorityState.toolContext.funds).toBe(90);
  });

  it('emits full-redraw map metadata and consumes invalidation markers when NewMap is dirty', () => {
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);
    const hostInternals = host as unknown as {
      authorityState: {
        simState: {
          NewMap: number;
          NewMapFlags: Uint8Array;
        };
      };
    };

    captured.send({
      kind: 'hello',
      roomId: 'room-map-redraw-new-map',
      clientId: 'client-map-redraw-new-map',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });

    hostInternals.authorityState.simState.NewMap = 1;
    hostInternals.authorityState.simState.NewMapFlags[3] = 1;

    captured.send({
      kind: 'command',
      roomId: 'room-map-redraw-new-map',
      clientId: 'client-map-redraw-new-map',
      commandId: 'cmd-pause-redraw',
      command: {
        kind: 'sim-control',
        control: 'pause',
      },
    });

    const redrawPatchEnvelope = captured.envelopes[3];
    if (redrawPatchEnvelope === undefined) {
      throw new Error('expected redraw patch envelope');
    }
    const redrawMapPatch = readMapPatchPayloadFromEnvelope(redrawPatchEnvelope);
    if (redrawMapPatch === null) {
      throw new Error('expected redraw map payload');
    }

    // `DoUpdateMap` in `ref/micropolis/src/sim/w_map.c` forces full redraw when
    // `NewMap` is set, and `sim_update_maps` in `ref/micropolis/src/sim/sim.c`
    // clears `NewMap` plus `NewMapFlags[0..NMAPS-1]` after each map-update cycle.
    expect(redrawMapPatch.tileWordDeltas).toHaveLength(0);
    expect(redrawMapPatch.redrawPlan).toEqual({
      reason: 'new-map',
      fullRedraw: true,
      dirtyRects: [],
    });
    expect(hostInternals.authorityState.simState.NewMap).toBe(0);
    expect(
      Array.from(hostInternals.authorityState.simState.NewMapFlags).every((flag) => flag === 0),
    ).toBe(true);
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
      payload: {
        hud: {
          speed: 0,
        },
      },
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
      payload: {
        hud: {
          speed: 0,
        },
      },
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
      payload: {
        hud: {
          speed: 0,
        },
      },
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
      payload: {
        hud: {
          speed: 3,
        },
      },
    });
  });

  it('queues pending sound events by authoritative tick and drains one tick at a time', () => {
    const host = new SimCoreEnvelopeHost();
    const hostInternals = host as unknown as {
      tick: number;
      realtimeContext: {
        onSound?: (channel: string, id: string) => void;
      };
      captureRealtimeSound(channel: string, soundSpec: string): void;
      captureSimCoreHookSound(channel: number, sound: number): void;
      drainPendingSoundDeltasForTick(tick?: number): HostSoundDeltaPayload[];
    };

    hostInternals.tick = 3;
    // Realtime sprite paths call `MakeSound("city", ...)` in `w_sprite.c`; sim-core
    // emits this through `createRealtimeContext(...).onSound(...)`.
    hostInternals.realtimeContext.onSound?.('city', 'Siren');
    // sim-core message sound hook ids:
    // channel `0` (city) and sound `6` (`Explosion-Low`) from
    // `packages/sim-core/src/systems/messages.ts`, mirroring `doMessage` in `s_msg.c`.
    hostInternals.captureSimCoreHookSound(0, 6);

    hostInternals.tick = 4;
    hostInternals.captureRealtimeSound('warning', 'UhUh');

    expect(hostInternals.drainPendingSoundDeltasForTick(3)).toEqual([
      {
        channel: 'city',
        soundSpec: 'Siren',
      },
      {
        channel: 'city',
        soundSpec: 'Explosion-Low',
      },
    ]);
    expect(hostInternals.drainPendingSoundDeltasForTick(3)).toEqual([]);
    expect(hostInternals.drainPendingSoundDeltasForTick(4)).toEqual([
      {
        channel: 'warning',
        soundSpec: 'UhUh',
      },
    ]);
  });

  it('emits queued sounds on the same command tick sequenced settlement', () => {
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);
    const hostInternals = host as unknown as {
      applyToolCommand(command: { kind: 'tool'; tool: 'query'; x: number; y: number }): {
        rejectReason: string | undefined;
        mapPatch: unknown;
      };
      captureRealtimeSound(channel: string, soundSpec: string): void;
    };
    const originalApplyToolCommand = hostInternals.applyToolCommand.bind(hostInternals);
    hostInternals.applyToolCommand = (command) => {
      // `MakeSound("city", "...")` can fire while handling one tool command in C;
      // this mirrors same-cycle queuing before command settlement envelopes.
      hostInternals.captureRealtimeSound('city', 'Siren');
      return originalApplyToolCommand(command);
    };

    captured.send({
      kind: 'hello',
      roomId: 'room-sound-same-cycle',
      clientId: 'client-sound-same-cycle',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });
    captured.send({
      kind: 'command',
      roomId: 'room-sound-same-cycle',
      clientId: 'client-sound-same-cycle',
      commandId: 'cmd-sound-same-cycle',
      command: {
        kind: 'tool',
        tool: 'query',
        x: 8,
        y: 8,
      },
    });

    const ackEnvelope = captured.envelopes[2];
    if (ackEnvelope === undefined || ackEnvelope.kind !== 'ack') {
      throw new Error('expected command ack envelope');
    }
    expect(readSoundDeltasFromEnvelope(ackEnvelope)).toEqual([
      {
        channel: 'city',
        soundSpec: 'Siren',
      },
    ]);

    const patchEnvelope = captured.envelopes[3];
    if (patchEnvelope === undefined || patchEnvelope.kind !== 'patch') {
      throw new Error('expected command patch envelope');
    }
    expect(readSoundDeltasFromEnvelope(patchEnvelope)).toBeNull();
    expect(ackEnvelope.tick).toBe(patchEnvelope.tick);
  });

  it('suppresses queued hook/realtime sound emission when simState.userSoundOn is false', () => {
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);
    const hostInternals = host as unknown as {
      authorityState: {
        simState: {
          userSoundOn: boolean;
        };
      };
      captureRealtimeSound(channel: string, soundSpec: string): void;
      captureSimCoreHookSound(channel: number, sound: number): void;
    };

    captured.send({
      kind: 'hello',
      roomId: 'room-sound-user-off',
      clientId: 'client-sound-user-off',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });

    // Mirrors `if (!UserSoundOn) return;` in `MakeSound` / `MakeSoundOn`
    // (`ref/micropolis/src/sim/w_sound.c`): no host sound deltas should queue.
    hostInternals.authorityState.simState.userSoundOn = false;
    hostInternals.captureRealtimeSound('city', 'Siren');
    // sim-core message hook ids `0` (city channel) + `4` (`Siren`) come from
    // `packages/sim-core/src/systems/messages.ts`, mirroring `s_msg.c` message sounds.
    hostInternals.captureSimCoreHookSound(0, 4);

    captured.send({
      kind: 'command',
      roomId: 'room-sound-user-off',
      clientId: 'client-sound-user-off',
      commandId: 'cmd-sound-user-off',
      command: {
        kind: 'tool',
        tool: 'query',
        x: 8,
        y: 8,
      },
    });

    const ackEnvelope = captured.envelopes[2];
    if (ackEnvelope === undefined || ackEnvelope.kind !== 'ack') {
      throw new Error('expected command ack envelope');
    }
    expect(readSoundDeltasFromEnvelope(ackEnvelope)).toBeNull();
  });

  it('drops unknown sim-core numeric sound ids from the pending tick queue', () => {
    const host = new SimCoreEnvelopeHost();
    const hostInternals = host as unknown as {
      tick: number;
      captureSimCoreHookSound(channel: number, sound: number): void;
      drainPendingSoundDeltasForTick(tick?: number): HostSoundDeltaPayload[];
    };

    hostInternals.tick = 8;
    // `99` channel/sound ids are outside the current sim-core message sound id domain
    // in `packages/sim-core/src/systems/messages.ts` and therefore should not queue.
    hostInternals.captureSimCoreHookSound(99, 4);
    hostInternals.captureSimCoreHookSound(0, 99);

    expect(hostInternals.drainPendingSoundDeltasForTick(8)).toEqual([]);
  });

  it('preserves replay-tail sound deltas even if a previously emitted envelope is mutated', () => {
    const roomId = 'room-sound-replay-tail';
    const clientId = 'client-sound-replay-tail';
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);
    const hostInternals = host as unknown as {
      emitSequencedEnvelope(envelope: {
        kind: 'ack';
        roomId: string;
        clientId: string;
        tick: number;
        commandId: string;
        soundDeltas?: readonly HostSoundDeltaPayload[];
      }): void;
    };

    captured.send({
      kind: 'hello',
      roomId,
      clientId,
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });

    const emittedSoundDeltas: readonly HostSoundDeltaPayload[] = [
      {
        channel: 'city',
        soundSpec: 'Siren',
        scope: { kind: 'view', target: '.playMap' },
      },
    ];
    const expectedReplaySoundDeltas = structuredClone(emittedSoundDeltas);
    hostInternals.emitSequencedEnvelope({
      kind: 'ack',
      roomId,
      clientId,
      tick: 1,
      commandId: 'cmd-sound-replay-tail',
      soundDeltas: emittedSoundDeltas,
    });

    const liveAck = captured.envelopes[2];
    if (liveAck === undefined || liveAck.kind !== 'ack') {
      throw new Error('expected live ack envelope');
    }
    const liveSoundDeltas = readSoundDeltasFromEnvelope(liveAck);
    if (liveSoundDeltas === null || liveSoundDeltas.length === 0) {
      throw new Error('expected live ack sound deltas');
    }
    const firstLiveSoundDelta = liveSoundDeltas[0];
    if (firstLiveSoundDelta === undefined) {
      throw new Error('expected first live sound delta');
    }
    firstLiveSoundDelta.soundSpec = 'mutated-live-sound';
    if (firstLiveSoundDelta.scope !== undefined) {
      firstLiveSoundDelta.scope.target = 'mutated-live-target';
    }

    captured.send({
      kind: 'request_snapshot',
      roomId,
      clientId,
      fromServerSeq: 1,
      reason: 'manual',
    });

    const replayAck = captured.envelopes[4];
    if (replayAck === undefined || replayAck.kind !== 'ack') {
      throw new Error('expected replay ack envelope');
    }
    expect(readSoundDeltasFromEnvelope(replayAck)).toEqual(expectedReplaySoundDeltas);
  });

  it('keeps resync sound deltas in request_snapshot replay tails', () => {
    const roomId = 'room-sound-replay-resync';
    const clientId = 'client-sound-replay-resync';
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);
    const hostInternals = host as unknown as {
      emitSequencedEnvelope(envelope: {
        kind: 'resync';
        roomId: string;
        clientId: string;
        tick: number;
        reason: string;
        soundDeltas?: readonly HostSoundDeltaPayload[];
      }): void;
    };

    captured.send({
      kind: 'hello',
      roomId,
      clientId,
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });

    const expectedSoundDeltas: readonly HostSoundDeltaPayload[] = [
      {
        channel: 'warning',
        soundSpec: 'Explosion High',
        scope: { kind: 'global' },
      },
    ];
    hostInternals.emitSequencedEnvelope({
      kind: 'resync',
      roomId,
      clientId,
      tick: 1,
      reason: 'server-gap',
      soundDeltas: expectedSoundDeltas,
    });

    captured.send({
      kind: 'request_snapshot',
      roomId,
      clientId,
      fromServerSeq: 1,
      reason: 'resync',
    });

    const replayResync = captured.envelopes[4];
    if (replayResync === undefined || replayResync.kind !== 'resync') {
      throw new Error('expected replay resync envelope');
    }
    expect(readSoundDeltasFromEnvelope(replayResync)).toEqual(expectedSoundDeltas);
  });

  it('reconstructs map/HUD/messages/realtime deterministically from snapshot baseline plus replay tail', () => {
    const roomId = 'room-replay-reconstruct';
    const clientId = 'client-replay-reconstruct';
    const host = new SimCoreEnvelopeHost();
    const captured = connectAndCapture(host);
    const hostInternals = host as unknown as {
      authorityState: {
        store: {
          beginTick(): void;
          commitTick(): void;
          getLayer(layer: 'map'): Uint16Array | unknown;
        };
        simState: Parameters<typeof sendMes>[0];
        simContext: Parameters<typeof sendMes>[1];
      };
    };
    const roadX = 24;
    const roadY = 24;
    const roadIndex = roadX * World.WORLD_Y + roadY;

    hostInternals.authorityState.store.beginTick();
    try {
      const mapLayer = hostInternals.authorityState.store.getLayer('map');
      if (!(mapLayer instanceof Uint16Array)) {
        throw new Error('expected map layer Uint16Array');
      }
      mapLayer[roadIndex] = Tile.DIRT | TileFlag.BULLBIT | TileFlag.BURNBIT;
    } finally {
      hostInternals.authorityState.store.commitTick();
    }

    captured.send({
      kind: 'hello',
      roomId,
      clientId,
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });
    captured.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: 'cmd-road-replay-reconstruct',
      command: {
        kind: 'tool',
        tool: 'road',
        x: roadX,
        y: roadY,
      },
    });

    // Message-id source: `SendMessages` warning ids in `ref/micropolis/src/sim/s_msg.c`.
    expect(
      sendMesAt(
        hostInternals.authorityState.simState,
        hostInternals.authorityState.simContext,
        14,
        9,
        11,
      ),
    ).toBe(true);
    captured.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: 'cmd-pause-replay-reconstruct',
      command: {
        kind: 'sim-control',
        control: 'pause',
      },
    });

    hostInternals.authorityState.simContext.hooks.generateCopter();
    captured.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: 'cmd-play-replay-reconstruct',
      command: {
        kind: 'sim-control',
        control: 'play',
      },
    });

    const liveEnvelopes = captured.envelopes.slice();
    let liveState = createInitialWebRuntimeState({ roomId, clientId });
    for (const envelope of liveEnvelopes) {
      const reduction = reduceHostEnvelope(liveState, envelope);
      expect(reduction.outcome).toBe('applied');
      liveState = reduction.state;
    }

    const requestReplayFrom = (fromServerSeq: number): HostEnvelope[] => {
      const replayStart = captured.envelopes.length;
      captured.send({
        kind: 'request_snapshot',
        roomId,
        clientId,
        fromServerSeq,
        reason: 'manual',
      });
      return captured.envelopes.slice(replayStart);
    };
    const replayOne = requestReplayFrom(0);
    const replayTwo = requestReplayFrom(0);

    const reduceReplay = (replayEnvelopes: readonly HostEnvelope[]) => {
      let state = createInitialWebRuntimeState({ roomId, clientId });
      const helloEnvelope = liveEnvelopes[0];
      if (helloEnvelope === undefined || helloEnvelope.kind !== 'hello') {
        throw new Error('expected initial hello envelope for replay reconstruction');
      }
      const helloReduction = reduceHostEnvelope(state, helloEnvelope);
      expect(helloReduction.outcome).toBe('applied');
      state = helloReduction.state;
      for (const envelope of replayEnvelopes) {
        const reduction = reduceHostEnvelope(state, envelope);
        expect(reduction.outcome).toBe('applied');
        state = reduction.state;
      }
      return state;
    };
    const replayStateOne = reduceReplay(replayOne);
    const replayStateTwo = reduceReplay(replayTwo);

    const readComparableProjection = (state: ReturnType<typeof createInitialWebRuntimeState>) => ({
      map: {
        width: state.mapState.width,
        height: state.mapState.height,
        tiles: state.mapState.tiles,
      },
      hud: {
        fundsLabel: state.hudState.fundsLabel,
        dateLabel: state.hudState.dateLabel,
        demandLabel: state.hudState.demandLabel,
        speedLabel: state.hudState.speedLabel,
        options: state.hudState.options,
        messages: state.hudState.messages,
      },
      realtimeObjects: state.realtimeState.objects,
    });

    expect(readComparableProjection(replayStateOne)).toEqual(readComparableProjection(liveState));
    expect(readComparableProjection(replayStateTwo)).toEqual(readComparableProjection(liveState));

    // `ROADBASE` tile ids from `w_con.c` drive the placed-road map word, so
    // replay must reconstruct a non-dirt road tile at the command coordinate.
    const roadRowMajorIndex = roadY * liveState.mapState.width + roadX;
    expect(liveState.mapState.tiles[roadRowMajorIndex]).not.toBe(Tile.DIRT);
    expect(replayStateOne.mapState.tiles[roadRowMajorIndex]).toBe(
      liveState.mapState.tiles[roadRowMajorIndex],
    );
    expect(
      replayStateOne.hudState.messages.some((message) => message.id === 14 && message.x === 9),
    ).toBe(true);
    expect(replayStateOne.realtimeState.objects.some((object) => object.type === 2)).toBe(true);
  });

  it('keeps command settlement ordering deterministic across async scenario and later sync commands', async () => {
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
      roomId: 'room-command-ordering',
      clientId: 'client-command-ordering',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });
    captured.send({
      kind: 'command',
      roomId: 'room-command-ordering',
      clientId: 'client-command-ordering',
      commandId: 'cmd-load-scenario',
      command: {
        kind: 'scenario',
        action: 'load-scenario',
        scenarioId: scenario.id,
      },
    });
    captured.send({
      kind: 'command',
      roomId: 'room-command-ordering',
      clientId: 'client-command-ordering',
      commandId: 'cmd-pause-after-scenario',
      command: {
        kind: 'sim-control',
        control: 'pause',
      },
    });
    captured.send({
      kind: 'command',
      roomId: 'room-command-ordering',
      clientId: 'client-command-ordering',
      commandId: 'cmd-oob-query',
      command: {
        kind: 'tool',
        tool: 'query',
        x: -1,
        y: 8,
      },
    });

    // Mirrors serial `SimCmd` settlement ordering in `ref/micropolis/src/sim/w_sim.c`:
    // later commands do not settle before the earlier async scenario command completes.
    expect(captured.envelopes).toHaveLength(2);

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
    await Promise.resolve();

    expect(captured.envelopes[2]).toEqual({
      kind: 'ack',
      roomId: 'room-command-ordering',
      clientId: 'client-command-ordering',
      tick: 1,
      serverSeq: 2,
      commandId: 'cmd-load-scenario',
    });
    expect(captured.envelopes[3]).toMatchObject({
      kind: 'snapshot',
      roomId: 'room-command-ordering',
      clientId: 'client-command-ordering',
      tick: 1,
      serverSeq: 3,
    });
    expect(captured.envelopes[4]).toEqual({
      kind: 'ack',
      roomId: 'room-command-ordering',
      clientId: 'client-command-ordering',
      tick: 2,
      serverSeq: 4,
      commandId: 'cmd-pause-after-scenario',
    });
    expect(captured.envelopes[5]).toEqual({
      kind: 'patch',
      roomId: 'room-command-ordering',
      clientId: 'client-command-ordering',
      tick: 2,
      serverSeq: 5,
      payload: {
        hud: {
          speed: 0,
        },
      },
    });
    expect(captured.envelopes[6]).toEqual({
      kind: 'reject',
      roomId: 'room-command-ordering',
      clientId: 'client-command-ordering',
      tick: 3,
      serverSeq: 6,
      commandId: 'cmd-oob-query',
      reason: 'out-of-bounds',
    });
  });

  it('keeps scenario/save/load settlement ordering deterministic when scenario loading is async', async () => {
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
      roomId: 'room-async-io-ordering',
      clientId: 'client-async-io-ordering',
      protocolVersion: 'core-bridge/v1',
      coreVersion: 'test-core',
    });
    captured.send({
      kind: 'command',
      roomId: 'room-async-io-ordering',
      clientId: 'client-async-io-ordering',
      commandId: 'cmd-scenario-async',
      command: {
        kind: 'scenario',
        action: 'load-scenario',
        scenarioId: scenario.id,
      },
    });
    captured.send({
      kind: 'command',
      roomId: 'room-async-io-ordering',
      clientId: 'client-async-io-ordering',
      commandId: 'cmd-save-after-scenario',
      command: {
        kind: 'city-io',
        action: 'save-city',
        fileName: 'queued-save',
      },
    });
    captured.send({
      kind: 'command',
      roomId: 'room-async-io-ordering',
      clientId: 'client-async-io-ordering',
      commandId: 'cmd-load-invalid-after-save',
      command: {
        kind: 'city-io',
        action: 'load-city',
        fileName: 'broken.cty',
        cityBytes: new Uint8Array([1, 2, 3]),
      },
    });

    // Mirrors serial `SimCmd` settlement in `w_sim.c`: while `LoadScenario`
    // awaits bytes (`s_fileio.c`), later save/load commands remain queued.
    expect(captured.envelopes).toHaveLength(2);

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
    await Promise.resolve();

    expect(captured.envelopes[2]).toEqual({
      kind: 'ack',
      roomId: 'room-async-io-ordering',
      clientId: 'client-async-io-ordering',
      tick: 1,
      serverSeq: 2,
      commandId: 'cmd-scenario-async',
    });
    expect(captured.envelopes[3]).toMatchObject({
      kind: 'snapshot',
      roomId: 'room-async-io-ordering',
      clientId: 'client-async-io-ordering',
      tick: 1,
      serverSeq: 3,
    });
    expect(captured.envelopes[4]).toEqual({
      kind: 'ack',
      roomId: 'room-async-io-ordering',
      clientId: 'client-async-io-ordering',
      tick: 2,
      serverSeq: 4,
      commandId: 'cmd-save-after-scenario',
    });
    expect(captured.envelopes[5]).toMatchObject({
      kind: 'patch',
      roomId: 'room-async-io-ordering',
      clientId: 'client-async-io-ordering',
      tick: 2,
      serverSeq: 5,
    });
    const savePatch = captured.envelopes[5];
    if (savePatch === undefined || savePatch.kind !== 'patch') {
      throw new Error('expected save-city patch settlement');
    }
    expect(readSaveCityPayload(savePatch.payload)).not.toBeNull();
    expect(captured.envelopes[6]).toEqual({
      kind: 'reject',
      roomId: 'room-async-io-ordering',
      clientId: 'client-async-io-ordering',
      tick: 3,
      serverSeq: 6,
      commandId: 'cmd-load-invalid-after-save',
      reason: 'invalid-city-file',
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

    expect(playAck.tick).toBeGreaterThanOrEqual(scenarioAck.tick);
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
