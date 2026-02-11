import type { readFile as nodeReadFile } from 'node:fs/promises';

import { getCoreBridgeV1SnapshotTileIndex } from '../../../../../packages/core-bridge/src/types.ts';
import { resolveSimUiPlayableToolDidToolSoundIntent } from '../../../../../packages/sim-assets/src/sim-ui.ts';
import {
  applyToolAction,
  cityEvaluation,
  clearCensus,
  collectTax,
  consumeMapRedrawPlan,
  createBridgeHandler,
  createFireHandler,
  createFloodHandler,
  createRadHandler,
  createRailHandler,
  createRealtimeContext,
  createRoadHandler,
  createZoneHandler,
  crimeScan,
  decROGMem,
  decTrafficMem,
  destroyAllSprites as destroyRealtimeSprites,
  doDisasters,
  fireAnalysis,
  generateCopter as generateRealtimeCopter,
  generatePlane as generateRealtimePlane,
  generateShip as generateRealtimeShip,
  generateTrain as generateRealtimeTrain,
  getSprite as getRealtimeSprite,
  makeEarthquake,
  makeExplosion as makeRealtimeExplosion,
  makeExplosionAt as makeRealtimeExplosionAt,
  makeFire,
  makeFlood,
  makeMeltdown,
  makeMonster as makeRealtimeMonster,
  makeTornado as makeRealtimeTornado,
  MAP_FLAGS,
  type MapRedrawPlan,
  type MapScanHandlers,
  type Patch,
  planMapRedraw,
  popDenScan,
  ptlScan,
  type RealtimeContext,
  resetForNewCityFromSeed,
  resolveDoMessageHookSoundIntent,
  runMapScanPhase,
  runRealtimeTick,
  runSimLoop,
  runUiUpdate,
  sendMessages,
  setValves,
  type SimMapFlag,
  type SimPhaseSystems,
  type SimSprite,
  take2Census,
  takeCensus,
  type ToolResult,
} from '../../../../../packages/sim-core/src/index.ts';
import { setFunds } from '../../../../../packages/sim-core/src/systems/funds.ts';
import { doPowerScan } from '../../../../../packages/sim-core/src/systems/power.ts';
import { loadCityLikeC, loadScenarioLikeC } from '../../../../../packages/sim-io/src/load.ts';
import { saveCityAsLikeC } from '../../../../../packages/sim-io/src/save.ts';
import {
  getScenarioDefinition,
  SCENARIO_TABLE,
} from '../../../../../packages/sim-io/src/scenarios.ts';
import { SimCoreRuntimeState } from '../sim-core-runtime-state.ts';
import type { PlayableDisasterChoiceId } from './playable-disaster-choices.ts';
import type { PlayableRuntimeHostOptions } from './playable-runtime-host-options.ts';
import type {
  ClientEnvelope,
  CoreHost,
  CoreHostConnection,
  HostEnvelope,
  HostHudMessagePayload,
  HostHudOptionsPayload,
  HostHudPayload,
  HostMapPatchTileWordDelta,
  HostMapRedrawPlanPayload,
  HostPatchPayload,
  HostRealtimeObjectDeltaPayload,
  HostRealtimeObjectPayload,
  HostSnapshotPayload,
  HostSoundDeltaPayload,
  PlayableClientCommand,
} from './protocol.ts';

type PlayableToolCommand = Extract<PlayableClientCommand, { kind: 'tool' }>;
type PlayableSimControlCommand = Extract<PlayableClientCommand, { kind: 'sim-control' }>;
type PlayableCityLifecycleCommand = Extract<PlayableClientCommand, { kind: 'city-lifecycle' }>;
type PlayableCityIoCommand = Extract<PlayableClientCommand, { kind: 'city-io' }>;
type PlayableScenarioCommand = Extract<PlayableClientCommand, { kind: 'scenario' }>;
type PlayableSaveCityCommand = Extract<PlayableCityIoCommand, { action: 'save-city' }>;
type PlayableLoadCityCommand = Extract<PlayableCityIoCommand, { action: 'load-city' }>;
type CommandClientEnvelope = Extract<ClientEnvelope, { kind: 'command' }>;
interface AmbientTickQueueItem {
  kind: 'ambient-tick';
}
type SessionQueueItem = CommandClientEnvelope | AmbientTickQueueItem;
type SequencedHostEnvelope = Exclude<HostEnvelope, { kind: 'hello' }>;
type ManualRealtimeEventId = PlayableDisasterChoiceId;
type DistributiveOmit<TValue, TKey extends PropertyKey> = TValue extends unknown
  ? Omit<TValue, TKey>
  : never;
type SequencedHostEnvelopeWithoutServerSeq = DistributiveOmit<SequencedHostEnvelope, 'serverSeq'>;
interface SnapshotReplayCheckpoint {
  tick: number;
  payload: HostSnapshotPayload;
}
interface ReplayLogEntry {
  envelope: SequencedHostEnvelope;
  replayTailEligible: boolean;
}
interface EmitSequencedEnvelopeOptions {
  replayTailEligible?: boolean;
  recordMessages?: boolean;
  includeQueuedSoundDeltas?: boolean;
}
interface SessionCommandQueueState {
  pending: SessionQueueItem[];
  draining: boolean;
}
interface ToolCommandOutcome {
  rejectReason: string | undefined;
  mapPatch: Patch | null;
}
type HudUiSetKey =
  | 'funds'
  | 'date'
  | 'dateMonth'
  | 'dateYear'
  | 'demandR'
  | 'demandC'
  | 'demandI'
  | 'speed'
  | 'optionAutoBudget'
  | 'optionAutoGo'
  | 'optionAutoBulldoze'
  | 'optionDisasters'
  | 'optionUserSoundOn'
  | 'optionDoAnimation'
  | 'optionDoMessages'
  | 'optionDoNotices';

interface HookHudState {
  fundsLabel: string;
  dateLabel: string;
  dateMonth: number;
  dateYear: number;
  demandR: number;
  demandC: number;
  demandI: number;
  options: HostHudOptionsPayload;
}
type HostRealtimeObjectWithIdPayload = HostRealtimeObjectPayload & { id: string };

const DEFAULT_CITY_FILE_NAME = 'newcity.cty';
const DEFAULT_CITY_NAME = 'New City';
const MESSAGE_LOG_LIMIT = 24;
const NEW_CITY_STARTING_FUNDS = 20_000;
const NEW_CITY_TREE_LEVEL = -1;
const NEW_CITY_LAKE_LEVEL = -1;
const NEW_CITY_CURVE_LEVEL = -1;
const NEW_CITY_CREATE_ISLAND = -1;
// C runtime timer default from `sim_delay = 50` in `ref/micropolis/src/sim/sim.c`.
const DEFAULT_PATCH_INTERVAL_MS = 50;
// `map_state` index 0 selects `ALMAP` in `setUpMapProcs` (`g_map.c`).
const ACTIVE_MAP_STATE = 0;
const TOOL_SOUND_CHANNEL = 'edit';
const TOOL_SOUND_SCOPE_TARGET = '.playMap';
const TOOL_SOUND_SCOPE: HostSoundDeltaPayload['scope'] = {
  kind: 'view',
  target: TOOL_SOUND_SCOPE_TARGET,
};
const TOOL_ERROR_SOUND_SPEC_BY_REJECT_REASON = Object.freeze({
  'out-of-bounds': 'UhUh',
  'no-funds': 'Sorry',
  'invalid-placement': 'UhUh',
} satisfies Record<'out-of-bounds' | 'no-funds' | 'invalid-placement', string>);
const SCENARIO_RESOURCE_URLS = createScenarioResourceUrlTable();
const RUNTIME_MESSAGE_TEXT: Record<number, string> = {
  1: 'Need more residential zones.',
  2: 'Need more commercial zones.',
  3: 'Need more industrial zones.',
  4: 'Build more roads.',
  5: 'Build more rail.',
  6: 'Need power plants.',
  13: 'Residents demand fire stations.',
  14: 'Residents demand police stations.',
  16: 'City taxes are too high.',
  17: 'Road maintenance is low.',
  18: 'Fire coverage is low.',
  19: 'Police coverage is low.',
  20: 'Fire reported.',
  21: 'Monster sighted.',
  22: 'Tornado sighted.',
  23: 'Earthquake reported.',
  24: 'Plane crash reported.',
  25: 'Shipwreck reported.',
  26: 'Train crash reported.',
  27: 'Helicopter crash reported.',
  30: 'Explosion reported.',
  32: 'Explosion reported.',
  41: 'Heavy traffic reported.',
  42: 'Flooding reported.',
  [-20]: 'Fire reported.',
  [-21]: 'Monster sighted.',
  [-22]: 'Tornado sighted.',
  [-23]: 'Earthquake reported.',
  [-24]: 'Plane crash reported.',
  [-25]: 'Shipwreck reported.',
  [-26]: 'Train crash reported.',
  [-27]: 'Helicopter crash reported.',
  [-30]: 'Explosion reported.',
  [-41]: 'Heavy traffic reported.',
  [-42]: 'Flooding reported.',
  [-10]: 'Pollution has reached dangerous levels.',
  [-11]: 'Crime is out of control.',
  [-12]: 'Traffic is congested.',
};
type NodeFsPromisesModule = {
  readFile: typeof nodeReadFile;
};

/**
 * Sim-core-authoritative envelope host for the route `/` migration path.
 * Mirrors host-side command/update loop ownership from
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_update.c`.
 * Parity note: this phase establishes the deterministic envelope lifecycle and
 * authoritative snapshot surface; full command semantics are migrated in
 * subsequent checklist tasks. `PlayableRuntimeHostOptions` now only carries
 * scenario resource byte loading overrides used for deterministic scenario tests.
 * Stage note: city lifecycle and city save/load commands now route through
 * sim-core reset flow plus `sim-io` load/save helpers from
 * `ref/micropolis/src/sim/s_gen.c` and `ref/micropolis/src/sim/s_fileio.c`.
 */
export class SimCoreEnvelopeHost implements CoreHost {
  private onEnvelope: ((envelope: HostEnvelope) => void) | undefined;
  private lifecycle:
    | {
        phase: 'disconnected';
      }
    | {
        phase: 'awaiting-hello';
        sessionId: number;
      }
    | {
        phase: 'ready';
        sessionId: number;
        roomId: string;
        clientId: string;
      } = { phase: 'disconnected' };
  private nextSessionId = 0;
  private readonly authorityState: SimCoreRuntimeState;
  private readonly mapWidth: number;
  private readonly mapHeight: number;
  private serverSeq = 0;
  private lastEmittedServerSeq = 0;
  private tick = 0;
  private lastEmittedTick = 0;
  private simPaused = false;
  private simPausedSpeed = 3;
  private cityFileName = DEFAULT_CITY_FILE_NAME;
  private cityName = DEFAULT_CITY_NAME;
  private readonly sequencedReplayLog: ReplayLogEntry[] = [];
  private readonly snapshotReplayCheckpoints = new Map<number, SnapshotReplayCheckpoint>();
  private readonly scenarioResourceBytesCache = new Map<string, Promise<Uint8Array>>();
  private readonly sessionCommandQueues = new Map<number, SessionCommandQueueState>();
  private readonly simPhaseSystems: SimPhaseSystems;
  private readonly enableAmbientTicks: boolean;
  private readonly patchIntervalMs: number | undefined;
  private intervalHandle: ReturnType<typeof setInterval> | undefined;
  private readonly scenarioResourceLoader: (fileName: string) => Promise<Uint8Array>;
  private readonly hookHudState: HookHudState = createInitialHookHudState();
  private readonly pendingHudUiSetKeys = new Set<HudUiSetKey>();
  private pendingHookMessages: HostHudMessagePayload[] = [];
  private readonly pendingSoundDeltasByTick = new Map<number, HostSoundDeltaPayload[]>();
  private readonly messageLog: HostHudMessagePayload[] = [];
  private readonly realtimeContext: RealtimeContext;
  private readonly realtimeObjectIds = new WeakMap<SimSprite, string>();
  private nextRealtimeObjectId = 1;
  private lastRealtimeObjectsById = new Map<string, HostRealtimeObjectWithIdPayload>();

  public constructor(options: PlayableRuntimeHostOptions = {}) {
    this.authorityState = new SimCoreRuntimeState({
      hooks: {
        uiSet: (key, value) => this.captureUiSet(key, value),
        makeSound: (channel, sound) => this.captureSimCoreHookSound(channel, sound),
        sendMes: (id) => this.captureMessage(id),
        sendMesAt: (id, x, y) => this.captureMessageAt(id, x, y),
      },
    });
    const mapLayerInfo = this.authorityState.store.layerInfo('map');
    this.mapWidth = mapLayerInfo.width;
    this.mapHeight = mapLayerInfo.height;
    this.simPausedSpeed = normalizePlayableSpeed(this.authorityState.simState.SimMetaSpeed);
    this.realtimeContext = createRealtimeContext({
      store: this.authorityState.simContext.store,
      rng: this.authorityState.simContext.rng,
      toolContext: this.authorityState.toolContext,
      onSound: (channel, soundSpec) => this.captureRealtimeSound(channel, soundSpec),
      simSpeed: this.authorityState.simState.SimSpeed,
      doAnimation: this.authorityState.simState.doAnimation,
      noDisasters: this.authorityState.simState.NoDisasters,
      scenarioId: this.authorityState.simState.ScenarioID,
      totalPop: this.authorityState.simState.TotalPop,
      polMaxX: this.authorityState.simState.PolMaxX,
      polMaxY: this.authorityState.simState.PolMaxY,
      messageCoupling: {
        state: this.authorityState.simState,
        context: this.authorityState.simContext,
      },
    });
    this.simPhaseSystems = createEnvelopeHostSimPhaseSystems();
    this.enableAmbientTicks = options.enableAmbientTicks ?? false;
    this.patchIntervalMs = normalizePatchIntervalMs(options.patchIntervalMs);
    this.installRealtimeHooks();
    const scenarioResourceLoader = options.scenarioResourceLoader;
    this.scenarioResourceLoader =
      scenarioResourceLoader === undefined
        ? (fileName) => this.loadScenarioResourceBytes(fileName)
        : (fileName) => Promise.resolve(scenarioResourceLoader(fileName));
    this.refreshHookDrivenHud();
    this.pendingHudUiSetKeys.clear();
    this.snapshotReplayCheckpoints.set(0, {
      tick: 0,
      payload: this.buildSnapshotPayload(),
    });
  }

  public connect(onEnvelope: (envelope: HostEnvelope) => void): CoreHostConnection {
    const sessionId = this.beginSession(onEnvelope);

    return {
      send: (envelope) => {
        this.routeClientEnvelope(sessionId, envelope);
      },
      disconnect: () => {
        this.routeDisconnect(sessionId);
      },
    };
  }

  /**
   * Triggers one manual disaster event from playable route disaster controls.
   * Mirrors Disasters menu entrypoints in `ref/micropolis/res/whead.tcl` with
   * disaster handlers in `ref/micropolis/src/sim/s_disast.c` and sprite
   * handlers in `ref/micropolis/src/sim/w_sprite.c`.
   * Parity note: this settles as one sequenced patch tick (no command ack),
   * using sim-core disaster/realtime hooks plus standard map/HUD/message/realtime
   * payload emission for route reducer compatibility.
   */
  public triggerManualRealtimeEvent(eventId: ManualRealtimeEventId): boolean {
    if (this.onEnvelope === undefined || this.lifecycle.phase !== 'ready') {
      return false;
    }

    this.advanceCommandTick();
    let mapPatch: Patch | null = null;
    this.authorityState.simContext.store.beginTick();
    try {
      this.syncRealtimeContextFromSimState();
      this.applyManualRealtimeEvent(eventId);
    } finally {
      const tickResult = this.authorityState.simContext.store.commitTick();
      mapPatch = readMapPatchFromTickResult(tickResult.patches);
    }

    this.emitPatch(
      this.lifecycle.roomId,
      this.lifecycle.clientId,
      this.buildPatchPayload(mapPatch),
    );
    return true;
  }

  /**
   * Routes client envelopes through one deterministic host lifecycle.
   * Mirrors top-level command/update dispatch structure in
   * `ref/micropolis/src/sim/w_sim.c`.
   */
  private routeClientEnvelope(sessionId: number, envelope: ClientEnvelope): void {
    if (!this.isSessionActive(sessionId)) {
      return;
    }

    if (envelope.kind === 'hello') {
      this.handleHelloEnvelope(sessionId, envelope);
      return;
    }

    if (envelope.kind === 'request_snapshot') {
      this.handleSnapshotRequestEnvelope(sessionId, envelope);
      return;
    }

    this.enqueueCommandEnvelope(sessionId, envelope);
  }

  private beginSession(onEnvelope: (envelope: HostEnvelope) => void): number {
    this.nextSessionId += 1;
    const sessionId = this.nextSessionId;
    this.onEnvelope = onEnvelope;
    this.lifecycle = {
      phase: 'awaiting-hello',
      sessionId,
    };
    this.sessionCommandQueues.set(sessionId, {
      pending: [],
      draining: false,
    });
    return sessionId;
  }

  private routeDisconnect(sessionId: number): void {
    if (!this.isSessionActive(sessionId)) {
      return;
    }

    this.stopAmbientInterval();
    this.onEnvelope = undefined;
    this.lifecycle = { phase: 'disconnected' };
    this.sessionCommandQueues.delete(sessionId);
  }

  /**
   * Enqueues one command envelope for deterministic per-session settlement order.
   * Mirrors serial `SimCmd` processing order in `ref/micropolis/src/sim/w_sim.c`.
   * Parity note: async scenario loads are serialized with sync command settlement
   * so reducer-facing `ack`/`reject`/`patch`/`snapshot` ordering is deterministic.
   */
  private enqueueCommandEnvelope(sessionId: number, envelope: CommandClientEnvelope): void {
    const sessionQueue = this.readOrCreateSessionCommandQueue(sessionId);
    sessionQueue.pending.push(envelope);
    this.drainSessionCommandQueue(sessionId, sessionQueue);
  }

  /**
   * Enqueues one ambient simulation step for serialized session settlement.
   * Mirrors periodic timer-driven `sim_loop` ownership in
   * `ref/micropolis/src/sim/sim.c`, while preserving single-queue ordering.
   */
  private enqueueAmbientTick(sessionId: number): void {
    if (
      !this.isSessionActive(sessionId) ||
      this.lifecycle.phase !== 'ready' ||
      this.authorityState.simState.SimSpeed === 0
    ) {
      return;
    }

    const sessionQueue = this.readOrCreateSessionCommandQueue(sessionId);
    sessionQueue.pending.push({ kind: 'ambient-tick' });
    this.drainSessionCommandQueue(sessionId, sessionQueue);
  }

  /**
   * Reads or creates one per-session command queue container.
   * Mirrors per-client command ownership in `ref/micropolis/src/sim/w_sim.c`.
   * Parity note: bridge host tracks this queue explicitly to serialize async
   * and sync command settlement without cross-session coupling.
   */
  private readOrCreateSessionCommandQueue(sessionId: number): SessionCommandQueueState {
    const existingQueue = this.sessionCommandQueues.get(sessionId);
    if (existingQueue !== undefined) {
      return existingQueue;
    }

    const queue: SessionCommandQueueState = {
      pending: [],
      draining: false,
    };
    this.sessionCommandQueues.set(sessionId, queue);
    return queue;
  }

  /**
   * Starts draining one session command queue if it is currently idle.
   * Mirrors forward-only command dispatch progression in
   * `ref/micropolis/src/sim/w_sim.c`.
   */
  private drainSessionCommandQueue(sessionId: number, queue: SessionCommandQueueState): void {
    if (queue.draining) {
      return;
    }
    queue.draining = true;
    void this.processSessionCommandQueueAsync(sessionId, queue);
  }

  /**
   * Drains queued session actions sequentially for one active session.
   * Mirrors serial command settlement expectations from
   * `ref/micropolis/src/sim/w_sim.c`; difference: this bridge host awaits async
   * scenario resource loads before settling later queued commands and ambient ticks.
   */
  private async processSessionCommandQueueAsync(
    sessionId: number,
    queue: SessionCommandQueueState,
  ): Promise<void> {
    try {
      while (queue.pending.length > 0) {
        const queuedItem = queue.pending.shift();
        if (queuedItem === undefined) {
          continue;
        }

        if (queuedItem.kind === 'command') {
          const pendingAsyncSettlement = this.handleCommandEnvelope(sessionId, queuedItem);
          if (pendingAsyncSettlement !== undefined) {
            await pendingAsyncSettlement;
          }
          continue;
        }

        this.handleAmbientTick(sessionId);
      }
    } finally {
      queue.draining = false;
      if (queue.pending.length > 0) {
        this.drainSessionCommandQueue(sessionId, queue);
      } else if (!this.isSessionActive(sessionId)) {
        const activeQueue = this.sessionCommandQueues.get(sessionId);
        if (activeQueue === queue) {
          this.sessionCommandQueues.delete(sessionId);
        }
      }
    }
  }

  private handleHelloEnvelope(
    sessionId: number,
    envelope: Extract<ClientEnvelope, { kind: 'hello' }>,
  ): void {
    if (!this.isSessionActive(sessionId) || this.onEnvelope === undefined) {
      return;
    }

    this.lifecycle = {
      phase: 'ready',
      sessionId,
      roomId: envelope.roomId,
      clientId: envelope.clientId,
    };
    this.onEnvelope({
      kind: 'hello',
      roomId: envelope.roomId,
      clientId: envelope.clientId,
      protocolVersion: envelope.protocolVersion,
      coreVersion: envelope.coreVersion,
      accepted: true,
    });
    this.emitSnapshot(envelope.roomId, envelope.clientId, this.tick, {
      replayTailEligible: false,
    });
    this.refreshAmbientInterval();
  }

  private handleSnapshotRequestEnvelope(
    sessionId: number,
    envelope: Extract<ClientEnvelope, { kind: 'request_snapshot' }>,
  ): void {
    if (!this.isReadySessionEnvelope(sessionId, envelope.roomId, envelope.clientId)) {
      return;
    }

    const replayCursor = normalizeReplayCursor(envelope.fromServerSeq, this.lastEmittedServerSeq);
    this.emitSnapshotReplay(envelope.roomId, envelope.clientId, replayCursor);
  }

  private handleCommandEnvelope(
    sessionId: number,
    envelope: CommandClientEnvelope,
  ): Promise<void> | undefined {
    if (!this.isReadySessionEnvelope(sessionId, envelope.roomId, envelope.clientId)) {
      return undefined;
    }

    if (this.onEnvelope === undefined) {
      return undefined;
    }

    this.advanceCommandTick();
    if (envelope.command.kind === 'tool') {
      const toolOutcome = this.applyToolCommand(envelope.command);
      if (toolOutcome.rejectReason !== undefined) {
        const soundDeltas = this.buildToolRejectSoundDeltas(toolOutcome.rejectReason);
        this.emitReject(
          envelope.roomId,
          envelope.clientId,
          envelope.commandId,
          toolOutcome.rejectReason,
          this.tick,
          soundDeltas.length === 0 ? undefined : soundDeltas,
        );
        return undefined;
      }

      const soundDeltas = this.buildToolSuccessSoundDeltas(envelope.command.tool);
      this.emitAck(
        envelope.roomId,
        envelope.clientId,
        envelope.commandId,
        this.tick,
        soundDeltas.length === 0 ? undefined : soundDeltas,
      );
      this.emitPatch(
        envelope.roomId,
        envelope.clientId,
        this.buildPatchPayload(toolOutcome.mapPatch),
      );
      return undefined;
    }

    if (envelope.command.kind === 'sim-control') {
      this.applySimControlCommand(envelope.command);
      this.emitAck(envelope.roomId, envelope.clientId, envelope.commandId);
      this.emitPatch(envelope.roomId, envelope.clientId, this.buildPatchPayload(null));
      return undefined;
    }

    if (envelope.command.kind === 'city-lifecycle') {
      this.applyCityLifecycleCommand(envelope.command);
      this.emitAck(envelope.roomId, envelope.clientId, envelope.commandId);
      this.emitSnapshot(envelope.roomId, envelope.clientId);
      return undefined;
    }

    if (envelope.command.kind === 'city-io') {
      const cityIoOutcome = this.applyCityIoCommand(envelope.command);
      if (cityIoOutcome.kind === 'reject') {
        this.emitReject(
          envelope.roomId,
          envelope.clientId,
          envelope.commandId,
          cityIoOutcome.reason,
        );
        return undefined;
      }

      this.emitAck(envelope.roomId, envelope.clientId, envelope.commandId);
      if (cityIoOutcome.kind === 'save') {
        this.emitPatch(
          envelope.roomId,
          envelope.clientId,
          this.buildPatchPayload(null, cityIoOutcome.patchPayload),
        );
        return undefined;
      }

      this.emitSnapshot(envelope.roomId, envelope.clientId);
      return undefined;
    }

    if (envelope.command.kind === 'scenario') {
      const commandTick = this.tick;
      return this.applyScenarioCommandAsync(
        sessionId,
        envelope.roomId,
        envelope.clientId,
        envelope.commandId,
        envelope.command,
        commandTick,
      );
    }

    this.emitReject(envelope.roomId, envelope.clientId, envelope.commandId, 'invalid-command');
    return undefined;
  }

  /**
   * Settles one ambient simulation step through authoritative sim-core state.
   * Mirrors timer-driven `sim_loop` ownership in `ref/micropolis/src/sim/sim.c`
   * and envelope patch propagation intent in `ref/micropolis/src/sim/w_update.c`.
   */
  private handleAmbientTick(sessionId: number): void {
    if (
      !this.isSessionActive(sessionId) ||
      this.lifecycle.phase !== 'ready' ||
      this.onEnvelope === undefined
    ) {
      return;
    }

    if (this.authorityState.simState.SimSpeed === 0) {
      this.refreshAmbientInterval();
      return;
    }

    const { roomId, clientId } = this.lifecycle;
    this.advanceCommandTick();
    let mapPatch: Patch | null = null;
    this.authorityState.simContext.store.beginTick();
    try {
      this.syncRealtimeContextFromSimState();
      runSimLoop(
        this.authorityState.simState,
        this.authorityState.simContext,
        this.simPhaseSystems,
      );
      this.syncToolContextFromState();
    } finally {
      const tickResult = this.authorityState.simContext.store.commitTick();
      mapPatch = readMapPatchFromTickResult(tickResult.patches);
    }

    this.emitPatch(roomId, clientId, this.buildPatchPayload(mapPatch));
  }

  /**
   * Emits one command acknowledgement envelope.
   * Mirrors command-settlement acknowledgement ordering from `SimCmd` handling in
   * `ref/micropolis/src/sim/w_sim.c`, adapted to typed bridge envelopes.
   */
  private emitAck(
    roomId: string,
    clientId: string,
    commandId: string,
    tickOverride = this.tick,
    soundDeltas?: readonly HostSoundDeltaPayload[],
  ): void {
    this.emitSequencedEnvelope({
      kind: 'ack',
      roomId,
      clientId,
      tick: tickOverride,
      commandId,
      ...(soundDeltas === undefined ? {} : { soundDeltas }),
    });
  }

  /**
   * Emits one command rejection envelope.
   * Mirrors command-denial settlement ordering from `SimCmd` handling in
   * `ref/micropolis/src/sim/w_sim.c`, adapted to typed bridge envelopes.
   */
  private emitReject(
    roomId: string,
    clientId: string,
    commandId: string,
    reason: string,
    tickOverride = this.tick,
    soundDeltas?: readonly HostSoundDeltaPayload[],
  ): void {
    this.emitSequencedEnvelope({
      kind: 'reject',
      roomId,
      clientId,
      tick: tickOverride,
      commandId,
      reason,
      ...(soundDeltas === undefined ? {} : { soundDeltas }),
    });
  }

  /**
   * Emits one incremental patch envelope.
   * Mirrors per-tick update propagation intent from
   * `ref/micropolis/src/sim/w_update.c`.
   */
  private emitPatch(roomId: string, clientId: string, payload: HostPatchPayload): void {
    this.emitSequencedEnvelope({
      kind: 'patch',
      roomId,
      clientId,
      tick: this.tick,
      payload,
    });
  }

  /**
   * Builds one authoritative patch payload including map/HUD/message/realtime deltas.
   * Mirrors `DoUpdateMap` invalidation ownership in
   * `ref/micropolis/src/sim/w_map.c` and map-update cycle clearing in
   * `ref/micropolis/src/sim/sim.c`, plus sprite stream projection from
   * `ref/micropolis/src/sim/w_sprite.c`.
   * Parity note: redraw policy is planned by sim-core (`planMapRedraw`) and
   * consumed through `consumeMapRedrawPlan`; realtime stream fields remain
   * bridge transport metadata over C in-process sprite structs.
   */
  private buildPatchPayload(
    mapPatch: Patch | null,
    basePayload: HostPatchPayload = {},
  ): HostPatchPayload {
    this.refreshHookDrivenHud();
    this.syncRealtimeContextFromSimState();

    const payload: HostPatchPayload = { ...basePayload };
    const hudPayload = this.consumePendingHudPatchPayload();
    if (hudPayload !== undefined) {
      payload.hud = hudPayload;
    }
    const mapPayload = this.buildMapPatchPayload(mapPatch);
    if (mapPayload !== undefined) {
      payload.map = mapPayload;
    }
    const messageDeltas = this.drainPendingHookMessages();
    if (messageDeltas.length > 0) {
      const canonicalMessageDeltas = cloneHostHudMessagePayloadList(messageDeltas);
      payload.messageDeltas = canonicalMessageDeltas;
      payload.messages = cloneHostHudMessagePayloadList(canonicalMessageDeltas);
      payload.hud = withLegacyHudMessageCompatibility(payload.hud, canonicalMessageDeltas);
    }
    const realtimePayload = this.buildRealtimeDeltaPayload();
    if (realtimePayload !== undefined) {
      payload.realtime = realtimePayload;
    }
    return payload;
  }

  /**
   * Builds one map patch payload from authoritative map patch + redraw signals.
   * Mirrors per-cycle map update invalidation gating in `DoUpdateMap`
   * (`ref/micropolis/src/sim/w_map.c`).
   * Parity note: coordinate deltas are projected from classic map indexes
   * (`x * WORLD_Y + y`) while redraw decisions stay in sim-core invalidation helpers.
   */
  private buildMapPatchPayload(mapPatch: Patch | null): HostPatchPayload['map'] | undefined {
    const redrawPlan = this.planAndConsumeMapRedraw(mapPatch);
    const tileWordDeltas = toHostMapTileWordDeltas(mapPatch, this.mapHeight);
    const hasPlanDrivenRedraw = redrawPlan.fullRedraw || redrawPlan.dirtyRects.length > 0;
    if (tileWordDeltas.length === 0 && !hasPlanDrivenRedraw) {
      return undefined;
    }

    return {
      tileWordDeltas,
      redrawPlan,
    };
  }

  /**
   * Plans one redraw outcome from authoritative invalidation markers and map
   * patch deltas, then consumes the cycle markers.
   * Mirrors `DoUpdateMap` invalidation gating in `ref/micropolis/src/sim/w_map.c`
   * and `sim_update_maps` clear behavior in `ref/micropolis/src/sim/sim.c`.
   */
  private planAndConsumeMapRedraw(mapPatch: Patch | null): HostMapRedrawPlanPayload {
    const redrawPlan = planMapRedraw({
      activeMapState: ACTIVE_MAP_STATE,
      newMap: this.authorityState.simState.NewMap,
      newMapFlags: this.authorityState.simState.NewMapFlags,
      mapPatch,
    });
    consumeMapRedrawPlan(this.authorityState.simState, redrawPlan);
    return toHostMapRedrawPlanPayload(redrawPlan);
  }

  /**
   * Applies one tool command using sim-core tool semantics.
   * Mirrors `DoTool` dispatch and return-code behavior in
   * `ref/micropolis/src/sim/w_tool.c` by routing through sim-core
   * `applyToolAction` and translating outcome classes into host reject reasons.
   * Parity note: map-layer patch extraction from `MapStore.commitTick()` drives
   * bridge map delta payload projection without demo-host tile stamping.
   */
  private applyToolCommand(command: PlayableToolCommand): ToolCommandOutcome {
    if (!isPlacementCoordinate(command.x, command.y)) {
      return {
        rejectReason: 'out-of-bounds',
        mapPatch: null,
      };
    }

    this.syncToolContextFromState();
    let rejectReason: string | undefined;
    let mapPatch: Patch | null = null;
    this.authorityState.toolContext.store.beginTick();
    try {
      const toolResult = applyToolAction(this.authorityState.toolContext, {
        tool: command.tool,
        x: command.x,
        y: command.y,
        simStep: this.authorityState.simState.Scycle,
        order: 0,
        tickId: this.tick,
        seq: this.serverSeq,
      });
      rejectReason = rejectReasonFromToolResult(toolResult.result);
    } finally {
      this.syncStateFundsFromToolContext();
      const tickResult = this.authorityState.toolContext.store.commitTick();
      mapPatch = readMapPatchFromTickResult(tickResult.patches);
    }

    return {
      rejectReason,
      mapPatch,
    };
  }

  /**
   * Synchronizes tool-evaluation funds from canonical authoritative sim state.
   * Mirrors funds ownership in `Spend`/`SetFunds` call flow from
   * `ref/micropolis/src/sim/w_stubs.c`, where `TotalFunds` is authoritative.
   */
  private syncToolContextFromState(): void {
    this.authorityState.toolContext.funds = this.authorityState.simState.TotalFunds;
    this.authorityState.toolContext.autoBulldoze = this.authorityState.simState.autoBulldoze;
    this.authorityState.toolContext.doAnimation = this.authorityState.simState.doAnimation;
  }

  /**
   * Synchronizes canonical authoritative sim funds from tool evaluation results.
   * Mirrors `Spend` -> `SetFunds` behavior in `ref/micropolis/src/sim/w_stubs.c`,
   * including dirtying funds-head updates through `setFunds`.
   */
  private syncStateFundsFromToolContext(): void {
    setFunds(this.authorityState.simState, this.authorityState.toolContext.funds);
  }

  /**
   * Applies pause/play/set-speed commands through authoritative sim-core state.
   * Mirrors `Pause`, `Resume`, and `setSpeed(short)` in
   * `ref/micropolis/src/sim/w_util.c` and command ingress in
   * `ref/micropolis/src/sim/w_sim.c` (`SimCmdPause`, `SimCmdResume`, `SimCmdSpeed`).
   * Parity note: this stage ports state transitions only; HUD speed payload
   * projection is added in later payload-port tasks.
   */
  private applySimControlCommand(command: PlayableSimControlCommand): void {
    if (command.control === 'pause') {
      this.pauseSimulation();
      return;
    }

    if (command.control === 'play') {
      this.resumeSimulation();
      return;
    }

    this.setSimulationSpeed(command.speed);
  }

  /**
   * Applies one manual disaster event into authoritative sim/realtime state.
   * Mirrors disaster handlers in `ref/micropolis/src/sim/s_disast.c`
   * (`MakeFire`, `MakeFlood`, `MakeMeltdown`, `MakeEarthquake`) and realtime
   * disaster handlers in `ref/micropolis/src/sim/w_sprite.c`
   * (`MakeTornado`, `MakeMonster`).
   */
  private applyManualRealtimeEvent(eventId: ManualRealtimeEventId): void {
    switch (eventId) {
      case 'tornado':
        makeRealtimeTornado(this.realtimeContext);
        return;
      case 'monster':
        makeRealtimeMonster(this.realtimeContext);
        return;
      case 'fire':
        makeFire(this.authorityState.simState, this.authorityState.simContext);
        return;
      case 'flood':
        makeFlood(this.authorityState.simState, this.authorityState.simContext);
        return;
      case 'meltdown':
        makeMeltdown(this.authorityState.simState, this.authorityState.simContext);
        return;
      case 'earthquake':
        makeEarthquake(this.authorityState.simState, this.authorityState.simContext);
        return;
    }
  }

  /**
   * Pause semantics for envelope-host sim controls.
   * Mirrors `Pause()` in `ref/micropolis/src/sim/w_util.c`.
   */
  private pauseSimulation(): void {
    if (this.simPaused) {
      return;
    }

    this.simPausedSpeed = normalizePlayableSpeed(this.authorityState.simState.SimMetaSpeed);
    this.setSimulationSpeed(0);
    this.simPaused = true;
  }

  /**
   * Resume semantics for envelope-host sim controls.
   * Mirrors `Resume()` in `ref/micropolis/src/sim/w_util.c`.
   */
  private resumeSimulation(): void {
    if (!this.simPaused) {
      return;
    }

    this.simPaused = false;
    this.setSimulationSpeed(this.simPausedSpeed);
  }

  /**
   * Speed semantics for envelope-host sim controls.
   * Mirrors `setSpeed(short)` in `ref/micropolis/src/sim/w_util.c`.
   * Parity note: values are explicitly truncated/clamped to `0..3` to preserve
   * C integer and clamp behavior.
   */
  private setSimulationSpeed(candidate: number): void {
    const previousVisibleSpeed = this.authorityState.simState.SimSpeed;
    let speed = normalizePlayableSpeed(candidate);
    this.authorityState.simState.SimMetaSpeed = speed;

    if (this.simPaused) {
      this.simPausedSpeed = this.authorityState.simState.SimMetaSpeed;
      speed = 0;
    }

    this.authorityState.simState.SimSpeed = speed;
    const nextVisibleSpeed = this.authorityState.simState.SimSpeed;
    if (nextVisibleSpeed !== previousVisibleSpeed) {
      this.pendingHudUiSetKeys.add('speed');
    }
    this.refreshAmbientInterval();
  }

  /**
   * Starts the authority-owned ambient simulation timer for one ready session.
   * Mirrors `StartMicropolisTimer()` start ownership in `ref/micropolis/src/sim/w_util.c`.
   */
  private startAmbientInterval(sessionId: number): void {
    this.stopAmbientInterval();
    if (!this.enableAmbientTicks || this.patchIntervalMs === undefined) {
      return;
    }

    this.intervalHandle = setInterval(() => {
      this.enqueueAmbientTick(sessionId);
    }, this.patchIntervalMs);
  }

  /**
   * Applies C-style timer gating based on readiness and effective sim speed.
   * Mirrors timer start/stop gating in `setSpeed(short)` from
   * `ref/micropolis/src/sim/w_util.c`.
   */
  private refreshAmbientInterval(): void {
    if (
      !this.enableAmbientTicks ||
      this.patchIntervalMs === undefined ||
      this.onEnvelope === undefined ||
      this.lifecycle.phase !== 'ready' ||
      this.authorityState.simState.SimSpeed === 0
    ) {
      this.stopAmbientInterval();
      return;
    }

    if (this.intervalHandle !== undefined) {
      return;
    }

    this.startAmbientInterval(this.lifecycle.sessionId);
  }

  /**
   * Stops the authority-owned ambient simulation timer.
   * Mirrors `StopMicropolisTimer()` stop ownership in `ref/micropolis/src/sim/w_util.c`.
   */
  private stopAmbientInterval(): void {
    if (this.intervalHandle !== undefined) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  /**
   * Applies the `new-city` lifecycle reset through authoritative sim-core state.
   * Mirrors `GenerateSomeCity` command intent in `ref/micropolis/src/sim/s_gen.c`:
   * regenerate terrain, re-run init lifecycle, and reset city metadata to defaults.
   * Parity note: host-only UI/eval calls in C remain outside this envelope host.
   */
  private applyCityLifecycleCommand(_command: PlayableCityLifecycleCommand): void {
    const terrainSeed = this.authorityState.simContext.rng.next16();
    resetForNewCityFromSeed(this.authorityState.simState, this.authorityState.simContext, {
      seed: terrainSeed,
      treeLevel: NEW_CITY_TREE_LEVEL,
      lakeLevel: NEW_CITY_LAKE_LEVEL,
      curveLevel: NEW_CITY_CURVE_LEVEL,
      createIsland: NEW_CITY_CREATE_ISLAND,
    });

    setFunds(this.authorityState.simState, NEW_CITY_STARTING_FUNDS);
    this.authorityState.simState.SimMetaSpeed = 3;
    this.authorityState.simState.SimSpeed = 3;
    this.cityFileName = DEFAULT_CITY_FILE_NAME;
    this.cityName = DEFAULT_CITY_NAME;
    this.syncHostStateAfterLoadLikeCommand();
  }

  /**
   * Applies `save-city` / `load-city` commands through `sim-io` orchestration helpers.
   * Mirrors `SaveCityAs` and `LoadCity` flows in `ref/micropolis/src/sim/s_fileio.c`.
   */
  private applyCityIoCommand(command: PlayableCityIoCommand):
    | {
        kind: 'save';
        patchPayload: HostPatchPayload;
      }
    | {
        kind: 'load';
      }
    | {
        kind: 'reject';
        reason: string;
      } {
    if (command.action === 'save-city') {
      return this.applySaveCityCommand(command);
    }
    return this.applyLoadCityCommand(command);
  }

  /**
   * Applies `save-city` bytes export through `saveCityAsLikeC`.
   * Mirrors `SaveCityAs` serialization ownership in `ref/micropolis/src/sim/s_fileio.c`.
   */
  private applySaveCityCommand(command: PlayableSaveCityCommand): {
    kind: 'save';
    patchPayload: HostPatchPayload;
  } {
    const fileName = sanitizeCityFileName(command.fileName);
    const saveResult = saveCityAsLikeC(
      this.authorityState.simState,
      this.authorityState.simContext,
      fileName,
    );
    this.cityFileName = saveResult.cityFileName;
    this.cityName = saveResult.cityName;

    return {
      kind: 'save',
      patchPayload: {
        cityIo: {
          save: {
            fileName: this.cityFileName,
            cityName: this.cityName,
            cityBytes: saveResult.cityBytes,
          },
        },
      },
    };
  }

  /**
   * Applies `load-city` state import through `loadCityLikeC`.
   * Mirrors `LoadCity` decode + lifecycle init in `ref/micropolis/src/sim/s_fileio.c`.
   */
  private applyLoadCityCommand(command: PlayableLoadCityCommand):
    | {
        kind: 'load';
      }
    | {
        kind: 'reject';
        reason: string;
      } {
    const fileName = sanitizeCityFileName(command.fileName);

    let loadResult: ReturnType<typeof loadCityLikeC>;
    try {
      loadResult = loadCityLikeC(
        this.authorityState.simState,
        this.authorityState.simContext,
        fileName,
        command.cityBytes,
      );
    } catch {
      return {
        kind: 'reject',
        reason: 'invalid-city-file',
      };
    }

    this.cityFileName = loadResult.cityFileName;
    this.cityName = loadResult.cityName;
    this.syncHostStateAfterLoadLikeCommand();
    return {
      kind: 'load',
    };
  }

  /**
   * Applies scenario start using async scenario byte loading plus `loadScenarioLikeC`.
   * Mirrors `LoadScenario` resource read + decode + lifecycle sequence in
   * `ref/micropolis/src/sim/s_fileio.c`.
   */
  private async applyScenarioCommandAsync(
    sessionId: number,
    roomId: string,
    clientId: string,
    commandId: string,
    command: PlayableScenarioCommand,
    commandTick: number,
  ): Promise<void> {
    let scenario: ReturnType<typeof getScenarioDefinition>;
    try {
      scenario = getScenarioDefinition(command.scenarioId);
    } catch {
      if (!this.isReadySessionEnvelope(sessionId, roomId, clientId)) {
        return;
      }
      this.emitReject(roomId, clientId, commandId, 'invalid-scenario-file', commandTick);
      return;
    }

    let scenarioBytes: Uint8Array;
    try {
      scenarioBytes = await this.scenarioResourceLoader(scenario.fileName);
    } catch {
      if (!this.isReadySessionEnvelope(sessionId, roomId, clientId)) {
        return;
      }
      this.emitReject(roomId, clientId, commandId, 'invalid-scenario-file', commandTick);
      return;
    }

    let loadResult: ReturnType<typeof loadScenarioLikeC>;
    if (!this.isReadySessionEnvelope(sessionId, roomId, clientId)) {
      return;
    }
    try {
      loadResult = loadScenarioLikeC(
        this.authorityState.simState,
        this.authorityState.simContext,
        scenario.id,
        scenarioBytes,
      );
    } catch {
      if (!this.isReadySessionEnvelope(sessionId, roomId, clientId)) {
        return;
      }
      this.emitReject(roomId, clientId, commandId, 'invalid-scenario-file', commandTick);
      return;
    }

    this.cityFileName = `${loadResult.scenario.fileName}.cty`;
    this.cityName = loadResult.scenario.name;
    this.syncHostStateAfterLoadLikeCommand();

    if (!this.isReadySessionEnvelope(sessionId, roomId, clientId)) {
      return;
    }

    this.emitScenarioSuccessSettlement(roomId, clientId, commandId, commandTick);
  }

  /**
   * Settles one successful scenario load with ordered `ack` + `snapshot` emission.
   * Mirrors `LoadScenario` completion ownership in `ref/micropolis/src/sim/s_fileio.c`,
   * with update propagation intent from `ref/micropolis/src/sim/w_update.c`.
   * Parity note: Bridge settlement emits `ack` first, then a fresh authoritative
   * snapshot on the same command tick.
   */
  private emitScenarioSuccessSettlement(
    roomId: string,
    clientId: string,
    commandId: string,
    commandTick: number,
  ): void {
    this.emitAck(roomId, clientId, commandId, commandTick);
    this.emitSnapshot(roomId, clientId, commandTick);
  }

  /**
   * Synchronizes host pause/tool mirrors after load/new-city lifecycle commands.
   * Mirrors host-side pause/timer bookkeeping around load/new-city flows in
   * `ref/micropolis/src/sim/s_fileio.c` and `ref/micropolis/src/sim/s_gen.c`.
   */
  private syncHostStateAfterLoadLikeCommand(): void {
    this.simPaused = false;
    this.simPausedSpeed = normalizePlayableSpeed(this.authorityState.simState.SimMetaSpeed);
    this.syncToolContextFromState();
    this.refreshAmbientInterval();
  }

  /**
   * Resolve and cache one scenario resource payload from canonical `snro.*` files.
   * Mirrors `_load_file(fname, ResourceDir)` identity in
   * `ref/micropolis/src/sim/s_fileio.c`.
   */
  private loadScenarioResourceBytes(fileName: string): Promise<Uint8Array> {
    const cached = this.scenarioResourceBytesCache.get(fileName);
    if (cached !== undefined) {
      return cached;
    }

    const resourceUrl = getScenarioResourceUrl(fileName);
    const pendingLoad = readBinaryResourceFromUrl(resourceUrl).catch(() => {
      this.scenarioResourceBytesCache.delete(fileName);
      throw new Error(`failed to load scenario resource ${fileName}`);
    });
    this.scenarioResourceBytesCache.set(fileName, pendingLoad);
    return pendingLoad;
  }

  private isSessionActive(sessionId: number): boolean {
    if (this.onEnvelope === undefined || this.lifecycle.phase === 'disconnected') {
      return false;
    }

    return this.lifecycle.sessionId === sessionId;
  }

  private isReadySessionEnvelope(sessionId: number, roomId: string, clientId: string): boolean {
    if (!this.isSessionActive(sessionId) || this.lifecycle.phase !== 'ready') {
      return false;
    }

    return this.lifecycle.roomId === roomId && this.lifecycle.clientId === clientId;
  }

  /**
   * Emits one authoritative snapshot from sim-core map state.
   * Mirrors full update refresh behavior in `ref/micropolis/src/sim/w_update.c`.
   */
  private emitSnapshot(
    roomId: string,
    clientId: string,
    tickOverride = this.tick,
    options?: EmitSequencedEnvelopeOptions,
  ): void {
    this.refreshHookDrivenHud();
    this.syncRealtimeContextFromSimState();
    this.pendingHudUiSetKeys.clear();
    this.consumeMapInvalidationCycleAfterSnapshot();
    const snapshotPayload = this.buildSnapshotPayload();
    this.resetRealtimeDeltaBaseline();
    this.applyPendingHookMessagesToSnapshotPayload(snapshotPayload);
    this.emitSnapshotFromPayload(roomId, clientId, snapshotPayload, tickOverride, options);
  }

  /**
   * Clears map invalidation cycle markers after emitting one authoritative
   * full-map snapshot baseline.
   * Mirrors map-cycle invalidation clear ownership in
   * `ref/micropolis/src/sim/sim.c` (`sim_update_maps`).
   * Parity note: replay snapshots are excluded and do not consume live
   * invalidation markers.
   */
  private consumeMapInvalidationCycleAfterSnapshot(): void {
    consumeMapRedrawPlan(this.authorityState.simState);
  }

  /**
   * Emits one deterministic replay stream as snapshot baseline plus ordered tail.
   * Mirrors reconnect/resync replay intent from
   * `ref/micropolis/spec/integration/SPEC.md`.
   * Parity note: replay cursor is clamped to known sequenced history before
   * building baseline + tail for reducer-compatible recovery ordering.
   */
  private emitSnapshotReplay(roomId: string, clientId: string, replayCursor: number): void {
    const baseline = this.readSnapshotReplayBaseline(replayCursor);
    const replayTail = this.readSnapshotReplayTail(replayCursor);
    this.emitSnapshotFromPayload(roomId, clientId, baseline.payload, baseline.tick, {
      replayTailEligible: false,
      recordMessages: false,
      includeQueuedSoundDeltas: false,
    });
    for (const envelope of replayTail) {
      this.emitSequencedEnvelope(this.retargetSequencedEnvelope(envelope, roomId, clientId), {
        replayTailEligible: false,
        recordMessages: false,
        includeQueuedSoundDeltas: false,
      });
    }
  }

  /**
   * Emits one snapshot envelope from an explicit payload/tick baseline.
   * Mirrors full-state checkpoint emission intent from
   * `ref/micropolis/spec/integration/SPEC.md`.
   */
  private emitSnapshotFromPayload(
    roomId: string,
    clientId: string,
    payload: HostSnapshotPayload,
    tickOverride: number,
    options?: EmitSequencedEnvelopeOptions,
  ): void {
    this.emitSequencedEnvelope(
      {
        kind: 'snapshot',
        roomId,
        clientId,
        tick: tickOverride,
        payload,
      },
      options,
    );
  }

  /**
   * Emits one sequenced host envelope with a strictly increasing server sequence.
   * Mirrors ordered host update sequencing intent from `w_sim.c`/`w_update.c`
   * while adapting to typed bridge envelopes.
   */
  private emitSequencedEnvelope(
    envelope: SequencedHostEnvelopeWithoutServerSeq,
    options: EmitSequencedEnvelopeOptions = {},
  ): void {
    if (this.onEnvelope === undefined) {
      return;
    }

    const sequencedEnvelope = this.applyQueuedSoundDeltasToEnvelope(
      this.applyReplayMetadataToEnvelopeMessages(
        {
          ...envelope,
          tick: this.nextEnvelopeTick(envelope.tick),
          serverSeq: this.nextServerSeq(),
        },
        options,
      ),
      options,
    );
    this.onEnvelope(sequencedEnvelope);
    this.recordReplayEnvelope(sequencedEnvelope, options);
  }

  /**
   * Applies queued host sound deltas to one sequenced envelope when enabled.
   * Mirrors tick-bounded sound dispatch ownership from `MakeSound`/`MakeSoundOn`
   * in `ref/micropolis/src/sim/w_sound.c`, adapted to bridge envelope transport.
   */
  private applyQueuedSoundDeltasToEnvelope(
    envelope: SequencedHostEnvelope,
    options: EmitSequencedEnvelopeOptions,
  ): SequencedHostEnvelope {
    const explicitSoundDeltas = envelope.soundDeltas ?? [];
    const queuedSoundDeltas =
      options.includeQueuedSoundDeltas === false
        ? []
        : this.drainPendingSoundDeltasForTick(envelope.tick);
    if (explicitSoundDeltas.length === 0 && queuedSoundDeltas.length === 0) {
      return envelope;
    }

    return {
      ...envelope,
      soundDeltas: cloneHostSoundDeltaPayloadList([...explicitSoundDeltas, ...queuedSoundDeltas]),
    };
  }

  /**
   * Stamps message payload entries with deterministic replay metadata.
   * Mirrors ordered message delivery ownership in `doMessage` from
   * `ref/micropolis/src/sim/s_msg.c` and bridge replay ordering invariants from
   * `ref/micropolis/spec/integration/SPEC.md`.
   * Parity note: C message payloads do not include tick/sequence fields; this host
   * writes transport metadata so snapshot replay preserves original message order.
   */
  private applyReplayMetadataToEnvelopeMessages(
    envelope: SequencedHostEnvelope,
    options: EmitSequencedEnvelopeOptions,
  ): SequencedHostEnvelope {
    if (options.recordMessages === false) {
      return envelope;
    }

    if (envelope.kind === 'patch') {
      const normalized = normalizeMessageReplayMetadata(
        envelope.payload.messageDeltas ?? envelope.payload.messages,
        envelope.tick,
        envelope.serverSeq,
      );
      if (normalized.length === 0) {
        return envelope;
      }

      this.appendMessageLog(normalized);
      const canonicalMessageDeltas = cloneHostHudMessagePayloadList(normalized);
      return {
        ...envelope,
        payload: {
          ...envelope.payload,
          hud: withLegacyHudMessageCompatibility(envelope.payload.hud, canonicalMessageDeltas),
          messageDeltas: canonicalMessageDeltas,
          messages: cloneHostHudMessagePayloadList(canonicalMessageDeltas),
        },
      };
    }

    if (envelope.kind !== 'snapshot') {
      return envelope;
    }

    const normalized = normalizeMessageReplayMetadata(
      envelope.payload.messages ?? envelope.payload.messageDeltas,
      envelope.tick,
      envelope.serverSeq,
    );
    if (normalized.length === 0) {
      this.replaceMessageLog([]);
      return envelope;
    }

    this.replaceMessageLog(normalized);
    const canonicalSnapshotMessages = cloneHostHudMessagePayloadList(normalized);
    return {
      ...envelope,
      payload: {
        ...envelope.payload,
        hud: withLegacyHudMessageCompatibility(envelope.payload.hud, canonicalSnapshotMessages),
        messages: canonicalSnapshotMessages,
        messageDeltas: cloneHostHudMessagePayloadList(canonicalSnapshotMessages),
      },
    };
  }

  /**
   * Reads one replay-baseline snapshot checkpoint for a clamped cursor.
   * Mirrors checkpoint-based recovery baseline intent from
   * `ref/micropolis/spec/integration/SPEC.md`.
   */
  private readSnapshotReplayBaseline(replayCursor: number): SnapshotReplayCheckpoint {
    const checkpoint = this.snapshotReplayCheckpoints.get(replayCursor);
    if (checkpoint !== undefined) {
      return {
        tick: checkpoint.tick,
        payload: cloneHostSnapshotPayload(checkpoint.payload),
      };
    }

    return {
      tick: this.tick,
      payload: this.buildSnapshotPayload(),
    };
  }

  /**
   * Reads one ordered sequenced tail replay after a clamped replay cursor.
   * Mirrors bridge replay-tail ordering intent from
   * `ref/micropolis/spec/integration/SPEC.md`.
   * Parity note: snapshot envelopes are excluded from tail replay because this
   * host emits exactly one deterministic replay baseline snapshot first.
   */
  private readSnapshotReplayTail(replayCursor: number): SequencedHostEnvelope[] {
    return this.sequencedReplayLog
      .filter((entry) => entry.replayTailEligible && entry.envelope.serverSeq > replayCursor)
      .sort((left, right) => left.envelope.serverSeq - right.envelope.serverSeq)
      .map((entry) => cloneReplaySequencedEnvelope(entry.envelope));
  }

  /**
   * Retargets a replayed sequenced envelope to the active room/client identity.
   * Mirrors room/client envelope identity ownership in `ref/micropolis/src/sim/w_sim.c`.
   */
  private retargetSequencedEnvelope(
    envelope: SequencedHostEnvelope,
    roomId: string,
    clientId: string,
  ): SequencedHostEnvelopeWithoutServerSeq {
    const { serverSeq: _serverSeq, ...withoutServerSeq } = envelope;
    return {
      ...withoutServerSeq,
      roomId,
      clientId,
    };
  }

  /**
   * Appends one emitted sequenced envelope into replay history checkpoints.
   * Mirrors deterministic replay checkpoint intent from
   * `ref/micropolis/spec/integration/SPEC.md`.
   */
  private recordReplayEnvelope(
    envelope: SequencedHostEnvelope,
    options: EmitSequencedEnvelopeOptions,
  ): void {
    this.sequencedReplayLog.push({
      envelope: cloneReplaySequencedEnvelope(envelope),
      replayTailEligible: options.replayTailEligible ?? true,
    });
    this.snapshotReplayCheckpoints.set(envelope.serverSeq, {
      tick: envelope.tick,
      payload: cloneHostSnapshotPayload(this.buildSnapshotPayload()),
    });
  }

  /**
   * Advances the authoritative envelope sequence counter by exactly one.
   * Mirrors monotonic update ordering expected by Playable Runtime reducers,
   * aligned with host-side update sequencing flow in `ref/micropolis/src/sim/w_update.c`.
   * Parity note: unlike C's single in-process update loop assumptions, this host
   * defends against accidental cursor regression by deriving the next sequence from
   * both persisted cursors, then incrementing once.
   */
  private nextServerSeq(): number {
    const sequenceBase = Math.max(this.serverSeq, this.lastEmittedServerSeq);
    const nextSequence = sequenceBase + 1;
    this.serverSeq = nextSequence;
    this.lastEmittedServerSeq = nextSequence;
    return nextSequence;
  }

  /**
   * Advances the authoritative command tick by exactly one without regression.
   * Mirrors forward-only simulation time progression in
   * `ref/micropolis/src/sim/s_sim.c` (`CityTime`) and frame-loop ownership in
   * `ref/micropolis/src/sim/sim.c`.
   * Parity note: unlike C's synchronous single-process command loop, this host
   * defends against accidental cursor rollback by deriving the next command tick
   * from both local tick cursors, then incrementing once.
   */
  private advanceCommandTick(): number {
    const tickBase = Math.max(this.tick, this.lastEmittedTick);
    const nextTick = tickBase + 1;
    this.tick = nextTick;
    return nextTick;
  }

  /**
   * Clamps one emitted envelope tick to the non-regressing authority cursor.
   * Mirrors monotonic simulation time assumptions in
   * `ref/micropolis/src/sim/s_sim.c` (`CityTime` never decrements).
   * Parity note: async command settlement can complete after newer commands;
   * this host normalizes captured older command ticks so bridge envelopes never
   * regress tick order.
   */
  private nextEnvelopeTick(candidateTick: number): number {
    const normalizedCandidate = Number.isFinite(candidateTick)
      ? Math.trunc(candidateTick)
      : this.lastEmittedTick;
    const nextTick = Math.max(normalizedCandidate, this.lastEmittedTick);
    this.lastEmittedTick = nextTick;
    if (nextTick > this.tick) {
      this.tick = nextTick;
    }
    return nextTick;
  }

  /**
   * Builds the host snapshot payload from the authoritative sim-core map layer.
   * Mirrors contiguous `Map[x][y]` ownership in
   * `ref/micropolis/src/sim/s_alloc.c` and map snapshot serialization shape from
   * `ref/micropolis/src/sim/s_fileio.c`.
   * Parity note: snapshot tile words are copied directly from
   * `SimCoreRuntimeState` `map` storage (`x * WORLD_Y + y` ordering), preserving
   * Micropolis contiguous map semantics at the envelope boundary.
   */
  private buildSnapshotPayload(): HostSnapshotPayload {
    const mapLayer = this.authorityState.store.snapshot('map');
    if (!(mapLayer instanceof Uint16Array)) {
      throw new Error(`expected Uint16Array map layer; got ${mapLayer.constructor.name}`);
    }

    const tileWords = buildSnapshotTileWordsFromSimCoreMap(mapLayer, this.mapWidth, this.mapHeight);
    const hud = this.buildHudSnapshotPayload();
    if (this.messageLog.length === 0) {
      return {
        map: {
          width: this.mapWidth,
          height: this.mapHeight,
          tileWords,
        },
        hud,
        realtime: this.buildRealtimeSnapshotPayload(),
      };
    }

    const snapshotMessages = cloneHostHudMessagePayloadList(this.messageLog);
    return {
      map: {
        width: this.mapWidth,
        height: this.mapHeight,
        tileWords,
      },
      hud: withLegacyHudMessageCompatibility(hud, snapshotMessages),
      realtime: this.buildRealtimeSnapshotPayload(),
      messages: snapshotMessages,
      messageDeltas: cloneHostHudMessagePayloadList(snapshotMessages),
    };
  }

  /**
   * Installs realtime sprite hooks onto authoritative sim-core callbacks.
   * Mirrors `sim->hooks` wiring in `ref/micropolis/src/sim/sim.c`, routing
   * sprite lifecycle callbacks into `ref/micropolis/src/sim/w_sprite.c` parity
   * helpers in `packages/sim-core/src/sim/realtime.ts`.
   * Parity note: this host intentionally does not force-seed copters; only C
   * trigger paths create sprites.
   */
  private installRealtimeHooks(): void {
    this.authorityState.simContext.hooks.destroyAllSprites = () => {
      destroyRealtimeSprites(this.realtimeContext);
    };
    this.authorityState.simContext.hooks.generateTrain = (x, y) => {
      generateRealtimeTrain(this.realtimeContext, x, y);
    };
    this.authorityState.simContext.hooks.generateShip = () => {
      generateRealtimeShip(this.realtimeContext);
    };
    // Hook parity note: current sim-core `generatePlane`/`generateCopter` hooks do
    // not carry tile coordinates (unlike C `GeneratePlane(x,y)`/`GenerateCopter(x,y)`),
    // so this host uses world-center launch coordinates.
    this.authorityState.simContext.hooks.generatePlane = () => {
      generateRealtimePlane(this.realtimeContext, this.mapWidth >> 1, this.mapHeight >> 1);
    };
    this.authorityState.simContext.hooks.generateCopter = () => {
      generateRealtimeCopter(this.realtimeContext, this.mapWidth >> 1, this.mapHeight >> 1);
    };
    this.authorityState.simContext.hooks.getSprite = (type) => {
      if (type < 1 || type > 8) {
        return null;
      }
      return getRealtimeSprite(this.realtimeContext, type as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8);
    };
    this.authorityState.simContext.hooks.moveObjects = () => {
      this.advanceRealtimeStep();
    };
    this.authorityState.simContext.hooks.makeExplosion = (x, y) => {
      makeRealtimeExplosion(this.realtimeContext, x, y);
    };
    this.authorityState.simContext.hooks.makeExplosionAt = (x, y) => {
      makeRealtimeExplosionAt(this.realtimeContext, x, y);
    };
    this.authorityState.simContext.hooks.makeMonster = () => {
      makeRealtimeMonster(this.realtimeContext);
    };
    this.authorityState.simContext.hooks.makeTornado = () => {
      makeRealtimeTornado(this.realtimeContext);
    };
  }

  /**
   * Syncs mutable realtime scalar inputs from authoritative sim state.
   * Mirrors sprite/disaster scalar ownership in `ref/micropolis/src/sim/w_sprite.c`
   * and animation/speed gating in `ref/micropolis/src/sim/w_editor.c`.
   */
  private syncRealtimeContextFromSimState(): void {
    this.realtimeContext.simSpeed = this.authorityState.simState.SimSpeed;
    this.realtimeContext.doAnimation = this.authorityState.simState.doAnimation;
    this.realtimeContext.noDisasters = this.authorityState.simState.NoDisasters;
    this.realtimeContext.scenarioId = this.authorityState.simState.ScenarioID;
    this.realtimeContext.totalPop = this.authorityState.simState.TotalPop;
    this.realtimeContext.polMaxX = this.authorityState.simState.PolMaxX;
    this.realtimeContext.polMaxY = this.authorityState.simState.PolMaxY;
  }

  /**
   * Runs one realtime movement/animation pass through sim-core.
   * Mirrors `MoveObjects` + animated-tile progression from
   * `ref/micropolis/src/sim/w_sprite.c` and `ref/micropolis/src/sim/g_ani.c`.
   */
  private advanceRealtimeStep(): void {
    this.syncRealtimeContextFromSimState();
    runRealtimeTick(this.realtimeContext);
  }

  /**
   * Builds one realtime snapshot payload from active sprite state.
   * Mirrors full sprite list projection in `DrawObjects` from
   * `ref/micropolis/src/sim/w_sprite.c`.
   * Parity note: bridge `id` keys are deterministic transport metadata.
   */
  private buildRealtimeSnapshotPayload(): NonNullable<HostSnapshotPayload['realtime']> {
    const objects = this.collectRealtimeObjectsWithIds();
    return {
      snapshot: objects,
      objects,
    };
  }

  /**
   * Builds one realtime delta payload from active sprite changes.
   * Mirrors per-tick sprite create/move/destroy progression in
   * `ref/micropolis/src/sim/w_sprite.c`.
   * Parity note: `deltas` are bridge transport metadata; `objects` stays as the
   * compatibility full-object stream.
   */
  private buildRealtimeDeltaPayload(): HostPatchPayload['realtime'] | undefined {
    const objects = this.collectRealtimeObjectsWithIds();
    const hadPriorObjects = this.lastRealtimeObjectsById.size > 0;
    const nextRealtimeObjectsById = indexRealtimeObjectsById(objects);
    const deltas: HostRealtimeObjectDeltaPayload[] = [];

    for (const object of objects) {
      const previous = this.lastRealtimeObjectsById.get(object.id);
      if (previous === undefined || !areRealtimeObjectsEqual(previous, object)) {
        deltas.push({
          kind: 'upsert',
          object,
        });
      }
    }

    for (const [id] of this.lastRealtimeObjectsById) {
      if (!nextRealtimeObjectsById.has(id)) {
        deltas.push({
          kind: 'remove',
          id,
        });
      }
    }

    this.lastRealtimeObjectsById = nextRealtimeObjectsById;
    if (objects.length === 0 && !hadPriorObjects && deltas.length === 0) {
      return undefined;
    }

    return {
      objects,
      deltas,
    };
  }

  /**
   * Collects active realtime sprites as payload objects.
   * Mirrors active sprite filtering (`frame != 0`) in
   * `ref/micropolis/src/sim/w_sprite.c` `DrawObjects`.
   */
  private collectRealtimeObjectsWithIds(): HostRealtimeObjectWithIdPayload[] {
    return this.realtimeContext.sprites
      .filter((sprite) => sprite.frame > 0)
      .map((sprite) => ({
        id: this.readRealtimeObjectId(sprite),
        name: sprite.name,
        type: sprite.type,
        x: sprite.x,
        y: sprite.y,
        frame: sprite.frame,
      }));
  }

  /**
   * Reads or assigns one deterministic realtime object id for transport payloads.
   * Mirrors stable in-process sprite identity intent in
   * `ref/micropolis/src/sim/w_sprite.c`.
   * Parity note: C identity uses pointers/slots; bridge payloads require explicit ids.
   */
  private readRealtimeObjectId(sprite: SimSprite): string {
    const existingId = this.realtimeObjectIds.get(sprite);
    if (existingId !== undefined) {
      return existingId;
    }

    const nextId = `rt-${this.nextRealtimeObjectId}`;
    this.nextRealtimeObjectId += 1;
    this.realtimeObjectIds.set(sprite, nextId);
    return nextId;
  }

  /**
   * Resets realtime delta baseline to the current active sprite snapshot.
   * Mirrors full-refresh baseline replacement semantics in `DrawObjects` from
   * `ref/micropolis/src/sim/w_sprite.c`, adapted for bridge delta transport.
   */
  private resetRealtimeDeltaBaseline(): void {
    this.lastRealtimeObjectsById = indexRealtimeObjectsById(this.collectRealtimeObjectsWithIds());
  }

  /**
   * Runs one `DoUpdateHeads` pass through sim-core hooks before host payload emission.
   * Mirrors heads refresh ownership in `ref/micropolis/src/sim/w_update.c`.
   */
  private refreshHookDrivenHud(): void {
    this.authorityState.store.beginTick();
    try {
      runUiUpdate(this.authorityState.simState, this.authorityState.simContext);
    } finally {
      this.authorityState.store.commitTick();
    }
  }

  /**
   * Captures one authoritative `UISet*` hook update from sim-core.
   * Mirrors head dispatch in `ref/micropolis/src/sim/w_update.c`.
   */
  private captureUiSet(key: string, value: number | boolean | string): void {
    switch (key) {
      case 'funds':
        if (typeof value === 'string') {
          this.hookHudState.fundsLabel = value;
          this.pendingHudUiSetKeys.add('funds');
        }
        return;
      case 'date':
        if (typeof value === 'string') {
          this.hookHudState.dateLabel = value;
          this.pendingHudUiSetKeys.add('date');
        }
        return;
      case 'dateMonth':
        if (typeof value === 'number') {
          this.hookHudState.dateMonth = Math.trunc(value);
          this.pendingHudUiSetKeys.add('dateMonth');
        }
        return;
      case 'dateYear':
        if (typeof value === 'number') {
          this.hookHudState.dateYear = Math.trunc(value);
          this.pendingHudUiSetKeys.add('dateYear');
        }
        return;
      case 'demandR':
        if (typeof value === 'number') {
          this.hookHudState.demandR = Math.trunc(value);
          this.pendingHudUiSetKeys.add('demandR');
        }
        return;
      case 'demandC':
        if (typeof value === 'number') {
          this.hookHudState.demandC = Math.trunc(value);
          this.pendingHudUiSetKeys.add('demandC');
        }
        return;
      case 'demandI':
        if (typeof value === 'number') {
          this.hookHudState.demandI = Math.trunc(value);
          this.pendingHudUiSetKeys.add('demandI');
        }
        return;
      case 'optionAutoBudget':
        if (typeof value === 'boolean') {
          this.hookHudState.options.autoBudget = value;
          this.pendingHudUiSetKeys.add('optionAutoBudget');
        }
        return;
      case 'optionAutoGo':
        if (typeof value === 'boolean') {
          this.hookHudState.options.autoGo = value;
          this.pendingHudUiSetKeys.add('optionAutoGo');
        }
        return;
      case 'optionAutoBulldoze':
        if (typeof value === 'boolean') {
          this.hookHudState.options.autoBulldoze = value;
          this.pendingHudUiSetKeys.add('optionAutoBulldoze');
        }
        return;
      case 'optionDisasters':
        if (typeof value === 'boolean') {
          this.hookHudState.options.disasters = value;
          this.pendingHudUiSetKeys.add('optionDisasters');
        }
        return;
      case 'optionUserSoundOn':
        if (typeof value === 'boolean') {
          this.hookHudState.options.userSoundOn = value;
          this.pendingHudUiSetKeys.add('optionUserSoundOn');
        }
        return;
      case 'optionDoAnimation':
        if (typeof value === 'boolean') {
          this.hookHudState.options.doAnimation = value;
          this.pendingHudUiSetKeys.add('optionDoAnimation');
        }
        return;
      case 'optionDoMessages':
        if (typeof value === 'boolean') {
          this.hookHudState.options.doMessages = value;
          this.pendingHudUiSetKeys.add('optionDoMessages');
        }
        return;
      case 'optionDoNotices':
        if (typeof value === 'boolean') {
          this.hookHudState.options.doNotices = value;
          this.pendingHudUiSetKeys.add('optionDoNotices');
        }
        return;
    }
  }

  /**
   * Captures one authoritative `SendMes` hook delivery from sim-core.
   * Mirrors `SendMes` dispatch ownership in `ref/micropolis/src/sim/s_msg.c`.
   */
  private captureMessage(id: number): void {
    this.pendingHookMessages.push({
      id,
      text: messageTextForId(id),
    });
  }

  /**
   * Captures one authoritative `SendMesAt` hook delivery from sim-core.
   * Mirrors `SendMesAt` dispatch ownership in `ref/micropolis/src/sim/s_msg.c`.
   */
  private captureMessageAt(id: number, x: number, y: number): void {
    this.pendingHookMessages.push({
      id,
      text: messageTextForId(id),
      x: Math.trunc(x),
      y: Math.trunc(y),
    });
  }

  /**
   * Captures one sim-core numeric `makeSound` hook event into the authoritative
   * pending per-tick sound queue.
   * Mirrors `MakeSound("channel", "spec")` routing in
   * `ref/micropolis/src/sim/w_sound.c`, with numeric channel/sound ids currently
   * emitted by sim-core message paths from `ref/micropolis/src/sim/s_msg.c`.
   */
  private captureSimCoreHookSound(channel: number, sound: number): void {
    const soundIntent = resolveDoMessageHookSoundIntent(channel, sound);
    if (soundIntent === null) {
      return;
    }
    this.enqueuePendingSoundDeltaForTick(this.tick, soundIntent);
  }

  /**
   * Captures one realtime callback sound event into the authoritative pending
   * per-tick sound queue.
   * Mirrors realtime `MakeSound("city", "...")` call sites in
   * `ref/micropolis/src/sim/w_sprite.c`, preserving full `soundSpec`.
   */
  private captureRealtimeSound(channel: string, soundSpec: string): void {
    this.enqueuePendingSoundDeltaForTick(this.tick, {
      channel,
      soundSpec,
    });
  }

  /**
   * Builds `DoTool`/`ToolDown` reject sound deltas for host-settled tool failures.
   * Mirrors explicit `MakeSoundOn(view, "edit", "UhUh"/"Sorry")` branches in
   * `ref/micropolis/src/sim/w_tool.c` (`result == -1` / `result == -2`), with
   * scope metadata mapped from `MakeSoundOn` view-target semantics in
   * `ref/micropolis/src/sim/w_sound.c`.
   * Parity note: host-level `invalid-placement` rejects currently map to the
   * same `UhUh` feedback used by C `result == -1` tool failures.
   */
  private buildToolRejectSoundDeltas(rejectReason: string): HostSoundDeltaPayload[] {
    if (!this.isHostSoundEmissionEnabled()) {
      return [];
    }
    const soundSpec =
      rejectReason === 'out-of-bounds' ||
      rejectReason === 'no-funds' ||
      rejectReason === 'invalid-placement'
        ? TOOL_ERROR_SOUND_SPEC_BY_REJECT_REASON[rejectReason]
        : undefined;
    if (soundSpec === undefined) {
      return [];
    }
    return [
      {
        channel: TOOL_SOUND_CHANNEL,
        soundSpec,
        scope: TOOL_SOUND_SCOPE,
      },
    ];
  }

  /**
   * Builds `DidTool(...)` success sound deltas for acknowledged tool commands.
   * Mirrors `DidTool` callback dispatch in `ref/micropolis/src/sim/w_tool.c`
   * and `UIDidTool*` -> `UIMakeSoundOn` specs in `ref/micropolis/res/micropolis.tcl`,
   * with scope metadata mapped from `MakeSoundOn(view, ...)` semantics in
   * `ref/micropolis/src/sim/w_sound.c`.
   */
  private buildToolSuccessSoundDeltas(tool: PlayableToolCommand['tool']): HostSoundDeltaPayload[] {
    if (!this.isHostSoundEmissionEnabled()) {
      return [];
    }
    const soundIntent = resolveSimUiPlayableToolDidToolSoundIntent(tool);
    if (soundIntent === undefined) {
      return [];
    }
    return [
      {
        channel: soundIntent.channel,
        soundSpec: soundIntent.soundSpec,
        scope: TOOL_SOUND_SCOPE,
      },
    ];
  }

  /**
   * Returns whether host-side sound intent capture is enabled.
   * Mirrors `UserSoundOn` early-return checks in `MakeSound` / `MakeSoundOn`
   * from `ref/micropolis/src/sim/w_sound.c`.
   */
  private isHostSoundEmissionEnabled(): boolean {
    return this.authorityState.simState.userSoundOn;
  }

  /**
   * Queues one pending sound delta for one authoritative tick.
   * Mirrors per-cycle sound dispatch ownership around `MakeSound` /
   * `MakeSoundOn` in `ref/micropolis/src/sim/w_sound.c`, adapted to staged
   * bridge envelope transport.
   */
  private enqueuePendingSoundDeltaForTick(tick: number, soundDelta: HostSoundDeltaPayload): void {
    if (!this.isHostSoundEmissionEnabled()) {
      return;
    }
    const normalizedTick = normalizeSoundQueueTick(tick, this.tick);
    const pendingSoundDeltas = this.pendingSoundDeltasByTick.get(normalizedTick);
    const queuedSoundDelta = cloneHostSoundDeltaPayload(soundDelta);
    if (pendingSoundDeltas === undefined) {
      this.pendingSoundDeltasByTick.set(normalizedTick, [queuedSoundDelta]);
      return;
    }
    pendingSoundDeltas.push(queuedSoundDelta);
  }

  /**
   * Drains queued pending sound deltas for one authoritative tick.
   * Mirrors tick-bounded update cycle ownership in `ref/micropolis/src/sim/w_update.c`,
   * while retaining the `MakeSound` dispatch boundary from
   * `ref/micropolis/src/sim/w_sound.c`.
   */
  private drainPendingSoundDeltasForTick(tick = this.tick): HostSoundDeltaPayload[] {
    const normalizedTick = normalizeSoundQueueTick(tick, this.tick);
    const pendingSoundDeltas = this.pendingSoundDeltasByTick.get(normalizedTick);
    if (pendingSoundDeltas === undefined || pendingSoundDeltas.length === 0) {
      return [];
    }
    this.pendingSoundDeltasByTick.delete(normalizedTick);
    return cloneHostSoundDeltaPayloadList(pendingSoundDeltas);
  }

  /**
   * Drains pending hook-delivered messages for the next host payload.
   * Mirrors one-heads-cycle message dispatch ownership in
   * `ref/micropolis/src/sim/s_msg.c`.
   */
  private drainPendingHookMessages(): HostHudMessagePayload[] {
    if (this.pendingHookMessages.length === 0) {
      return [];
    }

    const pendingMessages = this.pendingHookMessages;
    this.pendingHookMessages = [];
    return pendingMessages;
  }

  /**
   * Adds pending hook-delivered messages into one snapshot payload baseline.
   * Mirrors `doMessage` queue-consume intent from `ref/micropolis/src/sim/s_msg.c`,
   * adapted to bridge snapshot full-feed payload semantics.
   */
  private applyPendingHookMessagesToSnapshotPayload(payload: HostSnapshotPayload): void {
    const pendingMessages = this.drainPendingHookMessages();
    if (pendingMessages.length === 0) {
      return;
    }

    const snapshotMessages = payload.messages ?? payload.messageDeltas ?? [];
    const mergedMessages = [...snapshotMessages, ...pendingMessages];
    const canonicalSnapshotMessages = clampMessageFeed(mergedMessages);
    payload.messages = canonicalSnapshotMessages;
    payload.messageDeltas = cloneHostHudMessagePayloadList(canonicalSnapshotMessages);
    payload.hud = withLegacyHudMessageCompatibility(payload.hud, canonicalSnapshotMessages);
  }

  /**
   * Appends normalized message deltas into the bounded snapshot message feed.
   * Mirrors `SetMessageField` visible-message progression from
   * `ref/micropolis/src/sim/s_msg.c`, adapted to bounded bridge history.
   */
  private appendMessageLog(messages: readonly HostHudMessagePayload[]): void {
    this.messageLog.push(...cloneHostHudMessagePayloadList(messages));
    if (this.messageLog.length > MESSAGE_LOG_LIMIT) {
      this.messageLog.splice(0, this.messageLog.length - MESSAGE_LOG_LIMIT);
    }
  }

  /**
   * Replaces the bounded snapshot message feed from one snapshot baseline.
   * Mirrors snapshot full-feed replacement intent from
   * `ref/micropolis/spec/integration/SPEC.md`.
   */
  private replaceMessageLog(messages: readonly HostHudMessagePayload[]): void {
    this.messageLog.splice(0, this.messageLog.length, ...clampMessageFeed(messages));
  }

  /**
   * Builds one patch-scoped HUD delta from pending `uiSet` updates.
   * Mirrors `DoUpdateHeads` incremental head emission in `ref/micropolis/src/sim/w_update.c`.
   */
  private consumePendingHudPatchPayload(): HostPatchPayload['hud'] | undefined {
    const hasFunds = this.pendingHudUiSetKeys.has('funds');
    const hasDate =
      this.pendingHudUiSetKeys.has('date') ||
      this.pendingHudUiSetKeys.has('dateMonth') ||
      this.pendingHudUiSetKeys.has('dateYear');
    const hasDemand =
      this.pendingHudUiSetKeys.has('demandR') ||
      this.pendingHudUiSetKeys.has('demandC') ||
      this.pendingHudUiSetKeys.has('demandI');
    const hasSpeed = this.pendingHudUiSetKeys.has('speed');
    const hasOptions =
      this.pendingHudUiSetKeys.has('optionAutoBudget') ||
      this.pendingHudUiSetKeys.has('optionAutoGo') ||
      this.pendingHudUiSetKeys.has('optionAutoBulldoze') ||
      this.pendingHudUiSetKeys.has('optionDisasters') ||
      this.pendingHudUiSetKeys.has('optionUserSoundOn') ||
      this.pendingHudUiSetKeys.has('optionDoAnimation') ||
      this.pendingHudUiSetKeys.has('optionDoMessages') ||
      this.pendingHudUiSetKeys.has('optionDoNotices');

    if (!hasFunds && !hasDate && !hasDemand && !hasSpeed && !hasOptions) {
      return undefined;
    }

    const hudPayload: NonNullable<HostPatchPayload['hud']> = {};
    if (hasFunds) {
      hudPayload.funds = this.authorityState.simState.TotalFunds;
      hudPayload.fundsLabel = this.hookHudState.fundsLabel;
    }
    if (hasDate) {
      hudPayload.date = {
        label: this.hookHudState.dateLabel,
        month: this.hookHudState.dateMonth,
        year: this.hookHudState.dateYear,
      };
    }
    if (hasDemand) {
      hudPayload.demand = {
        r: this.hookHudState.demandR,
        c: this.hookHudState.demandC,
        i: this.hookHudState.demandI,
      };
    }
    if (hasSpeed) {
      hudPayload.speed = this.simPaused ? 0 : this.authorityState.simState.SimMetaSpeed;
    }
    if (hasOptions) {
      hudPayload.options = { ...this.hookHudState.options };
    }

    this.pendingHudUiSetKeys.clear();
    return hudPayload;
  }

  /**
   * Builds one snapshot HUD payload from cached hook heads plus current speed.
   * Mirrors full-head baseline intent from `DoUpdateHeads` in
   * `ref/micropolis/src/sim/w_update.c` and visible speed behavior in
   * `ref/micropolis/src/sim/w_util.c`.
   */
  private buildHudSnapshotPayload(): NonNullable<HostSnapshotPayload['hud']> {
    return {
      funds: this.authorityState.simState.TotalFunds,
      fundsLabel: this.hookHudState.fundsLabel,
      date: {
        label: this.hookHudState.dateLabel,
        month: this.hookHudState.dateMonth,
        year: this.hookHudState.dateYear,
      },
      demand: {
        r: this.hookHudState.demandR,
        c: this.hookHudState.demandC,
        i: this.hookHudState.demandI,
      },
      speed: this.simPaused ? 0 : this.authorityState.simState.SimMetaSpeed,
      options: { ...this.hookHudState.options },
    };
  }
}

/**
 * Reads the authoritative `map` patch from one committed map-store tick.
 * Mirrors classic `Map[x][y]` mutation ownership in `ref/micropolis/src/sim/w_tool.c`
 * where map writes are accumulated per update cycle before map redraw handling.
 */
function readMapPatchFromTickResult(patches: ReadonlyArray<Patch>): Patch | null {
  for (const patch of patches) {
    if (patch.layer === 'map') {
      return patch;
    }
  }

  return null;
}

/**
 * Converts one sim-core redraw plan to the Playable Runtime host payload shape.
 * Mirrors redraw metadata produced by `planMapRedraw` in
 * `packages/sim-core/src/core/map-invalidation.ts`.
 */
function toHostMapRedrawPlanPayload(plan: MapRedrawPlan): HostMapRedrawPlanPayload {
  return {
    reason: plan.reason,
    fullRedraw: plan.fullRedraw,
    dirtyRects: plan.dirtyRects.map((rect) => ({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    })),
  };
}

/**
 * Projects one authoritative map patch into coordinate-addressed tile deltas.
 * Mirrors `Map[x][y]` index math in `ref/micropolis/src/sim/s_alloc.c`
 * (`index = x * WORLD_Y + y`) used by map update paths in `w_tool.c`/`w_con.c`.
 */
function toHostMapTileWordDeltas(
  mapPatch: Patch | null,
  mapHeight: number,
): HostMapPatchTileWordDelta[] {
  if (mapPatch === null || mapPatch.layer !== 'map') {
    return [];
  }

  const tileWordDeltas: HostMapPatchTileWordDelta[] = [];
  for (let cursor = 0; cursor < mapPatch.index.length; cursor += 1) {
    const index = mapPatch.index[cursor];
    const tileWord = mapPatch.next[cursor];
    if (index === undefined || tileWord === undefined) {
      continue;
    }

    tileWordDeltas.push({
      x: Math.floor(index / mapHeight),
      y: index % mapHeight,
      tileWord,
    });
  }

  return tileWordDeltas;
}

/**
 * Builds one id-indexed lookup table for realtime payload objects.
 * Mirrors per-sprite mutation ownership in `ref/micropolis/src/sim/w_sprite.c`.
 * Parity note: explicit id indexing is bridge transport metadata.
 */
function indexRealtimeObjectsById(
  objects: readonly HostRealtimeObjectWithIdPayload[],
): Map<string, HostRealtimeObjectWithIdPayload> {
  const byId = new Map<string, HostRealtimeObjectWithIdPayload>();
  for (const object of objects) {
    byId.set(object.id, { ...object });
  }
  return byId;
}

/**
 * Compares two realtime payload objects for delta generation.
 * Mirrors sprite field mutation checks in `ref/micropolis/src/sim/w_sprite.c`.
 * Parity note: comparison is payload-field based rather than object identity based.
 */
function areRealtimeObjectsEqual(
  left: HostRealtimeObjectWithIdPayload,
  right: HostRealtimeObjectWithIdPayload,
): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.type === right.type &&
    left.x === right.x &&
    left.y === right.y &&
    (left.frame ?? 0) === (right.frame ?? 0)
  );
}

/**
 * Converts sim-core tool result classes into Playable Runtime reject reasons.
 * Mirrors `DoTool` return-code classes in `ref/micropolis/src/sim/w_tool.c`
 * (`-1` out-of-bounds, `-2` no-funds, and other non-success values rejected).
 */
function rejectReasonFromToolResult(result: ToolResult): string | undefined {
  if (result === 'ok') {
    return undefined;
  }
  if (result === 'out-of-bounds') {
    return 'out-of-bounds';
  }
  if (result === 'no-funds') {
    return 'no-funds';
  }

  return 'invalid-placement';
}

/**
 * Validates tool coordinates as integer tile positions.
 * Mirrors C tool ingress expecting integral tile coordinates in
 * `ref/micropolis/src/sim/w_tool.c` and `ref/micropolis/src/sim/w_con.c`.
 */
function isPlacementCoordinate(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y);
}

/**
 * Marks sim-core `NewMapFlags` from phase dirty-map signals.
 * Mirrors `NewMapFlags[...] = 1` writes in `Simulate` from
 * `ref/micropolis/src/sim/s_sim.c`.
 */
function markMapFlagsForEnvelopeHost(
  state: SimCoreRuntimeState['simState'],
  flags: ReadonlyArray<SimMapFlag>,
): void {
  for (const flag of flags) {
    state.NewMapFlags[MAP_FLAGS[flag]] = 1;
  }
}

/**
 * Builds full sim-phase wiring for authority-owned ambient simulation ticks.
 * Mirrors `Simulate` + `MapScan` dispatch in `ref/micropolis/src/sim/s_sim.c`
 * and map-scan handlers in `ref/micropolis/src/sim/s_zone.c`, `s_disast.c`,
 * `s_sim.c`, and `s_scan.c`.
 */
function createEnvelopeHostSimPhaseSystems(): SimPhaseSystems {
  let mapScanHandlers: MapScanHandlers | undefined;

  return {
    mapScan: (phase, scanState, scanContext) => {
      if (mapScanHandlers === undefined) {
        mapScanHandlers = {
          onFire: createFireHandler(scanContext),
          onFlood: createFloodHandler(scanState, scanContext),
          onRadTile: createRadHandler(),
          onRoad: createRoadHandler(scanState, scanContext, {
            doBridge: createBridgeHandler(scanState, scanContext),
          }),
          onZone: createZoneHandler(scanState, scanContext),
          onRail: createRailHandler(scanState, scanContext),
        };
      }
      runMapScanPhase(scanState, scanContext, phase, mapScanHandlers);
    },
    setValves,
    clearCensus,
    takeCensus,
    take2Census,
    collectTax,
    cityEvaluation,
    decROGMem,
    decTrafficMem,
    markMapDirty: (flags, dirtyState) => {
      markMapFlagsForEnvelopeHost(dirtyState, flags);
    },
    sendMessages,
    doPowerScan,
    ptlScan,
    crimeScan,
    popDenScan,
    fireAnalysis,
    doDisasters,
  };
}

function normalizePatchIntervalMs(candidate: number | undefined): number | undefined {
  if (candidate === undefined) {
    return DEFAULT_PATCH_INTERVAL_MS;
  }
  if (!Number.isFinite(candidate) || candidate <= 0) {
    return undefined;
  }

  return Math.trunc(candidate);
}

/**
 * Clamps speed candidates to the Micropolis playable `setSpeed(short)` domain.
 * Mirrors clamping in `ref/micropolis/src/sim/w_util.c`.
 */
function normalizePlayableSpeed(candidate: number): number {
  const speed = Math.trunc(candidate);
  if (speed < 0) {
    return 0;
  }
  if (speed > 3) {
    return 3;
  }
  return speed;
}

/**
 * Clamps snapshot replay cursor requests to the known sequenced envelope range.
 * Mirrors bridge snapshot cursor recovery rules from
 * `ref/micropolis/spec/integration/SPEC.md`.
 */
function normalizeReplayCursor(candidate: number, highestKnown: number): number {
  if (!Number.isFinite(candidate)) {
    return 0;
  }

  const truncatedCandidate = Math.trunc(candidate);
  if (truncatedCandidate < 0) {
    return 0;
  }
  if (truncatedCandidate > highestKnown) {
    return highestKnown;
  }

  return truncatedCandidate;
}

/**
 * Resolves message text for one message id.
 * Mirrors `GetIndString` lookup intent from `ref/micropolis/src/sim/s_msg.c`.
 * Parity note: this host currently keeps the same compact bridge-side subset
 * used during migration and falls back to `Message <id>`.
 */
function messageTextForId(id: number): string {
  const text = RUNTIME_MESSAGE_TEXT[id];
  if (text !== undefined) {
    return text;
  }

  return `Message ${id}`;
}

/**
 * Stamps one message array with replay-stable tick/server-seq metadata.
 * Mirrors ordered message progression intent from
 * `ref/micropolis/src/sim/s_msg.c` plus bridge replay ordering in
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: C message payloads do not carry this metadata; this bridge host
 * adds it deterministically for replay-stable snapshots.
 */
function normalizeMessageReplayMetadata(
  messages: readonly HostHudMessagePayload[] | undefined,
  fallbackTick: number,
  fallbackServerSeq: number,
): HostHudMessagePayload[] {
  if (messages === undefined || messages.length === 0) {
    return [];
  }

  return messages.map((message) => ({
    ...message,
    tick: message.tick ?? fallbackTick,
    serverSeq: message.serverSeq ?? fallbackServerSeq,
  }));
}

/**
 * Adds legacy `hud.message` compatibility metadata from canonical message arrays.
 * Mirrors latest visible-message ownership in `SetMessageField`/`doMessage` from
 * `ref/micropolis/src/sim/s_msg.c`.
 * Parity note: C tracks one visible message slot, while bridge payloads also carry
 * message arrays; this keeps both representations aligned during migration.
 */
function withLegacyHudMessageCompatibility(
  hud: HostHudPayload | undefined,
  messages: readonly HostHudMessagePayload[],
): HostHudPayload | undefined {
  const latestMessage = messages.at(-1);
  if (latestMessage === undefined) {
    return hud;
  }

  return {
    ...(hud ?? {}),
    message: { ...latestMessage },
  };
}

/**
 * Clones one HUD message list before envelope emission/replay storage.
 * Mirrors copy-by-value transport boundaries around `SendMes`/`SendMesAt`
 * payload projection in `ref/micropolis/src/sim/s_msg.c`.
 */
function cloneHostHudMessagePayloadList(
  messages: readonly HostHudMessagePayload[],
): HostHudMessagePayload[] {
  return messages.map((message) => ({ ...message }));
}

/**
 * Clones one snapshot payload for replay-checkpoint immutability.
 * Mirrors deterministic snapshot replay baseline intent from
 * `ref/micropolis/spec/integration/SPEC.md`.
 */
function cloneHostSnapshotPayload(payload: HostSnapshotPayload): HostSnapshotPayload {
  return structuredClone(payload);
}

/**
 * Clones one patch payload for replay-log immutability.
 * Mirrors ordered patch replay-tail intent from
 * `ref/micropolis/spec/integration/SPEC.md`.
 */
function cloneHostPatchPayload(payload: HostPatchPayload): HostPatchPayload {
  return structuredClone(payload);
}

/**
 * Clones one sound-delta payload before queueing/emission/replay storage.
 * Mirrors sound intent value-copy boundaries around `MakeSound` / `MakeSoundOn`
 * in `ref/micropolis/src/sim/w_sound.c`.
 */
function cloneHostSoundDeltaPayload(soundDelta: HostSoundDeltaPayload): HostSoundDeltaPayload {
  return {
    ...soundDelta,
    ...(soundDelta.scope === undefined ? {} : { scope: { ...soundDelta.scope } }),
  };
}

/**
 * Clones one sound-delta list before envelope emission/replay storage.
 * Mirrors sound-intent ownership from `MakeSound`/`MakeSoundOn` in
 * `ref/micropolis/src/sim/w_sound.c`, adapted to deterministic bridge replay
 * retention in `ref/micropolis/spec/integration/SPEC.md`.
 */
function cloneHostSoundDeltaPayloadList(
  soundDeltas: readonly HostSoundDeltaPayload[],
): HostSoundDeltaPayload[] {
  return soundDeltas.map((soundDelta) => cloneHostSoundDeltaPayload(soundDelta));
}

/**
 * Normalizes one pending-sound queue tick key.
 * Mirrors non-negative monotonic sim tick assumptions from
 * `ref/micropolis/src/sim/s_sim.c`, adapted to bridge queue bookkeeping.
 */
function normalizeSoundQueueTick(candidateTick: number, fallbackTick: number): number {
  const normalizedFallback =
    Number.isFinite(fallbackTick) && fallbackTick >= 0 ? Math.trunc(fallbackTick) : 0;
  if (!Number.isFinite(candidateTick) || candidateTick < 0) {
    return normalizedFallback;
  }
  return Math.trunc(candidateTick);
}

/**
 * Clones one sequenced host envelope before replay-log persistence.
 * Mirrors deterministic bridge replay history ownership from
 * `ref/micropolis/spec/integration/SPEC.md`.
 */
function cloneReplaySequencedEnvelope(envelope: SequencedHostEnvelope): SequencedHostEnvelope {
  const soundDeltas =
    envelope.soundDeltas === undefined
      ? undefined
      : cloneHostSoundDeltaPayloadList(envelope.soundDeltas);

  if (envelope.kind === 'patch') {
    return {
      ...envelope,
      ...(soundDeltas === undefined ? {} : { soundDeltas }),
      payload: cloneHostPatchPayload(envelope.payload),
    };
  }

  if (envelope.kind === 'snapshot') {
    return {
      ...envelope,
      ...(soundDeltas === undefined ? {} : { soundDeltas }),
      payload: cloneHostSnapshotPayload(envelope.payload),
    };
  }

  return {
    ...envelope,
    ...(soundDeltas === undefined ? {} : { soundDeltas }),
  };
}

/**
 * Clamps one message feed array to the runtime-visible maximum.
 * Mirrors single-visible-message ownership in `SetMessageField` from
 * `ref/micropolis/src/sim/s_msg.c`, adapted to bounded bridge feed history.
 */
function clampMessageFeed(
  messages: readonly HostHudMessagePayload[],
): readonly HostHudMessagePayload[] {
  if (messages.length <= MESSAGE_LOG_LIMIT) {
    return messages.map((message) => ({ ...message }));
  }

  return messages.slice(messages.length - MESSAGE_LOG_LIMIT).map((message) => ({ ...message }));
}

/**
 * Normalizes browser city file names to C-style `.cty` save/load paths.
 * Mirrors `SaveCityAs` filename usage in `ref/micropolis/src/sim/s_fileio.c`.
 */
function sanitizeCityFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (trimmed.length === 0) {
    return DEFAULT_CITY_FILE_NAME;
  }
  return trimmed.toLowerCase().endsWith('.cty') ? trimmed : `${trimmed}.cty`;
}

/**
 * Resolve one scenario filename to its local/fetchable resource URL.
 * Mirrors `LoadScenario` `fname = "snro.*"` lookup identity in
 * `ref/micropolis/src/sim/s_fileio.c`.
 */
function getScenarioResourceUrl(fileName: string): URL {
  const resourceUrl = SCENARIO_RESOURCE_URLS.get(fileName);
  if (resourceUrl !== undefined) {
    return resourceUrl;
  }

  throw new Error(`unsupported scenario file: ${fileName}`);
}

/**
 * Build scenario resource URLs from canonical scenario metadata constants.
 * Mirrors `LoadScenario` filename selection in `ref/micropolis/src/sim/s_fileio.c`,
 * while resolving each `snro.*` payload to local `ref/micropolis/res`.
 */
function createScenarioResourceUrlTable(): ReadonlyMap<string, URL> {
  return new Map(
    SCENARIO_TABLE.map(({ fileName }) => [
      fileName,
      new URL(`../../../../../ref/micropolis/res/${fileName}`, import.meta.url),
    ]),
  );
}

/**
 * Read one scenario binary payload from file/fetch resources.
 * Mirrors `_load_file` byte acquisition in `ref/micropolis/src/sim/s_fileio.c`,
 * adapted for node/browser runtime hosts.
 */
async function readBinaryResourceFromUrl(resourceUrl: URL): Promise<Uint8Array> {
  if (resourceUrl.protocol === 'file:') {
    const fsPromisesSpecifier = 'node:fs/promises';
    const fsPromises = (await import(
      /* @vite-ignore */ fsPromisesSpecifier
    )) as NodeFsPromisesModule;
    return new Uint8Array(await fsPromises.readFile(resourceUrl));
  }

  const response = await fetch(resourceUrl);
  if (!response.ok) {
    throw new Error(`failed to fetch scenario resource ${resourceUrl}: ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Builds authoritative snapshot map words from sim-core map storage using
 * canonical bridge v1 index math.
 * Mirrors contiguous `Map[x][y]` ownership in `ref/micropolis/src/sim/s_alloc.c`
 * and snapshot/load ordering in `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: reads each tile through `getCoreBridgeV1SnapshotTileIndex`
 * (`index = x * height + y`) to keep bridge payload ordering explicit.
 */
function buildSnapshotTileWordsFromSimCoreMap(
  mapLayer: Uint16Array,
  mapWidth: number,
  mapHeight: number,
): Uint16Array {
  const tileCount = mapWidth * mapHeight;
  if (mapLayer.length < tileCount) {
    throw new Error(`expected map layer length >= ${tileCount}; got ${mapLayer.length}`);
  }

  const tileWords = new Uint16Array(tileCount);
  for (let x = 0; x < mapWidth; x += 1) {
    for (let y = 0; y < mapHeight; y += 1) {
      const snapshotIndex = getCoreBridgeV1SnapshotTileIndex(x, y, mapHeight);
      tileWords[snapshotIndex] = mapLayer[snapshotIndex] ?? 0;
    }
  }
  return tileWords;
}

/**
 * Initial HUD scalar cache before the first sim-core `runUiUpdate` pass.
 * Mirrors pre-`DoUpdateHeads` UI baseline intent in
 * `ref/micropolis/src/sim/w_update.c`.
 */
function createInitialHookHudState(): HookHudState {
  return {
    fundsLabel: 'Funds: $0',
    dateLabel: 'Jan 1900',
    dateMonth: 0,
    dateYear: 1900,
    demandR: 0,
    demandC: 0,
    demandI: 0,
    options: {
      autoBudget: true,
      autoGo: true,
      autoBulldoze: true,
      disasters: true,
      userSoundOn: true,
      doAnimation: true,
      doMessages: true,
      doNotices: true,
    },
  };
}
