import type { readFile as nodeReadFile } from 'node:fs/promises';

import { getCoreBridgeV1SnapshotTileIndex } from '../../../../../packages/core-bridge/src/types.ts';
import {
  lookupDoMessageText,
  lookupMicropolisNoticeMessage,
} from '../../../../../packages/sim-assets/src/message-table.ts';
import { resolveSimUiPlayableToolDidToolSoundIntent } from '../../../../../packages/sim-assets/src/sim-ui.ts';
import {
  applyToolAction,
  buildCensusGraphData,
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
  doBudgetFromMenu,
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
  updateFundEffects,
} from '../../../../../packages/sim-core/src/index.ts';
import { setFunds } from '../../../../../packages/sim-core/src/systems/funds.ts';
import { doPowerScan, pushPowerStack } from '../../../../../packages/sim-core/src/systems/power.ts';
import { loadCityLikeC, loadScenarioLikeC } from '../../../../../packages/sim-io/src/load.ts';
import { saveCityAsLikeC } from '../../../../../packages/sim-io/src/save.ts';
import {
  getScenarioDefinition,
  SCENARIO_TABLE,
} from '../../../../../packages/sim-io/src/scenarios.ts';
import { SimCoreRuntimeState } from '../sim-core-runtime-state.ts';
import { NEW_CITY_TERRAIN_OPTIONS } from './new-city.ts';
import type { PlayableDisasterChoiceId } from './playable-disaster-choices.ts';
import type { PlayableRuntimeHostOptions } from './playable-runtime-host-options.ts';
import type {
  ClientEnvelope,
  CoreHost,
  CoreHostConnection,
  HostEnvelope,
  HostHudBudgetPayload,
  HostHudEvaluationPayload,
  HostHudGraphPayload,
  HostHudMessagePayload,
  HostHudNoticePayload,
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
interface SnapshotReplayBaselineSelection {
  checkpointServerSeq: number;
  checkpoint: SnapshotReplayCheckpoint;
}
interface ReplayLogEntry {
  envelope: SequencedHostEnvelope;
  replayTailEligible: boolean;
}
interface EmitSequencedEnvelopeOptions {
  replayTailEligible?: boolean;
  recordMessages?: boolean;
  includeQueuedSoundDeltas?: boolean;
  recordReplay?: boolean;
}
interface SessionCommandQueueState {
  pending: SessionQueueItem[];
  draining: boolean;
  pendingAmbientTicks: number;
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
type PendingNoticeUpdate = HostHudNoticePayload | null | undefined;

const DEFAULT_CITY_FILE_NAME = 'newcity.cty';
const DEFAULT_CITY_NAME = 'New City';
const MESSAGE_LOG_LIMIT = 24;
const REPLAY_HISTORY_LIMIT = 512;
const REPLAY_CHECKPOINT_CADENCE_SERVER_SEQS = 64;
const REPLAY_CHECKPOINT_LIMIT = 8;
const EASY_GAME_LEVEL = 0;
const MEDIUM_GAME_LEVEL = 1;
const HARD_GAME_LEVEL = 2;
const EASY_GAME_LEVEL_STARTING_FUNDS = 20_000;
const MEDIUM_GAME_LEVEL_STARTING_FUNDS = 10_000;
const HARD_GAME_LEVEL_STARTING_FUNDS = 5_000;
// C runtime timer default from `sim_delay = 50` in `ref/micropolis/src/sim/sim.c`.
const DEFAULT_PATCH_INTERVAL_MS = 50;
const MICROPOLIS_FLAG_BLINK_PERIOD_MS = 1000;
const MICROPOLIS_FLAG_BLINK_ONSET_MS = 500;
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
  private simPaused = true;
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
  private hasStartedCitySession = false;
  private intervalHandle: ReturnType<typeof setInterval> | undefined;
  private readonly scenarioResourceLoader: (fileName: string) => Promise<Uint8Array>;
  private readonly hookHudState: HookHudState = createInitialHookHudState();
  private readonly pendingHudUiSetKeys = new Set<HudUiSetKey>();
  private graphHudDirty = true;
  private lastHudCityPopulation = 0;
  private lastHudCityClass = 0;
  private lastHudBudgetPayload: HostHudBudgetPayload | null = null;
  private lastHudEvaluationPayload: HostHudEvaluationPayload | null = null;
  private pendingHookMessages: HostHudMessagePayload[] = [];
  private activeNotice: HostHudNoticePayload | null = null;
  private pendingNoticeUpdate: PendingNoticeUpdate = undefined;
  private readonly pendingSoundDeltasByTick = new Map<number, HostSoundDeltaPayload[]>();
  private readonly messageLog: HostHudMessagePayload[] = [];
  private readonly realtimeContext: RealtimeContext;
  private readonly realtimeObjectIds = new WeakMap<SimSprite, string>();
  private nextRealtimeObjectId = 1;
  private lastRealtimeObjectsById = new Map<string, HostRealtimeObjectWithIdPayload>();
  private blinkElapsedMs = 0;
  private blinkUnpoweredZoneCenter = false;
  private lastEmittedMapBlinkUnpoweredZoneCenter: boolean | null = null;

  public constructor(options: PlayableRuntimeHostOptions = {}) {
    this.authorityState = new SimCoreRuntimeState({
      hooks: {
        uiSet: (key, value) => this.captureUiSet(key, value),
        makeSound: (channel, sound) => this.captureSimCoreHookSound(channel, sound),
        sendMes: (id) => this.captureMessage(id),
        sendMesAt: (id, x, y) => this.captureMessageAt(id, x, y),
        doAllGraphs: () => this.captureGraphDirty(),
        changeCensus: () => this.captureGraphDirty(),
        doLoseGame: () => this.captureLoseGame(),
        doWinGame: () => this.captureWinGame(),
      },
    });
    const mapLayerInfo = this.authorityState.store.layerInfo('map');
    this.mapWidth = mapLayerInfo.width;
    this.mapHeight = mapLayerInfo.height;
    this.simPausedSpeed = normalizePlayableSpeed(this.authorityState.simState.SimMetaSpeed);
    this.authorityState.simState.SimSpeed = 0;
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
    const initialCityStats = readCanonicalCityStatsFromSimState(this.authorityState.simState);
    this.lastHudCityPopulation = initialCityStats.cityPopulation;
    this.lastHudCityClass = initialCityStats.cityClass;
    this.lastHudEvaluationPayload = buildHostHudEvaluationPayload(this.authorityState.simState);
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
      pendingAmbientTicks: 0,
    });
    return sessionId;
  }

  private routeDisconnect(sessionId: number): void {
    if (!this.isSessionActive(sessionId)) {
      return;
    }

    this.stopAmbientInterval();
    this.pendingSoundDeltasByTick.clear();
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
      !this.hasStartedCitySession ||
      this.authorityState.simState.SimSpeed === 0
    ) {
      return;
    }

    const sessionQueue = this.readOrCreateSessionCommandQueue(sessionId);
    // C timer ticks are periodic but not "must replay every missed interval";
    // keep one pending ambient tick to avoid unbounded backlog growth.
    if (sessionQueue.pendingAmbientTicks > 0) {
      return;
    }
    sessionQueue.pending.push({ kind: 'ambient-tick' });
    sessionQueue.pendingAmbientTicks += 1;
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
      pendingAmbientTicks: 0,
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

        if (queue.pendingAmbientTicks > 0) {
          queue.pendingAmbientTicks -= 1;
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

    const replayCursor = normalizeReplayCursor(
      envelope.fromServerSeq,
      this.lastEmittedServerSeq,
      this.readOldestRetainedReplayCursor(),
    );
    this.emitSnapshotReplay(envelope.roomId, envelope.clientId, replayCursor);
  }

  /**
   * Reads the oldest retained replay cursor that can be reconstructed exactly.
   * Mirrors recovery-window cursor ownership from
   * `ref/micropolis/spec/integration/SPEC.md`.
   * Parity note: unlike C (single-process state), browser replay retention is
   * bounded to prevent unbounded memory growth during long sessions.
   */
  private readOldestRetainedReplayCursor(): number {
    const oldestReplayEntry = this.sequencedReplayLog[0];
    if (oldestReplayEntry !== undefined) {
      return oldestReplayEntry.envelope.serverSeq;
    }
    return 0;
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
      this.onEnvelope === undefined ||
      !this.hasStartedCitySession
    ) {
      return;
    }

    if (this.authorityState.simState.SimSpeed === 0) {
      this.refreshAmbientInterval();
      return;
    }

    const { roomId, clientId } = this.lifecycle;
    this.advanceCommandTick();
    this.advanceBlinkPhaseForAmbientTick();
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
    const pendingNotice = this.drainPendingNoticeUpdate();
    if (pendingNotice !== undefined) {
      payload.notice = cloneHostHudNoticePayload(pendingNotice);
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
    const hasBlinkPhaseChanged =
      this.lastEmittedMapBlinkUnpoweredZoneCenter === null ||
      this.lastEmittedMapBlinkUnpoweredZoneCenter !== this.blinkUnpoweredZoneCenter;
    if (tileWordDeltas.length === 0 && !hasPlanDrivenRedraw && !hasBlinkPhaseChanged) {
      return undefined;
    }

    this.lastEmittedMapBlinkUnpoweredZoneCenter = this.blinkUnpoweredZoneCenter;

    return {
      tileWordDeltas,
      blinkUnpoweredZoneCenter: this.blinkUnpoweredZoneCenter,
      redrawPlan,
    };
  }

  /**
   * Advances the authoritative blink-phase clock from one ambient sim timer step.
   * Mirrors `flagBlink` refresh cadence in `sim_update` (`ref/micropolis/src/sim/sim.c`),
   * adapted to this host's interval-driven ambient tick loop.
   */
  private advanceBlinkPhaseForAmbientTick(): void {
    const intervalMs = this.patchIntervalMs ?? DEFAULT_PATCH_INTERVAL_MS;
    this.blinkElapsedMs += intervalMs;
    this.blinkUnpoweredZoneCenter = isEnvelopeHostUnpoweredZoneBlinkPhase(this.blinkElapsedMs);
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
   * Applies playable sim-control commands through authoritative sim-core state.
   * Mirrors `SimCmd*` command ingress in `ref/micropolis/src/sim/w_sim.c`, including
   * pause/resume/speed plus budget/tax commands used by `whead.tcl`/`wbudget.tcl`.
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

    if (command.control === 'set-speed') {
      this.setSimulationSpeed(command.speed);
      return;
    }

    if (command.control === 'set-tax-rate') {
      this.setTaxRate(command.taxRate);
      return;
    }

    if (command.control === 'set-road-percent') {
      this.setRoadPercent(command.percent);
      return;
    }

    if (command.control === 'set-fire-percent') {
      this.setFirePercent(command.percent);
      return;
    }

    if (command.control === 'set-police-percent') {
      this.setPolicePercent(command.percent);
      return;
    }

    if (command.control === 'set-auto-budget') {
      this.setAutoBudget(command.enabled);
      return;
    }

    this.openBudgetFromMenu();
  }

  /**
   * Tax-rate command semantics for envelope-host budget controls.
   * Mirrors `SimCmdTaxRate` (`sim TaxRate`) in `ref/micropolis/src/sim/w_sim.c`.
   */
  private setTaxRate(candidateTaxRate: number): void {
    this.authorityState.simState.CityTax = normalizeBudgetTaxRate(candidateTaxRate);
  }

  /**
   * Road-funding slider semantics for envelope-host budget controls.
   * Mirrors `SimCmdRoadFund` (`sim RoadFund`) in `ref/micropolis/src/sim/w_sim.c`.
   */
  private setRoadPercent(candidatePercent: number): void {
    const percent = normalizeBudgetPercent(candidatePercent);
    this.authorityState.simState.roadPercent = percent / 100;
    this.authorityState.simState.RoadSpend = Math.trunc(
      (this.authorityState.simState.RoadFund * percent) / 100,
    );
    updateFundEffects(this.authorityState.simState, this.authorityState.simContext);
  }

  /**
   * Fire-funding slider semantics for envelope-host budget controls.
   * Mirrors `SimCmdFireFund` (`sim FireFund`) in `ref/micropolis/src/sim/w_sim.c`.
   */
  private setFirePercent(candidatePercent: number): void {
    const percent = normalizeBudgetPercent(candidatePercent);
    this.authorityState.simState.firePercent = percent / 100;
    this.authorityState.simState.FireSpend = Math.trunc(
      (this.authorityState.simState.FireFund * percent) / 100,
    );
    updateFundEffects(this.authorityState.simState, this.authorityState.simContext);
  }

  /**
   * Police-funding slider semantics for envelope-host budget controls.
   * Mirrors `SimCmdPoliceFund` (`sim PoliceFund`) in `ref/micropolis/src/sim/w_sim.c`.
   */
  private setPolicePercent(candidatePercent: number): void {
    const percent = normalizeBudgetPercent(candidatePercent);
    this.authorityState.simState.policePercent = percent / 100;
    this.authorityState.simState.PoliceSpend = Math.trunc(
      (this.authorityState.simState.PoliceFund * percent) / 100,
    );
    updateFundEffects(this.authorityState.simState, this.authorityState.simContext);
  }

  /**
   * Auto-budget toggle semantics for envelope-host budget controls.
   * Mirrors `SimCmdAutoBudget` (`sim AutoBudget`) in `ref/micropolis/src/sim/w_sim.c`.
   */
  private setAutoBudget(enabled: boolean): void {
    this.authorityState.simState.autoBudget = enabled;
    this.authorityState.simState.MustUpdateOptions = 1;
  }

  /**
   * Windows->Budget menu-open semantics for envelope-host budget controls.
   * Mirrors `DoBudgetFromMenu` in `ref/micropolis/src/sim/w_budget.c`.
   */
  private openBudgetFromMenu(): void {
    doBudgetFromMenu(this.authorityState.simState, this.authorityState.simContext);
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
   * Applies C-style game-level + starting-funds mapping on authoritative state.
   * Mirrors `SetGameLevelFunds(short)` in `ref/micropolis/src/sim/w_util.c`:
   * - easy (`0`) => `$20,000`
   * - medium (`1`) => `$10,000`
   * - hard (`2`) => `$5,000`
   *
   * Parity note: this helper is used as an opt-in on scenario start, since the
   * base `LoadScenario` path in C initializes its own scenario-specific funds.
   */
  private applyGameLevelFunds(level: 0 | 1 | 2): void {
    switch (level) {
      case MEDIUM_GAME_LEVEL:
        setFunds(this.authorityState.simState, MEDIUM_GAME_LEVEL_STARTING_FUNDS);
        break;
      case HARD_GAME_LEVEL:
        setFunds(this.authorityState.simState, HARD_GAME_LEVEL_STARTING_FUNDS);
        break;
      default:
        setFunds(this.authorityState.simState, EASY_GAME_LEVEL_STARTING_FUNDS);
        break;
    }

    this.authorityState.simState.GameLevel = level;
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
      !this.hasStartedCitySession ||
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
   * If `terrainSeed` is omitted, this mirrors classic random-seed behavior by
   * sourcing one fresh `next16()` value from the authoritative RNG.
   */
  private applyCityLifecycleCommand(command: PlayableCityLifecycleCommand): void {
    const terrainSeed = command.terrainSeed ?? this.authorityState.simContext.rng.next16();
    resetForNewCityFromSeed(this.authorityState.simState, this.authorityState.simContext, {
      seed: terrainSeed,
      ...NEW_CITY_TERRAIN_OPTIONS,
    });

    const gameLevel = command.gameLevel ?? EASY_GAME_LEVEL;
    this.applyGameLevelFunds(gameLevel);
    this.authorityState.simState.SimMetaSpeed = 3;
    this.authorityState.simState.SimSpeed = 3;
    this.cityFileName = DEFAULT_CITY_FILE_NAME;
    this.cityName = DEFAULT_CITY_NAME;
    this.syncHostStateAfterLoadLikeCommand();
    // Tcl `DoNewCity` in `micropolis.tcl` calls `UIShowPicture 48`.
    this.captureNoticeById(48);
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
    // Tcl `UIDidLoadCity` notice path shows message 49 with file name interpolation.
    this.captureNoticeById(49, [this.cityFileName]);
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

    if (command.gameLevel !== undefined) {
      this.applyGameLevelFunds(command.gameLevel);
    }

    this.cityFileName = `${loadResult.scenario.fileName}.cty`;
    this.cityName = loadResult.scenario.name;
    this.syncHostStateAfterLoadLikeCommand();
    // Tcl `DoScenario`/`UIStartScenario` call `UIShowPicture <scenario-id>`.
    this.captureNoticeById(loadResult.scenario.id);

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
    this.hasStartedCitySession = true;
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
    this.graphHudDirty = false;
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
    const baseline = this.readSnapshotReplayBaselineSelection(replayCursor);
    const replayTail = this.readSnapshotReplayTail(baseline.checkpointServerSeq);
    this.emitSnapshotFromPayload(
      roomId,
      clientId,
      baseline.checkpoint.payload,
      baseline.checkpoint.tick,
      {
        replayTailEligible: false,
        recordMessages: false,
        includeQueuedSoundDeltas: false,
        recordReplay: false,
      },
    );
    for (const envelope of replayTail) {
      this.emitSequencedEnvelope(this.retargetSequencedEnvelope(envelope, roomId, clientId), {
        replayTailEligible: false,
        recordMessages: false,
        includeQueuedSoundDeltas: false,
        recordReplay: false,
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
    if (options.recordReplay !== false) {
      this.recordReplayEnvelope(sequencedEnvelope, options);
    }
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
   * Stamps message/notice payload entries with deterministic replay metadata.
   * Mirrors ordered message and notice delivery ownership in `doMessage` from
   * `ref/micropolis/src/sim/s_msg.c` and `UIShowPicture` in
   * `ref/micropolis/res/micropolis.tcl`, plus bridge replay ordering invariants
   * from `ref/micropolis/spec/integration/SPEC.md`.
   * Parity note: C payloads do not include tick/sequence fields; this host writes
   * transport metadata so snapshot replay preserves original ordering context.
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
      const normalizedNotice = normalizeNoticeReplayMetadata(
        envelope.payload.notice,
        envelope.tick,
        envelope.serverSeq,
      );
      if (normalized.length === 0 && normalizedNotice === undefined) {
        return envelope;
      }

      const payload = { ...envelope.payload };
      if (normalized.length > 0) {
        this.appendMessageLog(normalized);
        const canonicalMessageDeltas = cloneHostHudMessagePayloadList(normalized);
        payload.hud = withLegacyHudMessageCompatibility(payload.hud, canonicalMessageDeltas);
        payload.messageDeltas = canonicalMessageDeltas;
        payload.messages = cloneHostHudMessagePayloadList(canonicalMessageDeltas);
      }
      if (normalizedNotice !== undefined) {
        payload.notice = cloneHostHudNoticePayload(normalizedNotice);
      }

      return {
        ...envelope,
        payload,
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
    const normalizedNotice = normalizeNoticeReplayMetadata(
      envelope.payload.notice,
      envelope.tick,
      envelope.serverSeq,
    );
    if (normalized.length === 0) {
      this.replaceMessageLog([]);
      if (normalizedNotice === undefined) {
        return envelope;
      }
      return {
        ...envelope,
        payload: {
          ...envelope.payload,
          notice: cloneHostHudNoticePayload(normalizedNotice),
        },
      };
    }

    this.replaceMessageLog(normalized);
    const canonicalSnapshotMessages = cloneHostHudMessagePayloadList(normalized);
    const payload = {
      ...envelope.payload,
      hud: withLegacyHudMessageCompatibility(envelope.payload.hud, canonicalSnapshotMessages),
      messages: canonicalSnapshotMessages,
      messageDeltas: cloneHostHudMessagePayloadList(canonicalSnapshotMessages),
      ...(normalizedNotice === undefined
        ? {}
        : { notice: cloneHostHudNoticePayload(normalizedNotice) }),
    };
    return {
      ...envelope,
      payload,
    };
  }

  /**
   * Reads one replay-baseline snapshot checkpoint selection for a clamped cursor.
   * Mirrors checkpoint-based recovery baseline intent from
   * `ref/micropolis/spec/integration/SPEC.md`.
   */
  private readSnapshotReplayBaselineSelection(
    replayCursor: number,
  ): SnapshotReplayBaselineSelection {
    const oldestRetainedCursor = this.readOldestRetainedReplayCursor();
    const checkpointServerSeq = this.selectSnapshotReplayBaselineServerSeq(
      replayCursor,
      oldestRetainedCursor,
    );
    const checkpoint =
      checkpointServerSeq === undefined
        ? undefined
        : this.snapshotReplayCheckpoints.get(checkpointServerSeq);
    if (checkpointServerSeq !== undefined && checkpoint !== undefined) {
      return {
        checkpointServerSeq,
        checkpoint: {
          tick: checkpoint.tick,
          payload: cloneHostSnapshotPayload(checkpoint.payload),
        },
      };
    }

    return {
      checkpointServerSeq: this.lastEmittedServerSeq,
      checkpoint: {
        tick: this.tick,
        payload: this.buildSnapshotPayload(),
      },
    };
  }

  /**
   * Selects one retained replay checkpoint server sequence for baseline replay.
   * Mirrors deterministic replay-baseline selection from
   * `ref/micropolis/spec/integration/SPEC.md`.
   * Parity note: sparse checkpoint retention may not include a checkpoint at the
   * replay cursor, so this host prefers checkpoints that can still be replayed
   * from retained tail history (`>= oldestRetained - 1`) and otherwise falls
   * forward to the next retained checkpoint.
   */
  private selectSnapshotReplayBaselineServerSeq(
    replayCursor: number,
    oldestRetainedCursor: number,
  ): number | undefined {
    const checkpointServerSeqs = [...this.snapshotReplayCheckpoints.keys()].sort(
      (left, right) => left - right,
    );
    if (checkpointServerSeqs.length === 0) {
      return undefined;
    }

    const minimumReplayableServerSeq = oldestRetainedCursor - 1;
    let bestAtOrBeforeCursor = Number.NEGATIVE_INFINITY;
    for (const checkpointServerSeq of checkpointServerSeqs) {
      if (checkpointServerSeq > replayCursor) {
        continue;
      }
      if (checkpointServerSeq < minimumReplayableServerSeq) {
        continue;
      }
      bestAtOrBeforeCursor = checkpointServerSeq;
    }
    if (Number.isFinite(bestAtOrBeforeCursor)) {
      return Math.trunc(bestAtOrBeforeCursor);
    }

    for (const checkpointServerSeq of checkpointServerSeqs) {
      if (checkpointServerSeq >= replayCursor) {
        return checkpointServerSeq;
      }
    }

    let fallbackAtOrBeforeCursor = Number.NEGATIVE_INFINITY;
    for (const checkpointServerSeq of checkpointServerSeqs) {
      if (checkpointServerSeq <= replayCursor) {
        fallbackAtOrBeforeCursor = checkpointServerSeq;
      }
    }
    if (!Number.isFinite(fallbackAtOrBeforeCursor)) {
      return undefined;
    }
    return Math.trunc(fallbackAtOrBeforeCursor);
  }

  /**
   * Reads one ordered sequenced replay tail after one selected baseline checkpoint.
   * Mirrors bridge replay-tail ordering intent from
   * `ref/micropolis/spec/integration/SPEC.md`.
   * Parity note: snapshot envelopes are excluded from tail replay because this
   * host emits exactly one deterministic replay baseline snapshot first.
   */
  private readSnapshotReplayTail(baselineCheckpointServerSeq: number): SequencedHostEnvelope[] {
    return this.sequencedReplayLog
      .filter(
        (entry) =>
          entry.replayTailEligible && entry.envelope.serverSeq > baselineCheckpointServerSeq,
      )
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
    if (this.shouldCaptureReplayCheckpoint(envelope)) {
      this.snapshotReplayCheckpoints.set(envelope.serverSeq, {
        tick: envelope.tick,
        payload: cloneHostSnapshotPayload(this.buildSnapshotPayload()),
      });
    }
    this.pruneReplayHistory();
  }

  /**
   * Prunes retained replay envelopes/checkpoints to a bounded recovery window.
   * Mirrors recovery replay intent from `ref/micropolis/spec/integration/SPEC.md`,
   * with a bounded browser-memory retention policy not needed in C.
   */
  private pruneReplayHistory(): void {
    if (this.sequencedReplayLog.length <= REPLAY_HISTORY_LIMIT) {
      this.pruneReplayCheckpointsToLimit();
      return;
    }

    const overflowCount = this.sequencedReplayLog.length - REPLAY_HISTORY_LIMIT;
    const prunedEntries = this.sequencedReplayLog.splice(0, overflowCount);
    for (const entry of prunedEntries) {
      this.snapshotReplayCheckpoints.delete(entry.envelope.serverSeq);
    }
    this.pruneReplayCheckpointsToLimit();
  }

  /**
   * Returns whether one sequenced envelope should capture a full replay checkpoint.
   * Mirrors snapshot-baseline cadence intent in
   * `packages/core-bridge/src/types.ts` (`CORE_BRIDGE_V1_DEFAULT_SNAPSHOT_CADENCE_TICKS`)
   * and deterministic replay recovery ownership in
   * `ref/micropolis/spec/integration/SPEC.md`.
   * Parity note: unlike Micropolis C in-process state (no retained replay
   * snapshots), browser recovery keeps dense checkpoints within the bounded
   * replay-history window, then falls back to sparse cadence to bound memory.
   */
  private shouldCaptureReplayCheckpoint(envelope: SequencedHostEnvelope): boolean {
    if (this.sequencedReplayLog.length <= REPLAY_HISTORY_LIMIT) {
      return true;
    }
    if (envelope.kind === 'snapshot') {
      return true;
    }
    return envelope.serverSeq % REPLAY_CHECKPOINT_CADENCE_SERVER_SEQS === 0;
  }

  /**
   * Prunes retained replay checkpoints to a bounded sparse window.
   * Mirrors bounded-history policy intent from Micropolis C historical buffers
   * (`HISTLEN`/`MISCHISTLEN`) while preserving bridge replay checkpoints from
   * `ref/micropolis/spec/integration/SPEC.md`.
   * Parity note: checkpoint server sequence `0` is always preserved as the
   * bootstrap baseline for empty-history recovery.
   */
  private pruneReplayCheckpointsToLimit(): void {
    const nonBootstrapCheckpointServerSeqs = [...this.snapshotReplayCheckpoints.keys()]
      .filter((checkpointServerSeq) => checkpointServerSeq !== 0)
      .sort((left, right) => left - right);
    if (nonBootstrapCheckpointServerSeqs.length <= REPLAY_CHECKPOINT_LIMIT) {
      return;
    }

    const oldestRetainedCursor = this.readOldestRetainedReplayCursor();
    const retainedCheckpointServerSeqs =
      nonBootstrapCheckpointServerSeqs.slice(-REPLAY_CHECKPOINT_LIMIT);
    const anchorAtOrBeforeOldest = [...nonBootstrapCheckpointServerSeqs]
      .reverse()
      .find((checkpointServerSeq) => checkpointServerSeq <= oldestRetainedCursor);
    if (
      anchorAtOrBeforeOldest !== undefined &&
      !retainedCheckpointServerSeqs.includes(anchorAtOrBeforeOldest)
    ) {
      retainedCheckpointServerSeqs[0] = anchorAtOrBeforeOldest;
    }

    const retainedCheckpointSet = new Set(retainedCheckpointServerSeqs);
    for (const checkpointServerSeq of nonBootstrapCheckpointServerSeqs) {
      if (retainedCheckpointSet.has(checkpointServerSeq)) {
        continue;
      }
      this.snapshotReplayCheckpoints.delete(checkpointServerSeq);
    }
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
    this.lastEmittedMapBlinkUnpoweredZoneCenter = this.blinkUnpoweredZoneCenter;
    const hud = this.buildHudSnapshotPayload();
    const notice = this.activeNotice === null ? null : cloneHostHudNoticePayload(this.activeNotice);
    if (this.messageLog.length === 0) {
      return {
        map: {
          width: this.mapWidth,
          height: this.mapHeight,
          tileWords,
          blinkUnpoweredZoneCenter: this.blinkUnpoweredZoneCenter,
        },
        hud,
        notice,
        realtime: this.buildRealtimeSnapshotPayload(),
      };
    }

    const snapshotMessages = cloneHostHudMessagePayloadList(this.messageLog);
    return {
      map: {
        width: this.mapWidth,
        height: this.mapHeight,
        tileWords,
        blinkUnpoweredZoneCenter: this.blinkUnpoweredZoneCenter,
      },
      hud: withLegacyHudMessageCompatibility(hud, snapshotMessages),
      notice,
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
   * Marks graph HUD payloads dirty after census/graph hooks.
   * Mirrors `ChangeCensus` + `doAllGraphs` invalidation ownership in
   * `ref/micropolis/src/sim/w_graph.c`.
   */
  private captureGraphDirty(): void {
    this.graphHudDirty = true;
  }

  /**
   * Captures one authoritative `SendMes` hook delivery from sim-core.
   * Mirrors `SendMes` dispatch ownership in `ref/micropolis/src/sim/s_msg.c`.
   */
  private captureMessage(id: number): void {
    if (shouldProjectHudMessageToFeed(id)) {
      this.pendingHookMessages.push({
        id,
        text: messageTextForId(id),
      });
    }
    if (id < 0) {
      this.captureNoticeById(-id);
    }
  }

  /**
   * Captures one authoritative `SendMesAt` hook delivery from sim-core.
   * Mirrors `SendMesAt` dispatch ownership in `ref/micropolis/src/sim/s_msg.c`.
   */
  private captureMessageAt(id: number, x: number, y: number): void {
    if (shouldProjectHudMessageToFeed(id)) {
      this.pendingHookMessages.push({
        id,
        text: messageTextForId(id),
        x: Math.trunc(x),
        y: Math.trunc(y),
      });
    }
    if (id < 0) {
      this.captureNoticeById(-id);
    }
  }

  /**
   * Captures one `DoLoseGame` hook from sim-core and applies host-side lose flow.
   * Mirrors `DoLoseGame -> UILoseGame -> UIPickScenarioMode + UIShowPicture 200` in
   * `ref/micropolis/src/sim/s_msg.c` and `ref/micropolis/res/micropolis.tcl`.
   */
  private captureLoseGame(): void {
    this.pauseSimulation();
    this.captureNoticeById(200);
  }

  /**
   * Captures one `DoWinGame` hook from sim-core and applies host-side win flow.
   * Mirrors `DoWinGame -> UIWinGame -> UIShowPicture 100` in
   * `ref/micropolis/src/sim/s_msg.c` and `ref/micropolis/res/micropolis.tcl`.
   */
  private captureWinGame(): void {
    this.captureNoticeById(100);
  }

  /**
   * Resolves one notice-table id into active notice payload state.
   * Mirrors `UIShowPictureOn` `Messages($id)` lookup + optional `format` interpolation
   * in `ref/micropolis/res/micropolis.tcl`.
   */
  private captureNoticeById(id: number, parameters: readonly (string | number)[] = []): void {
    const notice = lookupMicropolisNoticeMessage(id, parameters);
    if (notice === undefined) {
      return;
    }

    const activeNotice: HostHudNoticePayload = {
      id: notice.id,
      title: notice.title,
      body: notice.body,
      color: notice.color,
    };
    this.activeNotice = activeNotice;
    this.pendingNoticeUpdate = activeNotice;
  }

  /**
   * Drains one pending notice update for the next emitted payload.
   * Mirrors latest-notice replacement ownership from `UIShowPictureOn` in
   * `ref/micropolis/res/micropolis.tcl`.
   */
  private drainPendingNoticeUpdate(): PendingNoticeUpdate {
    const pendingUpdate = this.pendingNoticeUpdate;
    this.pendingNoticeUpdate = undefined;
    if (pendingUpdate === undefined) {
      return undefined;
    }
    return cloneHostHudNoticePayload(pendingUpdate);
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
    const pendingNotice = this.drainPendingNoticeUpdate();
    if (pendingNotice !== undefined) {
      payload.notice = cloneHostHudNoticePayload(pendingNotice);
    }

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
    const cityStats = readCanonicalCityStatsFromSimState(this.authorityState.simState);
    const hasCityStats =
      cityStats.cityPopulation !== this.lastHudCityPopulation ||
      cityStats.cityClass !== this.lastHudCityClass;
    const budgetPayload = buildHostHudBudgetPayload(this.authorityState.simState);
    const hasBudget =
      this.lastHudBudgetPayload === null ||
      !areHostHudBudgetPayloadsEqual(this.lastHudBudgetPayload, budgetPayload);
    const evaluationPayload = buildHostHudEvaluationPayload(this.authorityState.simState);
    const hasEvaluation =
      this.lastHudEvaluationPayload === null ||
      !areHostHudEvaluationPayloadsEqual(this.lastHudEvaluationPayload, evaluationPayload);
    const hasGraph = this.graphHudDirty;

    if (
      !hasFunds &&
      !hasDate &&
      !hasDemand &&
      !hasSpeed &&
      !hasOptions &&
      !hasCityStats &&
      !hasBudget &&
      !hasEvaluation &&
      !hasGraph
    ) {
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
    if (hasCityStats) {
      hudPayload.cityPopulation = cityStats.cityPopulation;
      hudPayload.cityClass = cityStats.cityClass;
      this.lastHudCityPopulation = cityStats.cityPopulation;
      this.lastHudCityClass = cityStats.cityClass;
    }
    if (hasBudget) {
      hudPayload.budget = budgetPayload;
      this.lastHudBudgetPayload = { ...budgetPayload };
    }
    if (hasEvaluation) {
      hudPayload.evaluation = cloneHostHudEvaluationPayload(evaluationPayload);
      this.lastHudEvaluationPayload = cloneHostHudEvaluationPayload(evaluationPayload);
    }
    if (hasGraph) {
      hudPayload.graph = buildHostHudGraphPayload(this.authorityState.simState);
      this.graphHudDirty = false;
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
    const cityStats = readCanonicalCityStatsFromSimState(this.authorityState.simState);
    const budgetPayload = buildHostHudBudgetPayload(this.authorityState.simState);
    const evaluationPayload = buildHostHudEvaluationPayload(this.authorityState.simState);
    this.lastHudCityPopulation = cityStats.cityPopulation;
    this.lastHudCityClass = cityStats.cityClass;
    this.lastHudBudgetPayload = { ...budgetPayload };
    this.lastHudEvaluationPayload = cloneHostHudEvaluationPayload(evaluationPayload);
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
      cityPopulation: cityStats.cityPopulation,
      cityClass: cityStats.cityClass,
      speed: this.simPaused ? 0 : this.authorityState.simState.SimMetaSpeed,
      options: { ...this.hookHudState.options },
      evaluation: evaluationPayload,
      budget: budgetPayload,
      graph: buildHostHudGraphPayload(this.authorityState.simState),
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
          onZone: createZoneHandler(scanState, scanContext, {
            // C path parity: `DoZone` in `ref/micropolis/src/sim/s_zone.c`
            // dispatches `DoSPZone` (defined in `s_sim.c`), which calls
            // `PushPowerStack()` for coal/nuclear plants, feeding
            // `DoPowerScan` in `ref/micropolis/src/sim/s_power.c`.
            pushPowerStack: (system, x, y) => {
              pushPowerStack(system.state, x, y);
            },
          }),
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
 * Resolves the unpowered-zone blink phase from the host-side blink clock.
 * Mirrors `flagBlink = (now_time.tv_usec < 500000) ? 1 : -1` in
 * `ref/micropolis/src/sim/sim.c` and `flagBlink <= 0` gating in
 * `ref/micropolis/src/sim/g_bigmap.c`, expressed in millisecond phase space.
 */
function isEnvelopeHostUnpoweredZoneBlinkPhase(elapsedMs: number): boolean {
  const blinkPhaseMs =
    ((Math.trunc(elapsedMs) % MICROPOLIS_FLAG_BLINK_PERIOD_MS) + MICROPOLIS_FLAG_BLINK_PERIOD_MS) %
    MICROPOLIS_FLAG_BLINK_PERIOD_MS;
  return blinkPhaseMs >= MICROPOLIS_FLAG_BLINK_ONSET_MS;
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
 * Clamps one budget-percent candidate to C slider domain `0..100`.
 * Mirrors `SimCmdRoadFund`/`SimCmdFireFund`/`SimCmdPoliceFund` validation in
 * `ref/micropolis/src/sim/w_sim.c`.
 */
function normalizeBudgetPercent(candidate: number): number {
  const percent = Math.trunc(candidate);
  if (percent < 0) {
    return 0;
  }
  if (percent > 100) {
    return 100;
  }
  return percent;
}

/**
 * Clamps one city-tax candidate to C slider domain `0..20`.
 * Mirrors `SimCmdTaxRate` validation in `ref/micropolis/src/sim/w_sim.c`.
 */
function normalizeBudgetTaxRate(candidate: number): number {
  const taxRate = Math.trunc(candidate);
  if (taxRate < 0) {
    return 0;
  }
  if (taxRate > 20) {
    return 20;
  }
  return taxRate;
}

/**
 * Builds one host HUD budget payload from authoritative sim state.
 * Mirrors scalar budget values consumed by `UISetBudget` and `UISetBudgetValues`
 * in `ref/micropolis/src/sim/w_budget.c`.
 */
function buildHostHudBudgetPayload(
  simState: SimCoreRuntimeState['simState'],
): HostHudBudgetPayload {
  const roadPercent = normalizeBudgetPercent(Math.trunc(simState.roadPercent * 100));
  const firePercent = normalizeBudgetPercent(Math.trunc(simState.firePercent * 100));
  const policePercent = normalizeBudgetPercent(Math.trunc(simState.policePercent * 100));
  const roadWant = Math.max(0, Math.trunc(simState.RoadFund));
  const fireWant = Math.max(0, Math.trunc(simState.FireFund));
  const policeWant = Math.max(0, Math.trunc(simState.PoliceFund));
  const roadGot = Math.max(0, Math.trunc((roadWant * roadPercent) / 100));
  const fireGot = Math.max(0, Math.trunc((fireWant * firePercent) / 100));
  const policeGot = Math.max(0, Math.trunc((policeWant * policePercent) / 100));
  const taxFund = Math.max(0, Math.trunc(simState.TaxFund));
  const totalFunds = Math.max(0, Math.trunc(simState.TotalFunds));
  // `ReallyDrawBudgetWindow` in `w_budget.c` uses computed "got" values for flow.
  const cashFlow = taxFund - roadGot - fireGot - policeGot;

  return {
    taxRate: normalizeBudgetTaxRate(simState.CityTax),
    autoBudget: simState.autoBudget,
    taxFund,
    totalFunds,
    cashFlow,
    roadPercent,
    firePercent,
    policePercent,
    roadWant,
    fireWant,
    policeWant,
    roadGot,
    fireGot,
    policeGot,
  };
}

/**
 * Compares two HUD budget payload objects for transport delta gating.
 * Mirrors deterministic scalar-head comparison intent from `DoUpdateHeads`
 * style update coalescing in `ref/micropolis/src/sim/w_update.c`.
 */
function areHostHudBudgetPayloadsEqual(
  left: HostHudBudgetPayload,
  right: HostHudBudgetPayload,
): boolean {
  return (
    left.taxRate === right.taxRate &&
    left.autoBudget === right.autoBudget &&
    left.taxFund === right.taxFund &&
    left.totalFunds === right.totalFunds &&
    left.cashFlow === right.cashFlow &&
    left.roadPercent === right.roadPercent &&
    left.firePercent === right.firePercent &&
    left.policePercent === right.policePercent &&
    left.roadWant === right.roadWant &&
    left.fireWant === right.fireWant &&
    left.policeWant === right.policeWant &&
    left.roadGot === right.roadGot &&
    left.fireGot === right.fireGot &&
    left.policeGot === right.policeGot
  );
}

const EVALUATION_CITY_CLASS_LABELS = [
  'VILLAGE',
  'TOWN',
  'CITY',
  'CAPITAL',
  'METROPOLIS',
  'MEGALOPOLIS',
] as const;
const EVALUATION_CITY_LEVEL_LABELS = ['Easy', 'Medium', 'Hard'] as const;
const EVALUATION_PROBLEM_LABELS = [
  'CRIME',
  'POLLUTION',
  'HOUSING COSTS',
  'TAXES',
  'TRAFFIC',
  'UNEMPLOYMENT',
  'FIRES',
] as const;

/**
 * Builds one host HUD evaluation payload from authoritative sim state.
 * Mirrors `SetEvaluation` argument projection in `ref/micropolis/src/sim/w_eval.c`
 * and `UISetEvaluation` consumption in `ref/micropolis/res/micropolis.tcl`.
 */
function buildHostHudEvaluationPayload(
  simState: SimCoreRuntimeState['simState'],
): HostHudEvaluationPayload {
  const titleYear = Math.trunc(simState.CityTime / 48) + Math.trunc(simState.StartingYear);
  const cityClassIndex = clampInteger(
    simState.CityClass,
    0,
    EVALUATION_CITY_CLASS_LABELS.length - 1,
  );
  const cityLevelIndex = clampInteger(
    simState.GameLevel,
    0,
    EVALUATION_CITY_LEVEL_LABELS.length - 1,
  );

  return {
    title: `City Evaluation  ${titleYear}`,
    score: Math.trunc(simState.CityScore).toString(),
    scoreDelta: Math.trunc(simState.deltaCityScore).toString(),
    population: Math.max(0, Math.trunc(simState.CityPop)).toString(),
    populationDelta: Math.trunc(simState.deltaCityPop).toString(),
    assessedValue: formatDollarDecimalLikeC(Math.max(0, Math.trunc(simState.CityAssValue))),
    cityClass: EVALUATION_CITY_CLASS_LABELS[cityClassIndex] ?? EVALUATION_CITY_CLASS_LABELS[0],
    cityLevel: EVALUATION_CITY_LEVEL_LABELS[cityLevelIndex] ?? EVALUATION_CITY_LEVEL_LABELS[0],
    yesPercent: `${clampInteger(simState.CityYes, 0, 100)}%`,
    noPercent: `${clampInteger(simState.CityNo, 0, 100)}%`,
    problems: [
      buildHostHudEvaluationProblemSlot(simState, 0),
      buildHostHudEvaluationProblemSlot(simState, 1),
      buildHostHudEvaluationProblemSlot(simState, 2),
      buildHostHudEvaluationProblemSlot(simState, 3),
    ],
  };
}

/**
 * Projects one ranked evaluation problem row.
 * Mirrors problem name/percent row selection in `doScoreCard` from
 * `ref/micropolis/src/sim/w_eval.c`.
 */
function buildHostHudEvaluationProblemSlot(
  simState: SimCoreRuntimeState['simState'],
  rank: number,
): HostHudEvaluationPayload['problems'][number] {
  const problemOrder = simState.ProblemOrder[rank];
  const problemIndex =
    typeof problemOrder === 'number' && Number.isFinite(problemOrder)
      ? Math.trunc(problemOrder)
      : -1;
  const votesRaw = problemIndex >= 0 ? simState.ProblemVotes[problemIndex] : undefined;
  const votes =
    typeof votesRaw === 'number' && Number.isFinite(votesRaw) ? Math.trunc(votesRaw) : 0;
  if (votes <= 0) {
    return { name: ' ', percent: ' ' };
  }
  const label = EVALUATION_PROBLEM_LABELS[problemIndex] ?? ' ';
  if (label === ' ') {
    return { name: ' ', percent: ' ' };
  }
  return {
    name: label,
    percent: `${votes}%`,
  };
}

/**
 * Compares two HUD evaluation payload objects for transport delta gating.
 * Mirrors `scoreDoer`/`UISetEvaluation` update coalescing intent in
 * `ref/micropolis/src/sim/w_eval.c` and `ref/micropolis/res/micropolis.tcl`.
 */
function areHostHudEvaluationPayloadsEqual(
  left: HostHudEvaluationPayload,
  right: HostHudEvaluationPayload,
): boolean {
  return (
    left.title === right.title &&
    left.score === right.score &&
    left.scoreDelta === right.scoreDelta &&
    left.population === right.population &&
    left.populationDelta === right.populationDelta &&
    left.assessedValue === right.assessedValue &&
    left.cityClass === right.cityClass &&
    left.cityLevel === right.cityLevel &&
    left.yesPercent === right.yesPercent &&
    left.noPercent === right.noPercent &&
    left.problems[0].name === right.problems[0].name &&
    left.problems[0].percent === right.problems[0].percent &&
    left.problems[1].name === right.problems[1].name &&
    left.problems[1].percent === right.problems[1].percent &&
    left.problems[2].name === right.problems[2].name &&
    left.problems[2].percent === right.problems[2].percent &&
    left.problems[3].name === right.problems[3].name &&
    left.problems[3].percent === right.problems[3].percent
  );
}

/**
 * Formats one positive dollar amount using C-style grouped separators.
 * Mirrors `makeDollarDecimalStr` output intent in `ref/micropolis/src/sim/w_util.c`.
 */
function formatDollarDecimalLikeC(value: number): string {
  const raw = Math.max(0, Math.trunc(value)).toString();
  if (raw.length <= 3) {
    return `$${raw}`;
  }

  let left = raw.length % 3;
  if (left === 0) {
    left = 3;
  }
  let output = `$${raw.slice(0, left)}`;
  for (let index = left; index < raw.length; index += 3) {
    output += `,${raw.slice(index, index + 3)}`;
  }
  return output;
}

/**
 * Clamps one numeric candidate to an integer inclusive range.
 * Mirrors pervasive int-domain clamp behavior in `ref/micropolis/src/sim/w_sim.c`.
 */
function clampInteger(candidate: number, min: number, max: number): number {
  const integer = Math.trunc(Number.isFinite(candidate) ? candidate : min);
  if (integer < min) {
    return min;
  }
  if (integer > max) {
    return max;
  }
  return integer;
}

/**
 * Clamps snapshot replay cursor requests to the known sequenced envelope range.
 * Mirrors bridge snapshot cursor recovery rules from
 * `ref/micropolis/spec/integration/SPEC.md`.
 */
function normalizeReplayCursor(
  candidate: number,
  highestKnown: number,
  lowestRetained: number,
): number {
  const lowerBound = Math.max(0, Math.min(Math.trunc(lowestRetained), highestKnown));
  if (!Number.isFinite(candidate)) {
    return lowerBound;
  }

  const truncatedCandidate = Math.trunc(candidate);
  if (truncatedCandidate < lowerBound) {
    return lowerBound;
  }
  if (truncatedCandidate > highestKnown) {
    return highestKnown;
  }

  return truncatedCandidate;
}

/**
 * Resolves message text for one message id.
 * Mirrors `GetIndString(..., 301, ...)` lookup intent from
 * `ref/micropolis/src/sim/s_msg.c`, using the bundled TypeScript copy of
 * `stri.301` from `packages/sim-assets/src/message-table.ts`.
 * Parity note: unknown ids still fall back to `Message <id>`.
 */
function messageTextForId(id: number): string {
  const mirroredSignText = lookupDoMessageText(id);
  if (mirroredSignText !== undefined) {
    return mirroredSignText;
  }

  return `Message ${id}`;
}

/**
 * Returns whether one message id should project into the status-line feed.
 * Mirrors `doMessage` text-path behavior in `ref/micropolis/src/sim/s_msg.c`
 * where only ids backed by `GetIndString(...,301,...)` become status text.
 * Parity note: picture-only notice ids (for example 100/200) stay in notice
 * payloads and are intentionally omitted from message-feed entries.
 */
function shouldProjectHudMessageToFeed(id: number): boolean {
  return lookupDoMessageText(id) !== undefined;
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
 * Stamps one notice payload with replay-stable tick/server-seq metadata.
 * Mirrors notice ordering intent from `UIShowPicture` in
 * `ref/micropolis/res/micropolis.tcl` plus bridge replay ordering in
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: C notice payloads do not carry this metadata; this host adds
 * deterministic transport fields for replay-stable snapshots.
 */
function normalizeNoticeReplayMetadata(
  notice: HostHudNoticePayload | null | undefined,
  fallbackTick: number,
  fallbackServerSeq: number,
): HostHudNoticePayload | null | undefined {
  if (notice === undefined || notice === null) {
    return notice;
  }

  return {
    ...notice,
    tick: notice.tick ?? fallbackTick,
    serverSeq: notice.serverSeq ?? fallbackServerSeq,
  };
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
 * Clones one notice payload before envelope emission/replay storage.
 * Mirrors value-copy transport boundaries around `UIShowPicture` payload
 * projection in `ref/micropolis/res/micropolis.tcl`.
 */
function cloneHostHudNoticePayload(
  notice: HostHudNoticePayload | null,
): HostHudNoticePayload | null {
  if (notice === null) {
    return null;
  }
  return { ...notice };
}

/**
 * Clones one evaluation payload before envelope emission/replay storage.
 * Mirrors value-copy transport boundaries around `UISetEvaluation` payload
 * projection in `ref/micropolis/res/micropolis.tcl`.
 */
function cloneHostHudEvaluationPayload(
  evaluation: HostHudEvaluationPayload,
): HostHudEvaluationPayload {
  return {
    ...evaluation,
    problems: [
      { ...evaluation.problems[0] },
      { ...evaluation.problems[1] },
      { ...evaluation.problems[2] },
      { ...evaluation.problems[3] },
    ],
  };
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

interface CanonicalCityStats {
  cityPopulation: number;
  cityClass: number;
}

/**
 * Builds one HUD graph payload from authoritative sim census histories.
 * Mirrors `doAllGraphs` output ownership in `ref/micropolis/src/sim/w_graph.c`,
 * via sim-core `buildCensusGraphData` parity helper.
 */
function buildHostHudGraphPayload(simState: SimCoreRuntimeState['simState']): HostHudGraphPayload {
  const graphData = buildCensusGraphData(simState);
  return {
    history10: {
      res: new Uint8Array(graphData.history10.res),
      com: new Uint8Array(graphData.history10.com),
      ind: new Uint8Array(graphData.history10.ind),
      money: new Uint8Array(graphData.history10.money),
      crime: new Uint8Array(graphData.history10.crime),
      pollution: new Uint8Array(graphData.history10.pollution),
    },
    history120: {
      res: new Uint8Array(graphData.history120.res),
      com: new Uint8Array(graphData.history120.com),
      ind: new Uint8Array(graphData.history120.ind),
      money: new Uint8Array(graphData.history120.money),
      crime: new Uint8Array(graphData.history120.crime),
      pollution: new Uint8Array(graphData.history120.pollution),
    },
  };
}

/**
 * Reads and clamps authoritative city-population/class HUD heads from sim state.
 * Mirrors `CityPop`/`CityClass` ownership in `ref/micropolis/src/sim/s_eval.c`
 * and class label indexing in `ref/micropolis/src/sim/w_eval.c`.
 * Parity note: bridge payloads clamp to valid numeric transport bounds.
 */
function readCanonicalCityStatsFromSimState(
  simState: SimCoreRuntimeState['simState'],
): CanonicalCityStats {
  const rawPopulation = Number.isFinite(simState.CityPop) ? Math.trunc(simState.CityPop) : 0;
  const rawClass = Number.isFinite(simState.CityClass) ? Math.trunc(simState.CityClass) : 0;
  return {
    cityPopulation: Math.max(0, Math.min(rawPopulation, 2_000_000_000)),
    cityClass: Math.max(0, Math.min(rawClass, 5)),
  };
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
