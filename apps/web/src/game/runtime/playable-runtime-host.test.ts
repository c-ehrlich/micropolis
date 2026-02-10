import { describe, expect, test, vi } from 'vitest';

import { Tile, TileMask } from '../../../../../packages/sim-core/src/index.ts';
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

type HostRejectEnvelope = Extract<HostEnvelope, { kind: 'reject' }>;

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

/**
 * Reads the latest authoritative tick seen on host envelopes.
 * Mirrors monotonic frame/tick progression from `ref/micropolis/src/sim/s_sim.c`.
 */
function readLatestTick(hostEnvelopes: readonly HostEnvelope[]): number {
  let latestTick = 0;
  for (const envelope of hostEnvelopes) {
    if ('tick' in envelope && typeof envelope.tick === 'number') {
      latestTick = Math.max(latestTick, envelope.tick);
    }
  }
  return latestTick;
}

// Magic-number source: playable tool costs from `CostOf[]` in
// `ref/micropolis/src/sim/w_tool.c`.
const PLAYABLE_CERT_PLAYABLE_TOOL_COSTS = {
  road: 10,
  rail: 20,
  wire: 5,
  bulldoze: 1,
  res: 100,
  com: 100,
  ind: 100,
} as const;

const PLAYABLE_CERT_PLAYABLE_TOOL_CERTIFICATION_CASES = [
  { tool: 'road', placeX: 10, placeY: 10, rejectX: -1, rejectY: 10 },
  { tool: 'rail', placeX: 11, placeY: 10, rejectX: -1, rejectY: 11 },
  { tool: 'wire', placeX: 12, placeY: 10, rejectX: -1, rejectY: 12 },
  { tool: 'bulldoze', placeX: 10, placeY: 10, rejectX: -1, rejectY: 13 },
  { tool: 'res', placeX: 20, placeY: 20, rejectX: 0, rejectY: 20 },
  { tool: 'com', placeX: 30, placeY: 20, rejectX: 0, rejectY: 30 },
  { tool: 'ind', placeX: 40, placeY: 20, rejectX: 0, rejectY: 40 },
] as const;

type PlayableCertificationPlayableToolCertificationCase =
  (typeof PLAYABLE_CERT_PLAYABLE_TOOL_CERTIFICATION_CASES)[number];
type PlayableCertificationZoneTool = Extract<
  PlayableCertificationPlayableToolCertificationCase['tool'],
  'res' | 'com' | 'ind'
>;
type PlayableCertificationZoneToolPlacements = Record<
  PlayableCertificationZoneTool,
  { x: number; y: number }
>;

const PLAYABLE_CERT_CADENCE_PATCH_INTERVAL_MS = 10;
const PLAYABLE_CERT_HEADS_MESSAGES_OBSERVE_DURATION_MS =
  PLAYABLE_CERT_CADENCE_PATCH_INTERVAL_MS * 8;
const PLAYABLE_CERT_REALTIME_VISUAL_OBSERVE_DURATION_MS =
  PLAYABLE_CERT_CADENCE_PATCH_INTERVAL_MS * 12;
// Magic numbers source: `LoadScenario` scenario-1 (`Dullsville`) constants in
// `ref/micropolis/src/sim/s_fileio.c`: year `1900`, funds `5000`.
const PLAYABLE_CERT_SCENARIO_START_CERTIFICATION = {
  scenarioId: 1,
  startYear: 1900,
  startFunds: 5_000,
} as const;
// Magic-number source: Playable Certification manual release-gate checklist requirement in
// `apps/web/STAGE4_BROWSER_GAME_SHIPPING_PLAN.md` ("at least 15 minutes").
const PLAYABLE_CERT_CONTINUOUS_PLAY_SESSION_DURATION_MS = 15 * 60 * 1000;
// Magic-number source: Playable Certification continuous-play observation cadence
// used by this test harness to sample long-run runtime progression.
const PLAYABLE_CERT_CONTINUOUS_PLAY_PATCH_INTERVAL_MS = 180;
const PLAYABLE_CERT_CONTINUOUS_PLAY_CHUNK_DURATION_MS = 3 * 60 * 1000;
const PLAYABLE_CERT_CONTINUOUS_PLAY_CHUNK_COUNT =
  PLAYABLE_CERT_CONTINUOUS_PLAY_SESSION_DURATION_MS /
  PLAYABLE_CERT_CONTINUOUS_PLAY_CHUNK_DURATION_MS;
const PLAYABLE_CERT_CONTINUOUS_PLAY_EXPECTED_STEPS_PER_CHUNK =
  PLAYABLE_CERT_CONTINUOUS_PLAY_CHUNK_DURATION_MS / PLAYABLE_CERT_CONTINUOUS_PLAY_PATCH_INTERVAL_MS;
const PLAYABLE_CERT_CONTINUOUS_PLAY_EXPECTED_TOTAL_STEPS =
  PLAYABLE_CERT_CONTINUOUS_PLAY_EXPECTED_STEPS_PER_CHUNK *
  PLAYABLE_CERT_CONTINUOUS_PLAY_CHUNK_COUNT;

interface PlayableCertificationAmbientMessageAuthority {
  simState: {
    CityTime: number;
    MessagePort: number;
    MesNum: number;
    ResZPop: number;
    ComZPop: number;
    IndZPop: number;
  };
}

/**
 * Primes ambient simulation scalars so the next normal sim step emits a message.
 * Mirrors `SendMessages` case-1 gating in `ref/micropolis/src/sim/s_msg.c`, where
 * `z = CityTime & 63` and `z == 1` enqueues message id `1` when
 * `(TotalZPop >> 2) >= ResZPop`.
 */
function primePlayableCertificationNormalSimulationMessageTrigger(host: unknown): void {
  const authority = host as PlayableCertificationAmbientMessageAuthority;
  authority.simState.CityTime = 0;
  authority.simState.MessagePort = 0;
  authority.simState.MesNum = 0;
  authority.simState.ResZPop = 0;
  authority.simState.ComZPop = 0;
  authority.simState.IndZPop = 0;
}

function readFundsFromLabel(label: string): number {
  const digits = label.replaceAll(/[^0-9]/g, '');
  if (digits.length === 0) {
    return 0;
  }
  return Number.parseInt(digits, 10);
}

interface PlayableCertificationRealtimeTrackableObject {
  id?: string;
  x: number;
  y: number;
  frame: number;
}

/**
 * Reads one realtime object list from snapshot/patch payload sections.
 * Mirrors Realtime Overlay full-list + compatibility object payload ownership in
 * `DrawObjects`/`MoveObjects` from `ref/micropolis/src/sim/w_sprite.c`.
 * Parity note: missing `frame` values are normalized to `0`, matching runtime
 * realtime projection defaults in `readInteger(record.frame) ?? 0` from
 * `apps/web/src/game/runtime/realtime-state.ts`.
 */
function readPlayableCertificationRealtimeObjectsFromPayload(
  payload: HostPatchEnvelope['payload'] | HostSnapshotEnvelope['payload'],
): readonly PlayableCertificationRealtimeTrackableObject[] {
  const realtime = payload.realtime;
  const rawObjects = realtime?.snapshot ?? realtime?.objects ?? [];
  return rawObjects.map((object) => ({
    id: object.id,
    x: object.x,
    y: object.y,
    frame: object.frame ?? 0,
  }));
}

/**
 * Tracks realtime object coordinates/frames and reports whether any object moved.
 * Mirrors sprite position/frame mutation in `MoveObjects` from
 * `ref/micropolis/src/sim/w_sprite.c`.
 */
function trackPlayableCertificationRealtimeMovement(
  objects: readonly PlayableCertificationRealtimeTrackableObject[],
  signaturesById: Map<string, string>,
): boolean {
  let sawMovement = false;
  for (const object of objects) {
    if (typeof object.id !== 'string' || object.id.length === 0) {
      continue;
    }
    const signature = `${object.x}:${object.y}:${object.frame}`;
    const previousSignature = signaturesById.get(object.id);
    if (previousSignature !== undefined && previousSignature !== signature) {
      sawMovement = true;
    }
    signaturesById.set(object.id, signature);
  }
  return sawMovement;
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
 * Returns whether one map tile can host zone footprint placement.
 * Mirrors deep-water exclusion in `check3x3` / `tally` from
 * `ref/micropolis/src/sim/w_tool.c`, where river/channel tiles are not zone-buildable.
 */
function isPlayableCertificationZonePlacableTile(tileWord: number): boolean {
  const tileId = tileWord & TileMask.LOMASK;
  return tileId !== Tile.RIVER && tileId !== Tile.REDGE && tileId !== Tile.CHANNEL;
}

/**
 * Returns whether a 3x3 zone footprint around one center coordinate is buildable.
 * Mirrors 3x3 zone footprint checks in `check3x3` from
 * `ref/micropolis/src/sim/w_tool.c`.
 */
function isPlayableCertificationZoneFootprintPlacable(
  tileWords: readonly number[] | Uint16Array,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
): boolean {
  const startX = centerX - 1;
  const startY = centerY - 1;
  const endX = centerX + 1;
  const endY = centerY + 1;
  if (startX < 0 || startY < 0 || endX >= width || endY >= height) {
    return false;
  }

  for (let yy = startY; yy <= endY; yy += 1) {
    for (let xx = startX; xx <= endX; xx += 1) {
      const tileWord = tileWords[yy * width + xx] ?? 0;
      if (!isPlayableCertificationZonePlacableTile(tileWord)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Finds deterministic valid centers for R/C/I 3x3 zone placement checks.
 * Mirrors the `check3x3` terrain gate from `ref/micropolis/src/sim/w_tool.c`.
 * Parity note: picks first valid centers from snapshot map scan to avoid hard-coded
 * coordinates landing on deep-water tiles.
 */
function readPlayableCertificationZoneToolPlacementsFromSnapshot(
  snapshot: HostSnapshotEnvelope,
  label: string,
): PlayableCertificationZoneToolPlacements {
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
  const placements: Partial<PlayableCertificationZoneToolPlacements> = {};

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (!isPlayableCertificationZoneFootprintPlacable(tileWords, width, height, x, y)) {
        continue;
      }
      if (placements.res === undefined) {
        placements.res = { x, y };
        continue;
      }
      if (placements.com === undefined) {
        placements.com = { x, y };
        continue;
      }
      if (placements.ind === undefined) {
        placements.ind = { x, y };
        return placements as PlayableCertificationZoneToolPlacements;
      }
    }
  }

  throw new Error(`${label} could not find valid zone placement coordinates`);
}

/**
 * Resolves a deterministic placement coordinate for one tool certification case.
 * Mirrors Micropolis 3x3 tool center semantics from `toolOffset[]` in
 * `ref/micropolis/src/sim/w_tool.c`.
 */
function readPlayableCertificationPlacementCoordinateForTool(
  toolCase: PlayableCertificationPlayableToolCertificationCase,
  zonePlacements: PlayableCertificationZoneToolPlacements,
): { x: number; y: number } {
  if (toolCase.tool === 'res' || toolCase.tool === 'com' || toolCase.tool === 'ind') {
    return zonePlacements[toolCase.tool];
  }
  return { x: toolCase.placeX, y: toolCase.placeY };
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
 * Certifies Playable Certification tool placement costs/rejects/funds on the host-envelope path.
 * Mirrors `do_tool` cost handling from `CostOf[]` and reject outcomes in
 * `ref/micropolis/src/sim/w_tool.c`.
 */
async function certifyPlayableCertificationPlayableToolCostsOnHost(runId: string): Promise<void> {
  const host = createPlayableRuntimeHost();
  const hostEnvelopes: HostEnvelope[] = [];
  const roomId = `${runId}-room`;
  const clientId = `${runId}-client`;
  const newCityCommandId = `${runId}-cmd-new-city`;
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
      commandId: newCityCommandId,
      command: {
        kind: 'city-lifecycle',
        action: 'new-city',
      },
    });
    const newCityAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === newCityCommandId,
      `${runId} new-city ack`,
    );
    const newCitySnapshot = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostSnapshotEnvelope =>
        envelope.kind === 'snapshot' && envelope.serverSeq > newCityAck.serverSeq,
      `${runId} new-city snapshot`,
    );
    const zonePlacements = readPlayableCertificationZoneToolPlacementsFromSnapshot(
      newCitySnapshot,
      `${runId} new-city`,
    );

    let expectedFunds = 20_000;
    for (const toolCase of PLAYABLE_CERT_PLAYABLE_TOOL_CERTIFICATION_CASES) {
      const placement = readPlayableCertificationPlacementCoordinateForTool(
        toolCase,
        zonePlacements,
      );
      const commandId = `${runId}-cmd-place-${toolCase.tool}`;
      connection.send({
        kind: 'command',
        roomId,
        clientId,
        commandId,
        command: {
          kind: 'tool',
          tool: toolCase.tool,
          x: placement.x,
          y: placement.y,
        },
      });

      const ack = await waitForHostEnvelope(
        hostEnvelopes,
        (envelope): envelope is HostAckEnvelope =>
          envelope.kind === 'ack' && envelope.commandId === commandId,
        `${runId} ${toolCase.tool} ack`,
      );
      const fundsPatch = await waitForHostEnvelope(
        hostEnvelopes,
        (envelope): envelope is HostPatchEnvelope =>
          envelope.kind === 'patch' &&
          envelope.serverSeq > ack.serverSeq &&
          envelope.payload.hud?.funds !== undefined,
        `${runId} ${toolCase.tool} funds patch`,
      );
      expectedFunds -= PLAYABLE_CERT_PLAYABLE_TOOL_COSTS[toolCase.tool];
      expect(fundsPatch.payload.hud?.funds).toBe(expectedFunds);
    }

    for (const toolCase of PLAYABLE_CERT_PLAYABLE_TOOL_CERTIFICATION_CASES) {
      const commandId = `${runId}-cmd-reject-${toolCase.tool}`;
      connection.send({
        kind: 'command',
        roomId,
        clientId,
        commandId,
        command: {
          kind: 'tool',
          tool: toolCase.tool,
          x: toolCase.rejectX,
          y: toolCase.rejectY,
        },
      });

      const reject = await waitForHostEnvelope(
        hostEnvelopes,
        (envelope): envelope is HostRejectEnvelope =>
          envelope.kind === 'reject' && envelope.commandId === commandId,
        `${runId} ${toolCase.tool} reject`,
      );
      expect(reject.reason).toBe('out-of-bounds');
    }

    const latestServerSeq = readLatestServerSeq(hostEnvelopes);
    connection.send({
      kind: 'request_snapshot',
      roomId,
      clientId,
      fromServerSeq: latestServerSeq,
      reason: 'manual',
    });
    const finalSnapshot = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostSnapshotEnvelope =>
        envelope.kind === 'snapshot' && envelope.serverSeq > latestServerSeq,
      `${runId} post-reject snapshot`,
    );
    expect(finalSnapshot.payload.hud?.funds).toBe(expectedFunds);
  } finally {
    connection.disconnect();
  }
}

/**
 * Certifies Playable Certification tool placement costs/rejects/funds on the shipped runtime path.
 * Mirrors tool command routing and reject propagation from
 * `ref/micropolis/src/sim/w_tool.c` through host envelope projection.
 */
async function certifyPlayableCertificationPlayableToolCostsOnRuntime(
  runId: string,
): Promise<void> {
  const roomId = `${runId}-room`;
  const clientId = `${runId}-client`;
  const newCityCommandId = `${runId}-cmd-new-city`;
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

    runtime.sendCommand(newCityCommandId, {
      kind: 'city-lifecycle',
      action: 'new-city',
    });
    const newCityAck = await waitForRuntimeEvent(
      runtimeEvents,
      (event): event is RuntimeEventWithEnvelope<HostAckEnvelope> =>
        event.envelope?.kind === 'ack' && event.envelope.commandId === newCityCommandId,
      `${runId} new-city ack`,
    );
    const newCitySnapshot = await waitForRuntimeEvent(
      runtimeEvents,
      (event): event is RuntimeEventWithEnvelope<HostSnapshotEnvelope> =>
        event.envelope?.kind === 'snapshot' &&
        event.envelope.serverSeq > newCityAck.envelope.serverSeq,
      `${runId} new-city snapshot`,
    );
    const zonePlacements = readPlayableCertificationZoneToolPlacementsFromSnapshot(
      newCitySnapshot.envelope,
      `${runId} runtime new-city`,
    );

    let expectedFunds = 20_000;
    for (const toolCase of PLAYABLE_CERT_PLAYABLE_TOOL_CERTIFICATION_CASES) {
      const placement = readPlayableCertificationPlacementCoordinateForTool(
        toolCase,
        zonePlacements,
      );
      const commandId = `${runId}-cmd-place-${toolCase.tool}`;
      runtime.sendCommand(commandId, {
        kind: 'tool',
        tool: toolCase.tool,
        x: placement.x,
        y: placement.y,
      });
      const ack = await waitForRuntimeEvent(
        runtimeEvents,
        (event): event is RuntimeEventWithEnvelope<HostAckEnvelope> =>
          event.envelope?.kind === 'ack' && event.envelope.commandId === commandId,
        `${runId} runtime ${toolCase.tool} ack`,
      );
      const fundsPatch = await waitForRuntimeEvent(
        runtimeEvents,
        (event): event is RuntimeEventWithEnvelope<HostPatchEnvelope> =>
          event.envelope?.kind === 'patch' &&
          event.envelope.serverSeq > ack.envelope.serverSeq &&
          event.envelope.payload.hud?.funds !== undefined,
        `${runId} runtime ${toolCase.tool} funds patch`,
      );
      expectedFunds -= PLAYABLE_CERT_PLAYABLE_TOOL_COSTS[toolCase.tool];
      expect(fundsPatch.envelope.payload.hud?.funds).toBe(expectedFunds);
      expect(readFundsFromLabel(runtime.getState().hudState.fundsLabel)).toBe(expectedFunds);
    }

    for (const toolCase of PLAYABLE_CERT_PLAYABLE_TOOL_CERTIFICATION_CASES) {
      const commandId = `${runId}-cmd-reject-${toolCase.tool}`;
      runtime.sendCommand(commandId, {
        kind: 'tool',
        tool: toolCase.tool,
        x: toolCase.rejectX,
        y: toolCase.rejectY,
      });
      const reject = await waitForRuntimeEvent(
        runtimeEvents,
        (event): event is RuntimeEventWithEnvelope<HostRejectEnvelope> =>
          event.envelope?.kind === 'reject' && event.envelope.commandId === commandId,
        `${runId} runtime ${toolCase.tool} reject`,
      );
      expect(reject.envelope.reason).toBe('out-of-bounds');
      expect(runtime.getState().lastRejectReason).toBe('out-of-bounds');
      expect(readFundsFromLabel(runtime.getState().hudState.fundsLabel)).toBe(expectedFunds);
    }

    const snapshotCursor = runtime.getState().lastAppliedServerSeq;
    runtime.requestSnapshot('manual');
    const finalSnapshot = await waitForRuntimeEvent(
      runtimeEvents,
      (event): event is RuntimeEventWithEnvelope<HostSnapshotEnvelope> =>
        event.envelope?.kind === 'snapshot' && event.envelope.serverSeq > snapshotCursor,
      `${runId} runtime post-reject snapshot`,
    );
    expect(finalSnapshot.envelope.payload.hud?.funds).toBe(expectedFunds);
  } finally {
    unsubscribe();
    runtime.disconnect();
  }
}

/**
 * Certifies Playable Certification speed/pause cadence changes on host envelopes.
 * Mirrors `Pause`/`Resume`/`setSpeed` from `ref/micropolis/src/sim/w_util.c`
 * and `Spdcycle` speed gates in `ref/micropolis/src/sim/s_sim.c`.
 */
function certifyPlayableCertificationPlayableCadenceOnHost(runId: string): void {
  vi.useFakeTimers();
  const host = createPlayableRuntimeHost();
  const hostEnvelopes: HostEnvelope[] = [];
  const roomId = `${runId}-room`;
  const clientId = `${runId}-client`;
  const connection = host.connect((envelope) => {
    hostEnvelopes.push(envelope);
  });

  const requestSnapshot = (label: string): HostSnapshotEnvelope => {
    const previousServerSeq = readLatestServerSeq(hostEnvelopes);
    connection.send({
      kind: 'request_snapshot',
      roomId,
      clientId,
      reason: 'manual',
      fromServerSeq: previousServerSeq,
    });
    for (let index = hostEnvelopes.length - 1; index >= 0; index -= 1) {
      const envelope = hostEnvelopes[index];
      if (
        envelope !== undefined &&
        envelope.kind === 'snapshot' &&
        envelope.serverSeq > previousServerSeq
      ) {
        return envelope;
      }
    }
    throw new Error(`Expected ${label} snapshot envelope`);
  };

  const sendSimControl = (
    commandId: string,
    command: Extract<ClientEnvelope, { kind: 'command' }>['command'],
  ): void => {
    const previousServerSeq = readLatestServerSeq(hostEnvelopes);
    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId,
      command,
    });
    expect(readLatestServerSeq(hostEnvelopes)).toBeGreaterThan(previousServerSeq);
  };

  try {
    connection.send({
      kind: 'hello',
      roomId,
      clientId,
      protocolVersion: 'bridge-v1',
      coreVersion: 'sim-core',
    });

    const bootSnapshot = requestSnapshot(`${runId} boot`);
    expect(bootSnapshot.payload.hud?.speed).toBe(3);

    sendSimControl(`${runId}-cmd-speed-1`, {
      kind: 'sim-control',
      control: 'set-speed',
      speed: 1,
    });
    const speedOneBefore = requestSnapshot(`${runId} speed-1 before`);
    expect(speedOneBefore.payload.hud?.speed).toBe(1);
    vi.advanceTimersByTime(PLAYABLE_CERT_CADENCE_PATCH_INTERVAL_MS * 5);
    const speedOneAfter = requestSnapshot(`${runId} speed-1 after`);
    // Magic-number source: speed 1 emits one sim step every 5 `Spdcycle` loops in
    // `ref/micropolis/src/sim/s_sim.c`.
    expect(speedOneAfter.tick - speedOneBefore.tick).toBe(1);

    sendSimControl(`${runId}-cmd-speed-2`, {
      kind: 'sim-control',
      control: 'set-speed',
      speed: 2,
    });
    const speedTwoBefore = requestSnapshot(`${runId} speed-2 before`);
    expect(speedTwoBefore.payload.hud?.speed).toBe(2);
    vi.advanceTimersByTime(PLAYABLE_CERT_CADENCE_PATCH_INTERVAL_MS * 6);
    const speedTwoAfter = requestSnapshot(`${runId} speed-2 after`);
    // Magic-number source: speed 2 emits one sim step every 3 `Spdcycle` loops in
    // `ref/micropolis/src/sim/s_sim.c`.
    expect(speedTwoAfter.tick - speedTwoBefore.tick).toBe(2);

    sendSimControl(`${runId}-cmd-speed-3`, {
      kind: 'sim-control',
      control: 'set-speed',
      speed: 3,
    });
    const speedThreeBefore = requestSnapshot(`${runId} speed-3 before`);
    expect(speedThreeBefore.payload.hud?.speed).toBe(3);
    vi.advanceTimersByTime(PLAYABLE_CERT_CADENCE_PATCH_INTERVAL_MS * 6);
    const speedThreeAfter = requestSnapshot(`${runId} speed-3 after`);
    // Magic-number source: speed 3 steps each ambient cycle (no modulo gate) in
    // `ref/micropolis/src/sim/s_sim.c`.
    expect(speedThreeAfter.tick - speedThreeBefore.tick).toBe(6);

    sendSimControl(`${runId}-cmd-pause`, {
      kind: 'sim-control',
      control: 'pause',
    });
    const pausedBefore = requestSnapshot(`${runId} paused before`);
    expect(pausedBefore.payload.hud?.speed).toBe(0);
    vi.advanceTimersByTime(PLAYABLE_CERT_CADENCE_PATCH_INTERVAL_MS * 12);
    const pausedAfter = requestSnapshot(`${runId} paused after`);
    expect(pausedAfter.payload.hud?.speed).toBe(0);
    expect(pausedAfter.tick - pausedBefore.tick).toBe(0);

    sendSimControl(`${runId}-cmd-play`, {
      kind: 'sim-control',
      control: 'play',
    });
    const resumedBefore = requestSnapshot(`${runId} resumed before`);
    // Magic-number source: `Resume()` restores prior paused speed from
    // `ref/micropolis/src/sim/w_util.c`.
    expect(resumedBefore.payload.hud?.speed).toBe(3);
    vi.advanceTimersByTime(PLAYABLE_CERT_CADENCE_PATCH_INTERVAL_MS * 4);
    const resumedAfter = requestSnapshot(`${runId} resumed after`);
    expect(resumedAfter.payload.hud?.speed).toBe(3);
    expect(resumedAfter.tick - resumedBefore.tick).toBe(4);

    expect(readLatestTick(hostEnvelopes)).toBeGreaterThan(0);
  } finally {
    connection.disconnect();
    vi.useRealTimers();
  }
}

/**
 * Certifies Playable Certification speed/pause cadence changes on the shipped runtime path.
 * Mirrors host cadence gates from `ref/micropolis/src/sim/s_sim.c` projected
 * through Authoritative Runtime runtime envelopes.
 */
function certifyPlayableCertificationPlayableCadenceOnRuntime(runId: string): void {
  vi.useFakeTimers();
  const runtime = createWebHostRuntime({
    host: createPlayableRuntimeHost(),
    roomId: `${runId}-room`,
    clientId: `${runId}-client`,
  });

  const requestSnapshot = (): { tick: number; speed: number; serverSeq: number } => {
    const previousServerSeq = runtime.getState().lastAppliedServerSeq;
    runtime.requestSnapshot('manual');
    const state = runtime.getState();
    expect(state.lastAppliedServerSeq).toBeGreaterThan(previousServerSeq);
    return {
      tick: state.lastAppliedTick,
      speed: state.hudState.speed,
      serverSeq: state.lastAppliedServerSeq,
    };
  };

  try {
    runtime.connect();

    const bootSnapshot = requestSnapshot();
    expect(bootSnapshot.speed).toBe(3);

    runtime.sendCommand(`${runId}-cmd-speed-1`, {
      kind: 'sim-control',
      control: 'set-speed',
      speed: 1,
    });
    const speedOneBefore = requestSnapshot();
    expect(speedOneBefore.speed).toBe(1);
    vi.advanceTimersByTime(PLAYABLE_CERT_CADENCE_PATCH_INTERVAL_MS * 5);
    const speedOneAfter = requestSnapshot();
    // Magic-number source: speed 1 modulo gate (`Spdcycle % 5`) in
    // `ref/micropolis/src/sim/s_sim.c`.
    expect(speedOneAfter.tick - speedOneBefore.tick).toBe(1);

    runtime.sendCommand(`${runId}-cmd-speed-2`, {
      kind: 'sim-control',
      control: 'set-speed',
      speed: 2,
    });
    const speedTwoBefore = requestSnapshot();
    expect(speedTwoBefore.speed).toBe(2);
    vi.advanceTimersByTime(PLAYABLE_CERT_CADENCE_PATCH_INTERVAL_MS * 6);
    const speedTwoAfter = requestSnapshot();
    // Magic-number source: speed 2 modulo gate (`Spdcycle % 3`) in
    // `ref/micropolis/src/sim/s_sim.c`.
    expect(speedTwoAfter.tick - speedTwoBefore.tick).toBe(2);

    runtime.sendCommand(`${runId}-cmd-speed-3`, {
      kind: 'sim-control',
      control: 'set-speed',
      speed: 3,
    });
    const speedThreeBefore = requestSnapshot();
    expect(speedThreeBefore.speed).toBe(3);
    vi.advanceTimersByTime(PLAYABLE_CERT_CADENCE_PATCH_INTERVAL_MS * 6);
    const speedThreeAfter = requestSnapshot();
    expect(speedThreeAfter.tick - speedThreeBefore.tick).toBe(6);

    runtime.sendCommand(`${runId}-cmd-pause`, {
      kind: 'sim-control',
      control: 'pause',
    });
    const pausedBefore = requestSnapshot();
    expect(pausedBefore.speed).toBe(0);
    vi.advanceTimersByTime(PLAYABLE_CERT_CADENCE_PATCH_INTERVAL_MS * 12);
    const pausedAfter = requestSnapshot();
    expect(pausedAfter.speed).toBe(0);
    expect(pausedAfter.tick - pausedBefore.tick).toBe(0);

    runtime.sendCommand(`${runId}-cmd-play`, {
      kind: 'sim-control',
      control: 'play',
    });
    const resumedBefore = requestSnapshot();
    expect(resumedBefore.speed).toBe(3);
    vi.advanceTimersByTime(PLAYABLE_CERT_CADENCE_PATCH_INTERVAL_MS * 4);
    const resumedAfter = requestSnapshot();
    expect(resumedAfter.speed).toBe(3);
    expect(resumedAfter.tick - resumedBefore.tick).toBe(4);
  } finally {
    runtime.disconnect();
    vi.useRealTimers();
  }
}

/**
 * Certifies Playable Certification heads/message-feed updates on host envelopes.
 * Mirrors normal simulation progression from `Simulate` in
 * `ref/micropolis/src/sim/s_sim.c`, heads updates from
 * `ref/micropolis/src/sim/w_update.c`, and message dispatch in
 * `ref/micropolis/src/sim/s_msg.c`.
 */
function certifyPlayableCertificationHeadsAndMessagesOnHost(runId: string): void {
  vi.useFakeTimers();
  const host = createPlayableRuntimeHost();
  const hostEnvelopes: HostEnvelope[] = [];
  const roomId = `${runId}-room`;
  const clientId = `${runId}-client`;
  const connection = host.connect((envelope) => {
    hostEnvelopes.push(envelope);
  });

  const requestSnapshot = (label: string): HostSnapshotEnvelope => {
    const previousServerSeq = readLatestServerSeq(hostEnvelopes);
    connection.send({
      kind: 'request_snapshot',
      roomId,
      clientId,
      reason: 'manual',
      fromServerSeq: previousServerSeq,
    });
    for (let index = hostEnvelopes.length - 1; index >= 0; index -= 1) {
      const envelope = hostEnvelopes[index];
      if (
        envelope !== undefined &&
        envelope.kind === 'snapshot' &&
        envelope.serverSeq > previousServerSeq
      ) {
        return envelope;
      }
    }
    throw new Error(`Expected ${label} snapshot envelope`);
  };

  try {
    connection.send({
      kind: 'hello',
      roomId,
      clientId,
      protocolVersion: 'bridge-v1',
      coreVersion: 'sim-core',
    });

    const bootSnapshot = requestSnapshot(`${runId} boot`);
    const bootDate = bootSnapshot.payload.hud?.date;
    if (bootDate === undefined) {
      throw new Error(`${runId} boot snapshot missing hud.date`);
    }

    const initialDateMonth = bootDate.month;
    const initialDateYear = bootDate.year;
    const initialMessageCount = bootSnapshot.payload.messages?.length ?? 0;
    const initialTick = bootSnapshot.tick;
    const initialServerSeq = bootSnapshot.serverSeq;
    primePlayableCertificationNormalSimulationMessageTrigger(host);

    // Magic-number source: `updateDate` in `w_update.c` derives month as
    // `(CityTime % 48) >> 2`, so eight ambient sim steps guarantee a visible
    // month/year head change under speed 3 cadence.
    vi.advanceTimersByTime(PLAYABLE_CERT_HEADS_MESSAGES_OBSERVE_DURATION_MS);

    const ambientPatches = hostEnvelopes.filter(
      (envelope): envelope is HostPatchEnvelope =>
        envelope.kind === 'patch' && envelope.serverSeq > bootSnapshot.serverSeq,
    );
    expect(ambientPatches.length).toBeGreaterThan(0);
    expect(readLatestTick(hostEnvelopes)).toBeGreaterThan(initialTick);
    expect(
      ambientPatches.some((patch) => {
        const date = patch.payload.hud?.date;
        return (
          date !== undefined && (date.month !== initialDateMonth || date.year !== initialDateYear)
        );
      }),
    ).toBe(true);
    expect(ambientPatches.some((patch) => (patch.payload.messageDeltas?.length ?? 0) > 0)).toBe(
      true,
    );

    const afterAmbientSnapshot = requestSnapshot(`${runId} post-ambient`);
    expect(afterAmbientSnapshot.payload.messages?.length ?? 0).toBeGreaterThan(initialMessageCount);
    expect(
      afterAmbientSnapshot.payload.messages?.some(
        (message) =>
          (message.tick ?? 0) > initialTick && (message.serverSeq ?? 0) > initialServerSeq,
      ) ?? false,
    ).toBe(true);
  } finally {
    connection.disconnect();
    vi.useRealTimers();
  }
}

/**
 * Certifies Playable Certification heads/message-feed updates on the shipped runtime path.
 * Mirrors host-driven `DoUpdateHeads`/`doMessage` output projection from
 * `ref/micropolis/src/sim/w_update.c` and `ref/micropolis/src/sim/s_msg.c`
 * through authoritative Authoritative Runtime runtime envelopes.
 */
function certifyPlayableCertificationHeadsAndMessagesOnRuntime(runId: string): void {
  vi.useFakeTimers();
  let sawHudPatch = false;
  let sawMessageDeltaPatch = false;
  const host = createPlayableRuntimeHost();
  const runtime = createWebHostRuntime({
    host,
    roomId: `${runId}-room`,
    clientId: `${runId}-client`,
  });
  const unsubscribe = runtime.subscribe((event) => {
    if (event.envelope?.kind !== 'patch') {
      return;
    }
    if (event.envelope.payload.hud?.date !== undefined) {
      sawHudPatch = true;
    }
    if ((event.envelope.payload.messageDeltas?.length ?? 0) > 0) {
      sawMessageDeltaPatch = true;
    }
  });

  try {
    runtime.connect();

    const initialState = runtime.getState();
    const initialDateMonth = initialState.hudState.dateMonth;
    const initialDateYear = initialState.hudState.dateYear;
    const initialMessageCount = initialState.hudState.messages.length;
    const initialTick = initialState.lastAppliedTick;
    const initialServerSeq = initialState.lastAppliedServerSeq;
    primePlayableCertificationNormalSimulationMessageTrigger(host);

    // Magic-number source: ambient speed-3 simulation increments `CityTime` every
    // cycle in `s_sim.c`; at least four ticks are required for `updateDate` month
    // rollover math (`(CityTime % 48) >> 2`) in `w_update.c`.
    vi.advanceTimersByTime(PLAYABLE_CERT_HEADS_MESSAGES_OBSERVE_DURATION_MS);

    const state = runtime.getState();
    expect(state.lastAppliedTick).toBeGreaterThan(initialTick);
    expect(
      state.hudState.dateMonth !== initialDateMonth || state.hudState.dateYear !== initialDateYear,
    ).toBe(true);
    expect(state.hudState.messages.length).toBeGreaterThan(initialMessageCount);
    expect(
      state.hudState.messages.some(
        (message) => message.tick > initialTick && message.serverSeq > initialServerSeq,
      ),
    ).toBe(true);
    expect(sawHudPatch).toBe(true);
    expect(sawMessageDeltaPatch).toBe(true);
  } finally {
    unsubscribe();
    runtime.disconnect();
    vi.useRealTimers();
  }
}

/**
 * Certifies Playable Certification in-map realtime/disaster visual movement on host envelopes.
 * Mirrors sprite update/render eligibility from `MoveObjects`/`DrawObjects` in
 * `ref/micropolis/src/sim/w_sprite.c` under normal speed-3 simulation cadence
 * from `ref/micropolis/src/sim/s_sim.c`.
 */
function certifyPlayableCertificationRealtimeVisualEventOnHost(runId: string): void {
  vi.useFakeTimers();
  const host = createPlayableRuntimeHost();
  const hostEnvelopes: HostEnvelope[] = [];
  const roomId = `${runId}-room`;
  const clientId = `${runId}-client`;
  const connection = host.connect((envelope) => {
    hostEnvelopes.push(envelope);
  });

  const requestSnapshot = (label: string): HostSnapshotEnvelope => {
    const previousServerSeq = readLatestServerSeq(hostEnvelopes);
    connection.send({
      kind: 'request_snapshot',
      roomId,
      clientId,
      reason: 'manual',
      fromServerSeq: previousServerSeq,
    });
    for (let index = hostEnvelopes.length - 1; index >= 0; index -= 1) {
      const envelope = hostEnvelopes[index];
      if (
        envelope !== undefined &&
        envelope.kind === 'snapshot' &&
        envelope.serverSeq > previousServerSeq
      ) {
        return envelope;
      }
    }
    throw new Error(`Expected ${label} snapshot envelope`);
  };

  try {
    connection.send({
      kind: 'hello',
      roomId,
      clientId,
      protocolVersion: 'bridge-v1',
      coreVersion: 'sim-core',
    });

    const bootSnapshot = requestSnapshot(`${runId} boot`);
    const realtimeSignaturesById = new Map<string, string>();
    const bootRealtimeObjects = readPlayableCertificationRealtimeObjectsFromPayload(
      bootSnapshot.payload,
    );
    expect(bootRealtimeObjects.length).toBeGreaterThan(0);

    let sawRealtimeMovement = trackPlayableCertificationRealtimeMovement(
      bootRealtimeObjects,
      realtimeSignaturesById,
    );
    const bootTick = bootSnapshot.tick;

    // Magic-number source: speed-3 ambient cadence advances one realtime
    // `MoveObjects` pass per interval (`s_sim.c` + `w_sprite.c`), so twelve
    // intervals guarantee multiple observable overlay frames.
    vi.advanceTimersByTime(PLAYABLE_CERT_REALTIME_VISUAL_OBSERVE_DURATION_MS);

    const realtimePatches = hostEnvelopes.filter(
      (envelope): envelope is HostPatchEnvelope =>
        envelope.kind === 'patch' &&
        envelope.serverSeq > bootSnapshot.serverSeq &&
        readPlayableCertificationRealtimeObjectsFromPayload(envelope.payload).length > 0,
    );
    expect(realtimePatches.length).toBeGreaterThan(0);
    for (const patch of realtimePatches) {
      if (
        trackPlayableCertificationRealtimeMovement(
          readPlayableCertificationRealtimeObjectsFromPayload(patch.payload),
          realtimeSignaturesById,
        )
      ) {
        sawRealtimeMovement = true;
      }
    }

    const postObserveSnapshot = requestSnapshot(`${runId} realtime observe`);
    expect(postObserveSnapshot.tick).toBeGreaterThan(bootTick);
    if (
      trackPlayableCertificationRealtimeMovement(
        readPlayableCertificationRealtimeObjectsFromPayload(postObserveSnapshot.payload),
        realtimeSignaturesById,
      )
    ) {
      sawRealtimeMovement = true;
    }

    expect(sawRealtimeMovement).toBe(true);
  } finally {
    connection.disconnect();
    vi.useRealTimers();
  }
}

/**
 * Certifies Playable Certification in-map realtime/disaster visual movement on the shipped runtime path.
 * Mirrors host realtime sprite updates from `MoveObjects` in
 * `ref/micropolis/src/sim/w_sprite.c`, projected through Authoritative Runtime runtime state.
 */
function certifyPlayableCertificationRealtimeVisualEventOnRuntime(runId: string): void {
  vi.useFakeTimers();
  let sawRealtimePatch = false;
  let sawRealtimeMovement = false;
  const realtimeSignaturesById = new Map<string, string>();
  const runtime = createWebHostRuntime({
    host: createPlayableRuntimeHost(),
    roomId: `${runId}-room`,
    clientId: `${runId}-client`,
  });
  const unsubscribe = runtime.subscribe((event) => {
    if (event.envelope?.kind !== 'patch') {
      return;
    }
    const realtimeObjects = readPlayableCertificationRealtimeObjectsFromPayload(
      event.envelope.payload,
    );
    if (realtimeObjects.length === 0) {
      return;
    }
    sawRealtimePatch = true;
    if (trackPlayableCertificationRealtimeMovement(realtimeObjects, realtimeSignaturesById)) {
      sawRealtimeMovement = true;
    }
  });

  const requestSnapshotState = (): WebRuntimeState => {
    const previousServerSeq = runtime.getState().lastAppliedServerSeq;
    runtime.requestSnapshot('manual');
    const state = runtime.getState();
    expect(state.lastAppliedServerSeq).toBeGreaterThan(previousServerSeq);
    return state;
  };

  try {
    runtime.connect();

    const bootState = requestSnapshotState();
    expect(bootState.realtimeState.objects.length).toBeGreaterThan(0);
    sawRealtimeMovement =
      trackPlayableCertificationRealtimeMovement(
        bootState.realtimeState.objects,
        realtimeSignaturesById,
      ) || sawRealtimeMovement;
    const bootTick = bootState.lastAppliedTick;

    vi.advanceTimersByTime(PLAYABLE_CERT_REALTIME_VISUAL_OBSERVE_DURATION_MS);

    const postObserveState = requestSnapshotState();
    sawRealtimeMovement =
      trackPlayableCertificationRealtimeMovement(
        postObserveState.realtimeState.objects,
        realtimeSignaturesById,
      ) || sawRealtimeMovement;
    expect(postObserveState.lastAppliedTick).toBeGreaterThan(bootTick);
    expect(sawRealtimePatch).toBe(true);
    expect(sawRealtimeMovement).toBe(true);
  } finally {
    unsubscribe();
    runtime.disconnect();
    vi.useRealTimers();
  }
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
    expect(savePayload.cityBytes.byteLength).toBe(27120);

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
    expect(savePayload.cityBytes.byteLength).toBe(27120);

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
 * Certifies Playable Certification continuous 15-minute play-session responsiveness on host envelopes.
 * Mirrors ambient timer cadence gating from `setSpeed` / `Pause` / `Resume` in
 * `ref/micropolis/src/sim/w_util.c` and speed-3 `SimFrame` stepping in
 * `ref/micropolis/src/sim/s_sim.c`.
 * Parity note: fake timers accelerate wall-clock runtime only; authoritative
 * host envelope sequencing/tick progression semantics are unchanged.
 */
function certifyPlayableCertificationContinuousPlaySessionOnHost(runId: string): void {
  vi.useFakeTimers();
  const host = createPlayableRuntimeHost();
  let latestSnapshot: HostSnapshotEnvelope | null = null;
  let patchCount = 0;
  let rejectCount = 0;
  let lastServerSeq = 0;
  let lastTick = 0;
  const roomId = `${runId}-room`;
  const clientId = `${runId}-client`;
  const connection = host.connect((envelope) => {
    if ('serverSeq' in envelope) {
      expect(envelope.serverSeq).toBeGreaterThan(lastServerSeq);
      lastServerSeq = envelope.serverSeq;
    }
    if ('tick' in envelope) {
      expect(envelope.tick).toBeGreaterThanOrEqual(lastTick);
      lastTick = envelope.tick;
    }
    if (envelope.kind === 'snapshot') {
      latestSnapshot = envelope;
      return;
    }
    if (envelope.kind === 'patch') {
      patchCount += 1;
      return;
    }
    if (envelope.kind === 'reject') {
      rejectCount += 1;
    }
  });

  const requestSnapshot = (label: string): HostSnapshotEnvelope => {
    const previousSnapshotServerSeq = latestSnapshot?.serverSeq ?? 0;
    connection.send({
      kind: 'request_snapshot',
      roomId,
      clientId,
      reason: 'manual',
      fromServerSeq: lastServerSeq,
    });
    if (latestSnapshot === null || latestSnapshot.serverSeq <= previousSnapshotServerSeq) {
      throw new Error(`Expected ${label} snapshot envelope`);
    }
    return latestSnapshot;
  };

  try {
    connection.send({
      kind: 'hello',
      roomId,
      clientId,
      protocolVersion: 'bridge-v1',
      coreVersion: 'sim-core',
    });

    let snapshot = requestSnapshot(`${runId} boot`);
    const bootTick = snapshot.tick;
    expect(snapshot.payload.hud?.speed).toBe(3);

    for (
      let chunkIndex = 0;
      chunkIndex < PLAYABLE_CERT_CONTINUOUS_PLAY_CHUNK_COUNT;
      chunkIndex += 1
    ) {
      const beforeChunkTick = snapshot.tick;
      vi.advanceTimersByTime(PLAYABLE_CERT_CONTINUOUS_PLAY_CHUNK_DURATION_MS);
      snapshot = requestSnapshot(`${runId} chunk-${chunkIndex + 1}`);
      expect(snapshot.payload.hud?.speed).toBe(3);
      expect(snapshot.tick - beforeChunkTick).toBeGreaterThanOrEqual(
        PLAYABLE_CERT_CONTINUOUS_PLAY_EXPECTED_STEPS_PER_CHUNK,
      );
    }

    expect(snapshot.tick - bootTick).toBeGreaterThanOrEqual(
      PLAYABLE_CERT_CONTINUOUS_PLAY_EXPECTED_TOTAL_STEPS,
    );
    expect(patchCount).toBeGreaterThanOrEqual(PLAYABLE_CERT_CONTINUOUS_PLAY_EXPECTED_TOTAL_STEPS);
    expect(rejectCount).toBe(0);
  } finally {
    connection.disconnect();
    vi.useRealTimers();
  }
}

/**
 * Certifies Playable Certification continuous 15-minute play-session responsiveness on shipped runtime projection.
 * Mirrors authoritative speed-3 ambient stepping from `ref/micropolis/src/sim/s_sim.c`
 * projected through Authoritative Runtime runtime sequencing/reducer ownership.
 * Parity note: this validates shipped runtime envelope consumption under sustained load.
 */
function certifyPlayableCertificationContinuousPlaySessionOnRuntime(runId: string): void {
  vi.useFakeTimers();
  let patchCount = 0;
  let rejectCount = 0;
  let lastEnvelopeServerSeq = 0;
  let lastEnvelopeTick = 0;
  const runtime = createWebHostRuntime({
    host: createPlayableRuntimeHost(),
    roomId: `${runId}-room`,
    clientId: `${runId}-client`,
  });
  const unsubscribe = runtime.subscribe((event) => {
    const envelope = event.envelope;
    if (envelope === undefined) {
      return;
    }
    if ('serverSeq' in envelope) {
      expect(envelope.serverSeq).toBeGreaterThan(lastEnvelopeServerSeq);
      lastEnvelopeServerSeq = envelope.serverSeq;
    }
    if ('tick' in envelope) {
      expect(envelope.tick).toBeGreaterThanOrEqual(lastEnvelopeTick);
      lastEnvelopeTick = envelope.tick;
    }
    if (envelope.kind === 'patch') {
      patchCount += 1;
      return;
    }
    if (envelope.kind === 'reject') {
      rejectCount += 1;
    }
  });

  const requestSnapshotState = (label: string): WebRuntimeState => {
    const previousServerSeq = runtime.getState().lastAppliedServerSeq;
    runtime.requestSnapshot('manual');
    const state = runtime.getState();
    if (state.lastAppliedServerSeq <= previousServerSeq) {
      throw new Error(`Expected ${label} runtime snapshot state update`);
    }
    return state;
  };

  try {
    runtime.connect();

    let state = requestSnapshotState(`${runId} boot`);
    const bootTick = state.lastAppliedTick;
    expect(state.phase).toBe('ready');
    expect(state.hudState.speed).toBe(3);
    expect(state.pendingTools).toHaveLength(0);
    expect(state.lastRejectReason).toBeNull();

    for (
      let chunkIndex = 0;
      chunkIndex < PLAYABLE_CERT_CONTINUOUS_PLAY_CHUNK_COUNT;
      chunkIndex += 1
    ) {
      const beforeChunkTick = state.lastAppliedTick;
      vi.advanceTimersByTime(PLAYABLE_CERT_CONTINUOUS_PLAY_CHUNK_DURATION_MS);
      state = requestSnapshotState(`${runId} chunk-${chunkIndex + 1}`);
      expect(state.phase).toBe('ready');
      expect(state.hudState.speed).toBe(3);
      expect(state.pendingTools).toHaveLength(0);
      expect(state.lastRejectReason).toBeNull();
      expect(state.lastAppliedTick - beforeChunkTick).toBeGreaterThanOrEqual(
        PLAYABLE_CERT_CONTINUOUS_PLAY_EXPECTED_STEPS_PER_CHUNK,
      );
    }

    expect(state.lastAppliedTick - bootTick).toBeGreaterThanOrEqual(
      PLAYABLE_CERT_CONTINUOUS_PLAY_EXPECTED_TOTAL_STEPS,
    );
    expect(patchCount).toBeGreaterThanOrEqual(PLAYABLE_CERT_CONTINUOUS_PLAY_EXPECTED_TOTAL_STEPS);
    expect(rejectCount).toBe(0);
  } finally {
    unsubscribe();
    runtime.disconnect();
    vi.useRealTimers();
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
    expect(bootSnapshot.payload.realtime?.objects?.length ?? 0).toBeGreaterThan(0);

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
    await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostSnapshotEnvelope =>
        envelope.kind === 'snapshot' && envelope.serverSeq > newCityAck.serverSeq,
      `${runId} new-city snapshot`,
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
    // Magic number source: road cost `10` from `CostOf[]` in
    // `ref/micropolis/src/sim/w_tool.c`.
    expect(roadFundsPatch.payload.hud?.funds).toBe(19_990);
    expect(roadFundsPatch.payload.hud?.date).toBeDefined();

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
        envelope.kind === 'patch' &&
        envelope.serverSeq > speedOneAck.serverSeq &&
        envelope.payload.hud?.speed === 1,
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
        envelope.kind === 'patch' &&
        envelope.serverSeq > pauseAck.serverSeq &&
        envelope.payload.hud?.speed === 0,
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
    const playPatch = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostPatchEnvelope =>
        envelope.kind === 'patch' &&
        envelope.serverSeq > playAck.serverSeq &&
        envelope.payload.hud?.speed === 1,
      `${runId} play patch`,
    );
    expect(playPatch.payload.realtime?.objects?.length ?? 0).toBeGreaterThan(0);

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
        envelope.kind === 'patch' &&
        envelope.serverSeq > speedThreeAck.serverSeq &&
        envelope.payload.hud?.speed === 3,
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
    expect(savePatch.payload.messageDeltas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 30,
        }),
      ]),
    );

    // Magic number source: `.cty` city payload byte count in `s_fileio.c`.
    expect(savePayload.cityBytes.byteLength).toBe(27120);

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
    // Magic number source: bulldozer cost `1` from `CostOf[]` in
    // `ref/micropolis/src/sim/w_tool.c`.
    expect(bulldozeFundsPatch.payload.hud?.funds).toBe(19_989);

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
    // Magic number source: restore returns to the saved post-road funds value
    // (`20000 - 10`) using `SaveCityAs`/`loadFile` parity in `s_fileio.c`.
    expect(loadSnapshot.payload.hud?.funds).toBe(19_990);
    expect(loadSnapshot.payload.messages?.[0]?.text).toContain('Loaded');

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.scenario,
      command: {
        kind: 'scenario',
        action: 'load-scenario',
        scenarioId: 1,
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
    expect(scenarioSnapshot.payload.hud?.funds).toBe(5_000);
    expect(scenarioSnapshot.payload.hud?.date?.year).toBe(1900);
    // Magic number source: `LoadScenario` applies visible speed `3` after init
    // in `ref/micropolis/src/sim/s_fileio.c`.
    expect(scenarioSnapshot.payload.hud?.speed).toBe(3);
    expect(scenarioSnapshot.payload.realtime?.objects?.length ?? 0).toBeGreaterThan(0);

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
    expect(resyncSnapshot.payload.hud?.funds).toBe(5_000);

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

  test('certifies host tool placements for road/rail/wire/bulldoze/R/C/I costs/rejects/funds', async () => {
    await certifyPlayableCertificationPlayableToolCostsOnHost('playable-cert-tool-costs-host');
  }, 15_000);

  test('certifies runtime tool placements for road/rail/wire/bulldoze/R/C/I costs/rejects/funds', async () => {
    await certifyPlayableCertificationPlayableToolCostsOnRuntime(
      'playable-cert-tool-costs-runtime',
    );
  }, 15_000);

  test('certifies host speed 1/2/3 with pause/resume cadence changes', () => {
    certifyPlayableCertificationPlayableCadenceOnHost('playable-cert-cadence-host');
  });

  test('certifies runtime speed 1/2/3 with pause/resume cadence changes on Authoritative Runtime route', () => {
    certifyPlayableCertificationPlayableCadenceOnRuntime('playable-cert-cadence-runtime');
  });

  test('certifies host heads + message feed updates during normal simulation', () => {
    certifyPlayableCertificationHeadsAndMessagesOnHost('playable-cert-heads-messages-host');
  });

  test('certifies runtime heads + message feed updates during normal simulation on Authoritative Runtime route', () => {
    certifyPlayableCertificationHeadsAndMessagesOnRuntime('playable-cert-heads-messages-runtime');
  });

  test('certifies host realtime/disaster visual event appears in-map', () => {
    certifyPlayableCertificationRealtimeVisualEventOnHost('playable-cert-realtime-visual-host');
  });

  test('certifies runtime realtime/disaster visual event appears in-map on Authoritative Runtime route', () => {
    certifyPlayableCertificationRealtimeVisualEventOnRuntime(
      'playable-cert-realtime-visual-runtime',
    );
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

  test('certifies host continuous 15-minute play session responsiveness', () => {
    certifyPlayableCertificationContinuousPlaySessionOnHost('playable-cert-continuous-play-host');
  });

  test('certifies runtime continuous 15-minute play session responsiveness on Authoritative Runtime route', () => {
    certifyPlayableCertificationContinuousPlaySessionOnRuntime(
      'playable-cert-continuous-play-runtime',
    );
  });

  test('proves the shipped Authoritative Runtime host path is playable end-to-end', async () => {
    const summary = await runPlayableRuntimeSmokeFlow('playable-runtime-smoke-main');
    expect(summary.rejectReasons).toEqual(['invalid-command']);
  });

  test('remains deterministic across repeated Authoritative Runtime smoke runs', async () => {
    const run1 = await runPlayableRuntimeSmokeFlow('playable-runtime-smoke-repeat-1');
    const run2 = await runPlayableRuntimeSmokeFlow('playable-runtime-smoke-repeat-2');
    const run3 = await runPlayableRuntimeSmokeFlow('playable-runtime-smoke-repeat-3');

    expect(run2).toStrictEqual(run1);
    expect(run3).toStrictEqual(run1);
  });
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
});
