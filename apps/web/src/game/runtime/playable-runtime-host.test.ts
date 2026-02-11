import { runInNewContext } from 'node:vm';

import { describe, expect, test, vi } from 'vitest';

import { getCoreBridgeV1SnapshotTileIndex } from '../../../../../packages/core-bridge/src/types.ts';
import {
  cityDimensionsForMap,
  Tile,
  TileMask,
  World,
} from '../../../../../packages/sim-core/src/index.ts';
import { getScenarioDefinition } from '../../../../../packages/sim-io/src/scenarios.ts';
import {
  createPlayableRuntimeHost,
  PLAYABLE_DISASTER_CHOICES,
  readCityExportPayload,
  triggerPlayableRuntimeDisaster,
} from './playable-runtime-host.ts';
import type {
  ClientEnvelope,
  CoreHost,
  HostAckEnvelope,
  HostEnvelope,
  HostPatchEnvelope,
  HostSnapshotEnvelope,
} from './protocol.ts';
import { createWebHostRuntime, type WebRuntimeEvent, type WebRuntimeState } from './runtime.ts';

/**
 * Wait for one host envelope that matches the provided predicate.
 * Mirrors async `LoadScenario` completion ordering in
 * `ref/micropolis/src/sim/s_fileio.c`, where the command settles after resource
 * bytes are loaded and applied.
 */
async function waitForHostEnvelope<TEnvelope extends HostEnvelope>(
  hostEnvelopes: readonly HostEnvelope[],
  predicate: (envelope: HostEnvelope) => envelope is TEnvelope,
  label: string,
): Promise<TEnvelope> {
  const timeoutMs = 5_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    for (let index = hostEnvelopes.length - 1; index >= 0; index -= 1) {
      const envelope = hostEnvelopes[index];
      if (envelope !== undefined && predicate(envelope)) {
        return envelope;
      }
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  throw new Error(`Timed out waiting for ${label}`);
}

type RuntimeEventWithEnvelope<TEnvelope extends HostEnvelope> = WebRuntimeEvent & {
  envelope: TEnvelope;
};

/**
 * Wait for one runtime event that matches the provided predicate.
 * Mirrors staged command->ack->snapshot sequencing from `SimCmd` and update
 * propagation in `ref/micropolis/src/sim/w_sim.c` / `ref/micropolis/src/sim/w_update.c`.
 */
async function waitForRuntimeEvent<TEvent extends WebRuntimeEvent>(
  runtimeEvents: readonly WebRuntimeEvent[],
  predicate: (event: WebRuntimeEvent) => event is TEvent,
  label: string,
): Promise<TEvent> {
  const timeoutMs = 5_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    for (let index = runtimeEvents.length - 1; index >= 0; index -= 1) {
      const event = runtimeEvents[index];
      if (event !== undefined && predicate(event)) {
        return event;
      }
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  throw new Error(`Timed out waiting for ${label}`);
}

/**
 * Reads the latest authoritative sequence cursor from host envelopes.
 * Mirrors bridge snapshot-resync cursor semantics in
 * `ref/micropolis/spec/integration/SPEC.md`.
 */
function readLatestServerSeq(hostEnvelopes: readonly HostEnvelope[]): number {
  let latestServerSeq = 0;
  for (const envelope of hostEnvelopes) {
    if ('serverSeq' in envelope && typeof envelope.serverSeq === 'number') {
      latestServerSeq = Math.max(latestServerSeq, envelope.serverSeq);
    }
  }
  return latestServerSeq;
}

type PlayableCertificationSingleTileTool = 'road' | 'rail' | 'wire' | 'bulldoze';
type PlayableCertificationSingleTileToolPlacements = Record<
  PlayableCertificationSingleTileTool,
  { x: number; y: number }
>;
// C `saveFile`/`_load_file` classic city dimensions in `ref/micropolis/src/sim/s_fileio.c`.
const PLAYABLE_CERT_CLASSIC_CITY_FILE_BYTE_LENGTH = cityDimensionsForMap(
  World.WORLD_X,
  World.WORLD_Y,
).byteLength;
// C `InitFunds()` initial city funds in `ref/micropolis/src/sim/s_init.c`.
const PLAYABLE_CERT_NEW_CITY_STARTING_FUNDS = 20_000;
// C `LoadScenario` applies `setSpeed(3)` in `ref/micropolis/src/sim/s_fileio.c`.
const PLAYABLE_CERT_LOAD_SCENARIO_DEFAULT_SPEED = 3;
const PLAYABLE_CERT_DULLSVILLE_SCENARIO = getScenarioDefinition(1);
// Magic numbers source: `LoadScenario` scenario-1 (`Dullsville`) constants in
// `ref/micropolis/src/sim/s_fileio.c`: year `1900`, funds `5000`.
const PLAYABLE_CERT_SCENARIO_START_CERTIFICATION = {
  scenarioId: PLAYABLE_CERT_DULLSVILLE_SCENARIO.id,
  startYear: PLAYABLE_CERT_DULLSVILLE_SCENARIO.startYear,
  startFunds: PLAYABLE_CERT_DULLSVILLE_SCENARIO.startFunds,
} as const;

function readFundsFromLabel(label: string): number {
  const digits = label.replaceAll(/[^0-9]/g, '');
  if (digits.length === 0) {
    return 0;
  }
  return Number.parseInt(digits, 10);
}

interface PlayableCertificationHostHudRestorationSignature {
  funds: number | undefined;
  dateMonth: number | undefined;
  dateYear: number | undefined;
  demandR: number | undefined;
  demandC: number | undefined;
  demandI: number | undefined;
  speed: number | undefined;
  autoBudget: boolean | undefined;
  autoGo: boolean | undefined;
  autoBulldoze: boolean | undefined;
  userSoundOn: boolean | undefined;
}

interface PlayableCertificationRuntimeHudRestorationSignature {
  fundsLabel: string;
  dateLabel: string;
  demandR: number;
  demandC: number;
  demandI: number;
  speed: number;
}

/**
 * Reads authoritative snapshot map tile words for Playable Certification save/load assertions.
 * Mirrors classic city map payload ownership in `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: accepts both canonical `tileWords` and legacy `tiles` snapshot fields.
 */
function readPlayableCertificationSnapshotTileWords(
  snapshot: HostSnapshotEnvelope,
  label: string,
): readonly number[] | Uint16Array {
  const map = snapshot.payload.map;
  if (map === undefined) {
    throw new Error(`${label} snapshot missing map payload`);
  }
  if ('tileWords' in map) {
    return map.tileWords;
  }
  if ('tiles' in map) {
    return map.tiles;
  }
  throw new Error(`${label} snapshot missing tile words`);
}

/**
 * Returns whether one map tile preserves baseline tool placement cost.
 * Mirrors `do_tool` pricing in `ref/micropolis/src/sim/w_tool.c`, where
 * non-dirt tiles can add extra clear/bulldoze costs on top of `CostOf[]`.
 */
function isPlayableCertificationCostNeutralTile(tileWord: number): boolean {
  const tileId = tileWord & TileMask.LOMASK;
  return tileId === Tile.DIRT;
}

/**
 * Finds deterministic single-tile placements for road/rail/wire/bulldoze cost checks.
 * Mirrors single-tile `do_tool` placement in `ref/micropolis/src/sim/w_tool.c`.
 * Parity note: selects dirt tiles only so assertions validate base `CostOf[]`
 * entries without incidental terrain-clear surcharges, and reads snapshot tiles
 * using bridge canonical index math (`x * height + y`).
 */
function readPlayableCertificationSingleTileToolPlacementsFromSnapshot(
  snapshot: HostSnapshotEnvelope,
  label: string,
): PlayableCertificationSingleTileToolPlacements {
  const map = snapshot.payload.map;
  if (map === undefined) {
    throw new Error(`${label} snapshot missing map payload`);
  }
  if (!Number.isInteger(map.width) || !Number.isInteger(map.height)) {
    throw new Error(`${label} snapshot has invalid map dimensions`);
  }

  const width = map.width;
  const height = map.height;
  const tileWords = readPlayableCertificationSnapshotTileWords(snapshot, label);
  const placements: Partial<PlayableCertificationSingleTileToolPlacements> = {};

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const tileWord = tileWords[getCoreBridgeV1SnapshotTileIndex(x, y, height)] ?? 0;
      if (!isPlayableCertificationCostNeutralTile(tileWord)) {
        continue;
      }
      if (placements.road === undefined) {
        placements.road = { x, y };
        continue;
      }
      if (placements.rail === undefined) {
        placements.rail = { x, y };
        continue;
      }
      if (placements.wire === undefined) {
        placements.wire = { x, y };
        placements.bulldoze = placements.road;
        return placements as PlayableCertificationSingleTileToolPlacements;
      }
    }
  }

  throw new Error(`${label} could not find valid single-tile placement coordinates`);
}

/**
 * Masks map words to Micropolis identity bits for load restoration parity checks.
 * Mirrors `LOMASK` tile identity usage in `ref/micropolis/src/sim/g_bigmap.c`.
 * Parity note: `DoSimInit` can rewrite non-identity flag bits after `loadFile`.
 */
function maskPlayableCertificationTileIdentities(
  tileWords: readonly number[] | Uint16Array,
): number[] {
  return Array.from(tileWords, (tileWord) => tileWord & TileMask.LOMASK);
}

/**
 * Captures host HUD heads used to certify save/load round-trip restoration.
 * Mirrors `DoUpdateHeads` scalar projections in `ref/micropolis/src/sim/w_update.c`.
 */
function readPlayableCertificationHostHudRestorationSignature(
  snapshot: HostSnapshotEnvelope,
): PlayableCertificationHostHudRestorationSignature {
  return {
    funds: snapshot.payload.hud?.funds,
    dateMonth: snapshot.payload.hud?.date?.month,
    dateYear: snapshot.payload.hud?.date?.year,
    demandR: snapshot.payload.hud?.demand?.r,
    demandC: snapshot.payload.hud?.demand?.c,
    demandI: snapshot.payload.hud?.demand?.i,
    speed: snapshot.payload.hud?.speed,
    autoBudget: snapshot.payload.hud?.options?.autoBudget,
    autoGo: snapshot.payload.hud?.options?.autoGo,
    autoBulldoze: snapshot.payload.hud?.options?.autoBulldoze,
    userSoundOn: snapshot.payload.hud?.options?.userSoundOn,
  };
}

/**
 * Captures shipped runtime HUD heads used to certify save/load restoration.
 * Mirrors projected `UISet*` heads flow from `ref/micropolis/src/sim/w_update.c`.
 */
function readPlayableCertificationRuntimeHudRestorationSignature(
  state: WebRuntimeState,
): PlayableCertificationRuntimeHudRestorationSignature {
  return {
    fundsLabel: state.hudState.fundsLabel,
    dateLabel: state.hudState.dateLabel,
    demandR: state.hudState.demandR,
    demandC: state.hudState.demandC,
    demandI: state.hudState.demandI,
    speed: state.hudState.speed,
  };
}

interface PlayableRuntimeSmokeSummary {
  envelopeKinds: HostEnvelope['kind'][];
  finalServerSeq: number;
  ackCount: number;
  patchCount: number;
  snapshotCount: number;
  rejectReasons: string[];
}

/**
 * Certifies Playable Certification `.cty` save->mutate->load full restoration on host envelopes.
 * Mirrors `SaveCityAs`/`loadFile` round-trip semantics in
 * `ref/micropolis/src/sim/s_fileio.c`.
 */
async function certifyPlayableCertificationCityRoundTripRestorationOnHost(
  runId: string,
): Promise<void> {
  const host = createPlayableRuntimeHost();
  const hostEnvelopes: HostEnvelope[] = [];
  const roomId = `${runId}-room`;
  const clientId = `${runId}-client`;
  const commandIds = {
    road: `${runId}-cmd-road`,
    wire: `${runId}-cmd-wire`,
    save: `${runId}-cmd-save`,
    bulldoze: `${runId}-cmd-bulldoze`,
    load: `${runId}-cmd-load`,
  } as const;
  const connection = host.connect((envelope) => {
    hostEnvelopes.push(envelope);
  });

  try {
    connection.send({
      kind: 'hello',
      roomId,
      clientId,
      protocolVersion: 'bridge-v1',
      coreVersion: 'sim-core',
    });
    await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostSnapshotEnvelope => envelope.kind === 'snapshot',
      `${runId} boot snapshot`,
    );

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.road,
      command: {
        kind: 'tool',
        tool: 'road',
        x: 10,
        y: 10,
      },
    });
    const roadAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === commandIds.road,
      `${runId} road ack`,
    );
    await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostPatchEnvelope =>
        envelope.kind === 'patch' &&
        envelope.serverSeq > roadAck.serverSeq &&
        envelope.payload.hud?.funds !== undefined,
      `${runId} road funds patch`,
    );

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.wire,
      command: {
        kind: 'tool',
        tool: 'wire',
        x: 11,
        y: 10,
      },
    });
    const wireAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === commandIds.wire,
      `${runId} wire ack`,
    );
    await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostPatchEnvelope =>
        envelope.kind === 'patch' &&
        envelope.serverSeq > wireAck.serverSeq &&
        envelope.payload.hud?.funds !== undefined,
      `${runId} wire funds patch`,
    );

    const preSaveServerSeq = readLatestServerSeq(hostEnvelopes);
    connection.send({
      kind: 'request_snapshot',
      roomId,
      clientId,
      fromServerSeq: preSaveServerSeq,
      reason: 'manual',
    });
    const preSaveSnapshot = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostSnapshotEnvelope =>
        envelope.kind === 'snapshot' && envelope.serverSeq > preSaveServerSeq,
      `${runId} pre-save snapshot`,
    );
    const preSaveMaskedTiles = maskPlayableCertificationTileIdentities(
      readPlayableCertificationSnapshotTileWords(preSaveSnapshot, `${runId} pre-save`),
    );
    const preSaveHud = readPlayableCertificationHostHudRestorationSignature(preSaveSnapshot);

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.save,
      command: {
        kind: 'city-io',
        action: 'save-city',
        fileName: 'playable-cert-roundtrip.cty',
      },
    });
    const saveAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === commandIds.save,
      `${runId} save ack`,
    );
    const savePatch = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostPatchEnvelope =>
        envelope.kind === 'patch' &&
        envelope.serverSeq > saveAck.serverSeq &&
        readCityExportPayload(envelope.payload) !== null,
      `${runId} save patch`,
    );
    const savePayload = readCityExportPayload(savePatch.payload);
    if (savePayload === null) {
      throw new Error(`${runId} expected save payload`);
    }
    // Magic-number source: classic `.cty` city payload byte count in `saveFile`
    // from `ref/micropolis/src/sim/s_fileio.c`.
    expect(savePayload.cityBytes.byteLength).toBe(PLAYABLE_CERT_CLASSIC_CITY_FILE_BYTE_LENGTH);

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.bulldoze,
      command: {
        kind: 'tool',
        tool: 'bulldoze',
        x: 10,
        y: 10,
      },
    });
    const bulldozeAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === commandIds.bulldoze,
      `${runId} mutate-city bulldoze ack`,
    );
    await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostPatchEnvelope =>
        envelope.kind === 'patch' &&
        envelope.serverSeq > bulldozeAck.serverSeq &&
        envelope.payload.hud?.funds !== undefined,
      `${runId} mutate-city bulldoze funds patch`,
    );
    const mutatedServerSeq = readLatestServerSeq(hostEnvelopes);
    connection.send({
      kind: 'request_snapshot',
      roomId,
      clientId,
      fromServerSeq: mutatedServerSeq,
      reason: 'manual',
    });
    const mutatedSnapshot = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostSnapshotEnvelope =>
        envelope.kind === 'snapshot' && envelope.serverSeq > mutatedServerSeq,
      `${runId} mutated snapshot`,
    );
    expect(
      maskPlayableCertificationTileIdentities(
        readPlayableCertificationSnapshotTileWords(mutatedSnapshot, `${runId} mutated`),
      ),
    ).not.toEqual(preSaveMaskedTiles);
    expect(readPlayableCertificationHostHudRestorationSignature(mutatedSnapshot)).not.toEqual(
      preSaveHud,
    );

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.load,
      command: {
        kind: 'city-io',
        action: 'load-city',
        fileName: 'playable-cert-roundtrip.cty',
        cityBytes: savePayload.cityBytes,
      },
    });
    const loadAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === commandIds.load,
      `${runId} load ack`,
    );
    const restoredSnapshot = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostSnapshotEnvelope =>
        envelope.kind === 'snapshot' && envelope.serverSeq > loadAck.serverSeq,
      `${runId} restored snapshot`,
    );

    expect(
      maskPlayableCertificationTileIdentities(
        readPlayableCertificationSnapshotTileWords(restoredSnapshot, `${runId} load`),
      ),
    ).toEqual(preSaveMaskedTiles);
    expect(readPlayableCertificationHostHudRestorationSignature(restoredSnapshot)).toEqual(
      preSaveHud,
    );
  } finally {
    connection.disconnect();
  }
}

/**
 * Certifies Playable Certification `.cty` save->mutate->load full restoration on the shipped runtime path.
 * Mirrors browser-command save/load flow mapped from `SaveCityAs`/`loadFile` in
 * `ref/micropolis/src/sim/s_fileio.c`.
 */
async function certifyPlayableCertificationCityRoundTripRestorationOnRuntime(
  runId: string,
): Promise<void> {
  const roomId = `${runId}-room`;
  const clientId = `${runId}-client`;
  const commandIds = {
    road: `${runId}-cmd-road`,
    wire: `${runId}-cmd-wire`,
    save: `${runId}-cmd-save`,
    bulldoze: `${runId}-cmd-bulldoze`,
    load: `${runId}-cmd-load`,
  } as const;
  const runtimeEvents: WebRuntimeEvent[] = [];
  const runtime = createWebHostRuntime({
    host: createPlayableRuntimeHost(),
    roomId,
    clientId,
  });
  const unsubscribe = runtime.subscribe((event) => {
    runtimeEvents.push(event);
  });

  try {
    runtime.connect();
    await waitForRuntimeEvent(
      runtimeEvents,
      (event): event is RuntimeEventWithEnvelope<HostSnapshotEnvelope> =>
        event.envelope?.kind === 'snapshot',
      `${runId} boot snapshot`,
    );

    runtime.sendCommand(commandIds.road, {
      kind: 'tool',
      tool: 'road',
      x: 10,
      y: 10,
    });
    const roadAck = await waitForRuntimeEvent(
      runtimeEvents,
      (event): event is RuntimeEventWithEnvelope<HostAckEnvelope> =>
        event.envelope?.kind === 'ack' && event.envelope.commandId === commandIds.road,
      `${runId} road ack`,
    );
    await waitForRuntimeEvent(
      runtimeEvents,
      (event): event is RuntimeEventWithEnvelope<HostPatchEnvelope> =>
        event.envelope?.kind === 'patch' &&
        event.envelope.serverSeq > roadAck.envelope.serverSeq &&
        event.envelope.payload.hud?.funds !== undefined,
      `${runId} road funds patch`,
    );

    runtime.sendCommand(commandIds.wire, {
      kind: 'tool',
      tool: 'wire',
      x: 11,
      y: 10,
    });
    const wireAck = await waitForRuntimeEvent(
      runtimeEvents,
      (event): event is RuntimeEventWithEnvelope<HostAckEnvelope> =>
        event.envelope?.kind === 'ack' && event.envelope.commandId === commandIds.wire,
      `${runId} wire ack`,
    );
    await waitForRuntimeEvent(
      runtimeEvents,
      (event): event is RuntimeEventWithEnvelope<HostPatchEnvelope> =>
        event.envelope?.kind === 'patch' &&
        event.envelope.serverSeq > wireAck.envelope.serverSeq &&
        event.envelope.payload.hud?.funds !== undefined,
      `${runId} wire funds patch`,
    );

    const preSaveState = runtime.getState();
    const preSaveMaskedTiles = maskPlayableCertificationTileIdentities(preSaveState.mapState.tiles);
    const preSaveHud = readPlayableCertificationRuntimeHudRestorationSignature(preSaveState);

    runtime.sendCommand(commandIds.save, {
      kind: 'city-io',
      action: 'save-city',
      fileName: 'playable-cert-roundtrip.cty',
    });
    const saveAck = await waitForRuntimeEvent(
      runtimeEvents,
      (event): event is RuntimeEventWithEnvelope<HostAckEnvelope> =>
        event.envelope?.kind === 'ack' && event.envelope.commandId === commandIds.save,
      `${runId} save ack`,
    );
    const savePatch = await waitForRuntimeEvent(
      runtimeEvents,
      (event): event is RuntimeEventWithEnvelope<HostPatchEnvelope> =>
        event.envelope?.kind === 'patch' &&
        event.envelope.serverSeq > saveAck.envelope.serverSeq &&
        readCityExportPayload(event.envelope.payload) !== null,
      `${runId} save patch`,
    );
    const savePayload = readCityExportPayload(savePatch.envelope.payload);
    if (savePayload === null) {
      throw new Error(`${runId} expected save payload`);
    }
    expect(savePayload.cityBytes.byteLength).toBe(PLAYABLE_CERT_CLASSIC_CITY_FILE_BYTE_LENGTH);

    runtime.sendCommand(commandIds.bulldoze, {
      kind: 'tool',
      tool: 'bulldoze',
      x: 10,
      y: 10,
    });
    const bulldozeAck = await waitForRuntimeEvent(
      runtimeEvents,
      (event): event is RuntimeEventWithEnvelope<HostAckEnvelope> =>
        event.envelope?.kind === 'ack' && event.envelope.commandId === commandIds.bulldoze,
      `${runId} mutate-city bulldoze ack`,
    );
    await waitForRuntimeEvent(
      runtimeEvents,
      (event): event is RuntimeEventWithEnvelope<HostPatchEnvelope> =>
        event.envelope?.kind === 'patch' &&
        event.envelope.serverSeq > bulldozeAck.envelope.serverSeq &&
        event.envelope.payload.hud?.funds !== undefined,
      `${runId} mutate-city bulldoze funds patch`,
    );
    const mutatedState = runtime.getState();
    expect(maskPlayableCertificationTileIdentities(mutatedState.mapState.tiles)).not.toEqual(
      preSaveMaskedTiles,
    );
    expect(readPlayableCertificationRuntimeHudRestorationSignature(mutatedState)).not.toEqual(
      preSaveHud,
    );

    runtime.sendCommand(commandIds.load, {
      kind: 'city-io',
      action: 'load-city',
      fileName: 'playable-cert-roundtrip.cty',
      cityBytes: savePayload.cityBytes,
    });
    const loadAck = await waitForRuntimeEvent(
      runtimeEvents,
      (event): event is RuntimeEventWithEnvelope<HostAckEnvelope> =>
        event.envelope?.kind === 'ack' && event.envelope.commandId === commandIds.load,
      `${runId} load ack`,
    );
    await waitForRuntimeEvent(
      runtimeEvents,
      (event): event is RuntimeEventWithEnvelope<HostSnapshotEnvelope> =>
        event.envelope?.kind === 'snapshot' &&
        event.envelope.serverSeq > loadAck.envelope.serverSeq,
      `${runId} restored snapshot`,
    );
    const restoredState = runtime.getState();
    expect(maskPlayableCertificationTileIdentities(restoredState.mapState.tiles)).toEqual(
      preSaveMaskedTiles,
    );
    expect(readPlayableCertificationRuntimeHudRestorationSignature(restoredState)).toEqual(
      preSaveHud,
    );
  } finally {
    unsubscribe();
    runtime.disconnect();
  }
}

/**
 * Certifies Playable Certification scenario start year/funds on host envelopes.
 * Mirrors `LoadScenario` scenario metadata initialization in
 * `ref/micropolis/src/sim/s_fileio.c` (`CityTime` year + `TotalFunds`).
 */
async function certifyPlayableCertificationScenarioStartOnHost(runId: string): Promise<void> {
  const host = createPlayableRuntimeHost();
  const hostEnvelopes: HostEnvelope[] = [];
  const roomId = `${runId}-room`;
  const clientId = `${runId}-client`;
  const commandId = `${runId}-cmd-scenario-start`;
  const connection = host.connect((envelope) => {
    hostEnvelopes.push(envelope);
  });

  try {
    connection.send({
      kind: 'hello',
      roomId,
      clientId,
      protocolVersion: 'bridge-v1',
      coreVersion: 'sim-core',
    });
    await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostSnapshotEnvelope => envelope.kind === 'snapshot',
      `${runId} boot snapshot`,
    );

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId,
      command: {
        kind: 'scenario',
        action: 'load-scenario',
        scenarioId: PLAYABLE_CERT_SCENARIO_START_CERTIFICATION.scenarioId,
      },
    });
    const scenarioAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === commandId,
      `${runId} scenario ack`,
    );
    const scenarioSnapshot = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostSnapshotEnvelope =>
        envelope.kind === 'snapshot' && envelope.serverSeq > scenarioAck.serverSeq,
      `${runId} scenario snapshot`,
    );

    expect(scenarioSnapshot.payload.hud?.funds).toBe(
      PLAYABLE_CERT_SCENARIO_START_CERTIFICATION.startFunds,
    );
    expect(scenarioSnapshot.payload.hud?.date?.year).toBe(
      PLAYABLE_CERT_SCENARIO_START_CERTIFICATION.startYear,
    );
  } finally {
    connection.disconnect();
  }
}

/**
 * Certifies Playable Certification scenario start year/funds on the shipped runtime path.
 * Mirrors `LoadScenario` start-year/funds projection in
 * `ref/micropolis/src/sim/s_fileio.c` through Authoritative Runtime HUD runtime state.
 */
async function certifyPlayableCertificationScenarioStartOnRuntime(runId: string): Promise<void> {
  const roomId = `${runId}-room`;
  const clientId = `${runId}-client`;
  const commandId = `${runId}-cmd-scenario-start`;
  const runtimeEvents: WebRuntimeEvent[] = [];
  const runtime = createWebHostRuntime({
    host: createPlayableRuntimeHost(),
    roomId,
    clientId,
  });
  const unsubscribe = runtime.subscribe((event) => {
    runtimeEvents.push(event);
  });

  try {
    runtime.connect();
    await waitForRuntimeEvent(
      runtimeEvents,
      (event): event is RuntimeEventWithEnvelope<HostSnapshotEnvelope> =>
        event.envelope?.kind === 'snapshot',
      `${runId} boot snapshot`,
    );

    runtime.sendCommand(commandId, {
      kind: 'scenario',
      action: 'load-scenario',
      scenarioId: PLAYABLE_CERT_SCENARIO_START_CERTIFICATION.scenarioId,
    });
    const scenarioAck = await waitForRuntimeEvent(
      runtimeEvents,
      (event): event is RuntimeEventWithEnvelope<HostAckEnvelope> =>
        event.envelope?.kind === 'ack' && event.envelope.commandId === commandId,
      `${runId} scenario ack`,
    );
    await waitForRuntimeEvent(
      runtimeEvents,
      (event): event is RuntimeEventWithEnvelope<HostSnapshotEnvelope> =>
        event.envelope?.kind === 'snapshot' &&
        event.envelope.serverSeq > scenarioAck.envelope.serverSeq,
      `${runId} scenario snapshot`,
    );

    const state = runtime.getState();
    expect(readFundsFromLabel(state.hudState.fundsLabel)).toBe(
      PLAYABLE_CERT_SCENARIO_START_CERTIFICATION.startFunds,
    );
    expect(state.hudState.dateYear).toBe(PLAYABLE_CERT_SCENARIO_START_CERTIFICATION.startYear);
  } finally {
    unsubscribe();
    runtime.disconnect();
  }
}

/**
 * Runs one Authoritative Runtime default-host smoke flow and returns deterministic envelope summary data.
 * Mirrors `SimCmd`/`LoadScenario`/save-load command completion flow in
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: this is a test harness wrapper over bridge envelopes; runtime behavior is unchanged.
 */
async function runPlayableRuntimeSmokeFlow(runId: string): Promise<PlayableRuntimeSmokeSummary> {
  const host = createPlayableRuntimeHost();
  const hostEnvelopes: HostEnvelope[] = [];
  const roomId = `${runId}-room`;
  const clientId = `${runId}-client`;
  const commandIds = {
    newCity: `${runId}-cmd-new-city`,
    road: `${runId}-cmd-road`,
    speedOne: `${runId}-cmd-speed-one`,
    pause: `${runId}-cmd-pause`,
    play: `${runId}-cmd-play`,
    speedThree: `${runId}-cmd-speed-three`,
    save: `${runId}-cmd-save`,
    bulldoze: `${runId}-cmd-bulldoze`,
    load: `${runId}-cmd-load`,
    scenario: `${runId}-cmd-scenario`,
    invalid: `${runId}-cmd-invalid`,
  } as const;
  const connection = host.connect((envelope) => {
    hostEnvelopes.push(envelope);
  });

  try {
    connection.send({
      kind: 'hello',
      roomId,
      clientId,
      protocolVersion: 'bridge-v1',
      coreVersion: 'sim-core',
    });
    expect(hostEnvelopes[0]).toMatchObject({
      kind: 'hello',
      accepted: true,
    });

    const bootSnapshot = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostSnapshotEnvelope => envelope.kind === 'snapshot',
      `${runId} boot snapshot`,
    );
    expect(bootSnapshot.tick).toBe(0);
    expect(bootSnapshot.serverSeq).toBe(1);
    // Magic number source: initial city funds baseline in `setAnyCityName` /
    // `DoSimInit` bootstrap flow in `ref/micropolis/src/sim/s_init.c`.
    expect(bootSnapshot.payload.hud?.funds).toBe(20_000);
    expect(bootSnapshot.payload.map?.width).toBeGreaterThan(0);
    expect(bootSnapshot.payload.map?.height).toBeGreaterThan(0);
    expect(bootSnapshot.payload.hud?.speed).toBeGreaterThan(0);

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.newCity,
      command: {
        kind: 'city-lifecycle',
        action: 'new-city',
      },
    });
    const newCityAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === commandIds.newCity,
      `${runId} new-city ack`,
    );
    const newCitySnapshot = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostSnapshotEnvelope =>
        envelope.kind === 'snapshot' && envelope.serverSeq > newCityAck.serverSeq,
      `${runId} new-city snapshot`,
    );
    const singleTilePlacements = readPlayableCertificationSingleTileToolPlacementsFromSnapshot(
      newCitySnapshot,
      `${runId} smoke new-city`,
    );

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.road,
      command: {
        kind: 'tool',
        tool: 'road',
        x: singleTilePlacements.road.x,
        y: singleTilePlacements.road.y,
      },
    });

    const roadAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === commandIds.road,
      `${runId} road command ack`,
    );
    const roadFundsPatch = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostPatchEnvelope =>
        envelope.kind === 'patch' &&
        envelope.serverSeq > roadAck.serverSeq &&
        envelope.payload.hud?.funds !== undefined,
      `${runId} road funds patch`,
    );
    const fundsAfterRoad = roadFundsPatch.payload.hud?.funds;
    if (fundsAfterRoad === undefined) {
      throw new Error(`${runId} expected road funds update`);
    }
    expect(fundsAfterRoad).toBeLessThan(PLAYABLE_CERT_NEW_CITY_STARTING_FUNDS);

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.speedOne,
      command: {
        kind: 'sim-control',
        control: 'set-speed',
        speed: 1,
      },
    });
    const speedOneAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === commandIds.speedOne,
      `${runId} speed 1 ack`,
    );
    await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostPatchEnvelope =>
        envelope.kind === 'patch' && envelope.serverSeq > speedOneAck.serverSeq,
      `${runId} speed 1 patch`,
    );

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.pause,
      command: {
        kind: 'sim-control',
        control: 'pause',
      },
    });
    const pauseAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === commandIds.pause,
      `${runId} pause ack`,
    );
    await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostPatchEnvelope =>
        envelope.kind === 'patch' && envelope.serverSeq > pauseAck.serverSeq,
      `${runId} pause patch`,
    );

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.play,
      command: {
        kind: 'sim-control',
        control: 'play',
      },
    });
    const playAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === commandIds.play,
      `${runId} play ack`,
    );
    await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostPatchEnvelope =>
        envelope.kind === 'patch' && envelope.serverSeq > playAck.serverSeq,
      `${runId} play patch`,
    );

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.speedThree,
      command: {
        kind: 'sim-control',
        control: 'set-speed',
        speed: 3,
      },
    });
    const speedThreeAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === commandIds.speedThree,
      `${runId} speed 3 ack`,
    );
    await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostPatchEnvelope =>
        envelope.kind === 'patch' && envelope.serverSeq > speedThreeAck.serverSeq,
      `${runId} speed 3 patch`,
    );

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.save,
      command: {
        kind: 'city-io',
        action: 'save-city',
        fileName: 'playable-runtime-smoke.cty',
      },
    });

    const savePatch = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostPatchEnvelope =>
        envelope.kind === 'patch' && readCityExportPayload(envelope.payload) !== null,
      `${runId} save-city patch payload`,
    );

    const savePayload = readCityExportPayload(savePatch.payload);
    expect(savePayload).not.toBeNull();
    if (savePayload === null) {
      throw new Error('Expected Authoritative Runtime save payload');
    }

    // Magic number source: `.cty` city payload byte count in `s_fileio.c`.
    expect(savePayload.cityBytes.byteLength).toBe(PLAYABLE_CERT_CLASSIC_CITY_FILE_BYTE_LENGTH);

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.bulldoze,
      command: {
        kind: 'tool',
        tool: 'bulldoze',
        x: singleTilePlacements.bulldoze.x,
        y: singleTilePlacements.bulldoze.y,
      },
    });
    const bulldozeAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === commandIds.bulldoze,
      `${runId} bulldoze ack`,
    );
    const bulldozeFundsPatch = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostPatchEnvelope =>
        envelope.kind === 'patch' &&
        envelope.serverSeq > bulldozeAck.serverSeq &&
        envelope.payload.hud?.funds !== undefined,
      `${runId} bulldoze funds patch`,
    );
    expect((bulldozeFundsPatch.payload.hud?.funds ?? 0) < fundsAfterRoad).toBe(true);

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.load,
      command: {
        kind: 'city-io',
        action: 'load-city',
        fileName: 'playable-runtime-smoke.cty',
        cityBytes: savePayload.cityBytes,
      },
    });
    const loadAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === commandIds.load,
      `${runId} load-city ack`,
    );
    const loadSnapshot = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostSnapshotEnvelope =>
        envelope.kind === 'snapshot' && envelope.serverSeq > loadAck.serverSeq,
      `${runId} load-city snapshot`,
    );
    // `SaveCityAs`/`loadFile` in `s_fileio.c` restores the saved funds value.
    expect(loadSnapshot.payload.hud?.funds).toBe(fundsAfterRoad);

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.scenario,
      command: {
        kind: 'scenario',
        action: 'load-scenario',
        scenarioId: PLAYABLE_CERT_SCENARIO_START_CERTIFICATION.scenarioId,
      },
    });
    const scenarioAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === commandIds.scenario,
      `${runId} scenario ack`,
    );
    const scenarioSnapshot = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostSnapshotEnvelope =>
        envelope.kind === 'snapshot' && envelope.serverSeq > scenarioAck.serverSeq,
      `${runId} scenario snapshot`,
    );
    // Magic numbers source: scenario 1 (`Dullsville`) metadata constants in
    // `LoadScenario` (`ref/micropolis/src/sim/s_fileio.c`): funds=5000, year=1900.
    expect(scenarioSnapshot.payload.hud?.funds).toBe(
      PLAYABLE_CERT_SCENARIO_START_CERTIFICATION.startFunds,
    );
    expect(scenarioSnapshot.payload.hud?.date?.year).toBe(
      PLAYABLE_CERT_SCENARIO_START_CERTIFICATION.startYear,
    );
    // Magic number source: `LoadScenario` applies visible speed `3` after init
    // in `ref/micropolis/src/sim/s_fileio.c`.
    expect(scenarioSnapshot.payload.hud?.speed).toBe(PLAYABLE_CERT_LOAD_SCENARIO_DEFAULT_SPEED);

    const lastServerSeq = readLatestServerSeq(hostEnvelopes);
    connection.send({
      kind: 'request_snapshot',
      roomId,
      clientId,
      fromServerSeq: lastServerSeq,
      reason: 'resync',
    });
    const resyncSnapshot = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostSnapshotEnvelope =>
        envelope.kind === 'snapshot' && envelope.serverSeq > lastServerSeq,
      `${runId} resync snapshot`,
    );
    expect(resyncSnapshot.serverSeq).toBeGreaterThan(lastServerSeq);
    expect(resyncSnapshot.payload.hud?.funds).toBe(
      PLAYABLE_CERT_SCENARIO_START_CERTIFICATION.startFunds,
    );

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.invalid,
      command: {
        kind: 'invalid-kind',
      },
    } as unknown as ClientEnvelope);

    expect(hostEnvelopes.some((envelope) => envelope.kind === 'ack')).toBe(true);
    expect(
      hostEnvelopes.some(
        (envelope) =>
          envelope.kind === 'reject' &&
          envelope.commandId === commandIds.invalid &&
          envelope.reason === 'invalid-command',
      ),
    ).toBe(true);

    return {
      envelopeKinds: hostEnvelopes.map((envelope) => envelope.kind),
      finalServerSeq: readLatestServerSeq(hostEnvelopes),
      ackCount: hostEnvelopes.filter((envelope) => envelope.kind === 'ack').length,
      patchCount: hostEnvelopes.filter((envelope) => envelope.kind === 'patch').length,
      snapshotCount: hostEnvelopes.filter((envelope) => envelope.kind === 'snapshot').length,
      rejectReasons: hostEnvelopes
        .filter((envelope): envelope is Extract<HostEnvelope, { kind: 'reject' }> => {
          return envelope.kind === 'reject';
        })
        .map((envelope) => envelope.reason),
    };
  } finally {
    connection.disconnect();
  }
}

/**
 * Command-surface smoke for the Authoritative Runtime default host factory.
 * Mirrors `SimCmd` table routing intent in `ref/micropolis/src/sim/w_sim.c`,
 * where tool/sim/lifecycle/io subcommands all flow through one command surface.
 * Parity note: typed envelopes replace Tcl argv dispatch.
 */
describe('createPlayableRuntimeHost', () => {
  test('advances authoritative tick from ambient host timer without commands', () => {
    vi.useFakeTimers();
    const host = createPlayableRuntimeHost();
    const hostEnvelopes: HostEnvelope[] = [];
    const roomId = 'playable-cert-ambient-time-room';
    const clientId = 'playable-cert-ambient-time-client';
    const connection = host.connect((envelope) => {
      hostEnvelopes.push(envelope);
    });

    try {
      connection.send({
        kind: 'hello',
        roomId,
        clientId,
        protocolVersion: 'bridge-v1',
        coreVersion: 'sim-core',
      });

      const initialSnapshot = hostEnvelopes.find(
        (envelope): envelope is HostSnapshotEnvelope => envelope.kind === 'snapshot',
      );
      if (initialSnapshot === undefined) {
        throw new Error('expected initial snapshot before ambient progression');
      }

      vi.advanceTimersByTime(1_000);

      const latestTick = hostEnvelopes.reduce((highestTick, envelope) => {
        if ('tick' in envelope) {
          return Math.max(highestTick, envelope.tick);
        }
        return highestTick;
      }, 0);
      expect(latestTick).toBeGreaterThan(initialSnapshot.tick);
      expect(hostEnvelopes.some((envelope) => envelope.kind === 'patch')).toBe(true);
    } finally {
      connection.disconnect();
      vi.useRealTimers();
    }
  });

  test('certifies new-city snapshot loads authoritative map and HUD heads', async () => {
    const host = createPlayableRuntimeHost();
    const hostEnvelopes: HostEnvelope[] = [];
    const runId = 'playable-cert-new-city-map-hud';
    const roomId = `${runId}-room`;
    const clientId = `${runId}-client`;
    const commandId = `${runId}-cmd-new-city`;
    const connection = host.connect((envelope) => {
      hostEnvelopes.push(envelope);
    });

    try {
      connection.send({
        kind: 'hello',
        roomId,
        clientId,
        protocolVersion: 'bridge-v1',
        coreVersion: 'sim-core',
      });

      await waitForHostEnvelope(
        hostEnvelopes,
        (envelope): envelope is HostSnapshotEnvelope => envelope.kind === 'snapshot',
        `${runId} boot snapshot`,
      );

      connection.send({
        kind: 'command',
        roomId,
        clientId,
        commandId,
        command: {
          kind: 'city-lifecycle',
          action: 'new-city',
        },
      });
      const newCityAck = await waitForHostEnvelope(
        hostEnvelopes,
        (envelope): envelope is HostAckEnvelope =>
          envelope.kind === 'ack' && envelope.commandId === commandId,
        `${runId} new-city ack`,
      );
      const newCitySnapshot = await waitForHostEnvelope(
        hostEnvelopes,
        (envelope): envelope is HostSnapshotEnvelope =>
          envelope.kind === 'snapshot' && envelope.serverSeq > newCityAck.serverSeq,
        `${runId} new-city snapshot`,
      );

      // Magic numbers source: classic world dimensions (`WORLD_X=120`, `WORLD_Y=100`)
      // and `DoNewCity` startup baseline from `ref/micropolis/src/sim/s_init.c`.
      expect(newCitySnapshot.payload.map?.width).toBe(120);
      expect(newCitySnapshot.payload.map?.height).toBe(100);
      const snapshotMap = newCitySnapshot.payload.map;
      expect(snapshotMap).toBeDefined();
      if (snapshotMap === undefined) {
        throw new Error(`${runId} new-city snapshot missing map payload`);
      }
      const mapTileWordCount =
        'tileWords' in snapshotMap ? snapshotMap.tileWords.length : snapshotMap.tiles.length;
      expect(mapTileWordCount).toBe(120 * 100);
      expect(newCitySnapshot.payload.hud?.funds).toBe(20_000);
      expect(newCitySnapshot.payload.hud?.speed).toBe(3);
      expect(newCitySnapshot.payload.hud?.date?.year).toBe(1900);
      expect(newCitySnapshot.payload.hud?.date?.month).toBe(0);
    } finally {
      connection.disconnect();
    }
  });

  test('certifies runtime new-city command hydrates map + HUD on the shipped Authoritative Runtime route', async () => {
    const runId = 'playable-cert-new-city-runtime-map-hud';
    const roomId = `${runId}-room`;
    const clientId = `${runId}-client`;
    const commandId = `${runId}-cmd-new-city`;
    const runtimeEvents: WebRuntimeEvent[] = [];
    const runtime = createWebHostRuntime({
      host: createPlayableRuntimeHost(),
      roomId,
      clientId,
    });
    const unsubscribe = runtime.subscribe((event) => {
      runtimeEvents.push(event);
    });

    try {
      runtime.connect();
      await waitForRuntimeEvent(
        runtimeEvents,
        (event): event is RuntimeEventWithEnvelope<HostSnapshotEnvelope> =>
          event.envelope?.kind === 'snapshot',
        `${runId} boot snapshot`,
      );

      runtime.sendCommand(commandId, {
        kind: 'city-lifecycle',
        action: 'new-city',
      });
      const newCityAck = await waitForRuntimeEvent(
        runtimeEvents,
        (event): event is RuntimeEventWithEnvelope<HostAckEnvelope> =>
          event.envelope?.kind === 'ack' && event.envelope.commandId === commandId,
        `${runId} new-city ack`,
      );
      await waitForRuntimeEvent(
        runtimeEvents,
        (event): event is RuntimeEventWithEnvelope<HostSnapshotEnvelope> =>
          event.envelope?.kind === 'snapshot' &&
          event.envelope.serverSeq > newCityAck.envelope.serverSeq,
        `${runId} new-city snapshot`,
      );

      const state = runtime.getState();
      // Magic number source: `WORLD_X=120`, `WORLD_Y=100`, and `DoNewCity` baseline
      // (`TotalFunds=20000`, Jan 1900, speed 3) in `ref/micropolis/src/sim/s_init.c`.
      expect(state.mapState.width).toBe(120);
      expect(state.mapState.height).toBe(100);
      expect(state.mapState.tiles).toHaveLength(120 * 100);
      expect(state.hudState.fundsLabel).toBe('Funds: $20,000');
      expect(state.hudState.dateYear).toBe(1900);
      expect(state.hudState.dateMonth).toBe(0);
      expect(state.hudState.speed).toBe(3);
    } finally {
      unsubscribe();
      runtime.disconnect();
    }
  });

  test('returns false when manual disaster capability is absent on a host', () => {
    const hostWithoutDisasterCapability = {
      connect: () => ({
        send: (_envelope: ClientEnvelope) => {},
        disconnect: () => {},
      }),
    } as CoreHost;

    expect(triggerPlayableRuntimeDisaster(hostWithoutDisasterCapability, 'earthquake')).toBe(false);
  });

  test('triggers manual disaster through structural host capability adapter', () => {
    const triggerManualRealtimeEvent = vi.fn(() => true);
    const hostWithDisasterCapability = {
      connect: () => ({
        send: (_envelope: ClientEnvelope) => {},
        disconnect: () => {},
      }),
      triggerManualRealtimeEvent,
    } as CoreHost;

    expect(triggerPlayableRuntimeDisaster(hostWithDisasterCapability, 'earthquake')).toBe(true);
    expect(triggerManualRealtimeEvent).toHaveBeenCalledWith('earthquake');
  });

  test('surfaces full Micropolis Disasters menu choices through the playable host adapter', () => {
    const host = createPlayableRuntimeHost();
    const hostEnvelopes: HostEnvelope[] = [];
    const roomId = 'playable-cert-manual-disaster-room';
    const clientId = 'playable-cert-manual-disaster-client';
    const connection = host.connect((envelope) => {
      hostEnvelopes.push(envelope);
    });

    try {
      connection.send({
        kind: 'hello',
        roomId,
        clientId,
        protocolVersion: 'bridge-v1',
        coreVersion: 'sim-core',
      });

      expect(triggerPlayableRuntimeDisaster(host, 'earthquake')).toBe(true);

      const latestPatch = [...hostEnvelopes]
        .reverse()
        .find((envelope): envelope is HostPatchEnvelope => envelope.kind === 'patch');
      if (latestPatch === undefined) {
        throw new Error('expected manual disaster trigger to emit a patch envelope');
      }

      // Magic number source: `MakeEarthquake` in `ref/micropolis/src/sim/s_disast.c`
      // dispatches earthquake message id `-23` via `SendMesAt`.
      expect(latestPatch.payload.messageDeltas?.some((message) => message.id === -23)).toBe(true);

      expect(PLAYABLE_DISASTER_CHOICES).toEqual([
        { id: 'tornado', label: 'Trigger Tornado' },
        { id: 'monster', label: 'Trigger Monster' },
        { id: 'fire', label: 'Trigger Fire' },
        { id: 'flood', label: 'Trigger Flood' },
        { id: 'meltdown', label: 'Trigger Meltdown' },
        { id: 'earthquake', label: 'Trigger Earthquake' },
      ]);
    } finally {
      connection.disconnect();
    }
  });

  test('certifies host save `.cty` -> mutate city -> load `.cty` fully restores map + HUD', async () => {
    await certifyPlayableCertificationCityRoundTripRestorationOnHost(
      'playable-cert-save-load-restore-host',
    );
  });

  test('certifies runtime save `.cty` -> mutate city -> load `.cty` fully restores map + HUD on Authoritative Runtime route', async () => {
    await certifyPlayableCertificationCityRoundTripRestorationOnRuntime(
      'playable-cert-save-load-restore-runtime',
    );
  });

  test('certifies host scenario start sets expected year/funds', async () => {
    await certifyPlayableCertificationScenarioStartOnHost('playable-cert-scenario-start-host');
  });

  test('certifies runtime scenario start sets expected year/funds on Authoritative Runtime route', async () => {
    await certifyPlayableCertificationScenarioStartOnRuntime(
      'playable-cert-scenario-start-runtime',
    );
  });

  test('proves the shipped Authoritative Runtime host path is playable end-to-end', async () => {
    const summary = await runPlayableRuntimeSmokeFlow('playable-runtime-smoke-main');
    expect(summary.rejectReasons).toEqual(['invalid-command']);
  }, 15_000);
});

/**
 * Authoritative Runtime save-payload parser checks.
 * Mirrors `SaveCityAs` payload ownership in `ref/micropolis/src/sim/s_fileio.c`,
 * while preserving strict envelope-shape checks in TypeScript.
 */
describe('readCityExportPayload', () => {
  test('accepts valid save payloads and rejects malformed payloads', () => {
    const validBytes = new Uint8Array([1, 2, 3, 4]);
    expect(
      readCityExportPayload({
        cityIo: {
          save: {
            fileName: 'city.cty',
            cityName: 'City',
            cityBytes: validBytes,
          },
        },
      }),
    ).toEqual({
      fileName: 'city.cty',
      cityName: 'City',
      cityBytes: validBytes,
    });

    expect(readCityExportPayload(null)).toBeNull();
    expect(readCityExportPayload({ cityIo: {} })).toBeNull();
    expect(
      readCityExportPayload({
        cityIo: {
          save: {
            fileName: 'city.cty',
            cityName: 'City',
            cityBytes: [1, 2, 3],
          },
        },
      }),
    ).toBeNull();
  });

  test('accepts cross-realm Uint8Array save payload bytes', () => {
    const crossRealmBytes = runInNewContext('new Uint8Array([7, 8, 9])') as Uint8Array;
    expect(crossRealmBytes instanceof Uint8Array).toBe(false);

    expect(
      readCityExportPayload({
        cityIo: {
          save: {
            fileName: 'cross-realm.cty',
            cityName: 'Cross Realm',
            cityBytes: crossRealmBytes,
          },
        },
      }),
    ).toEqual({
      fileName: 'cross-realm.cty',
      cityName: 'Cross Realm',
      cityBytes: crossRealmBytes,
    });
  });
});
