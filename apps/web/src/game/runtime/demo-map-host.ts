import type { readFile as nodeReadFile } from 'node:fs/promises';

import { getCoreBridgeV1SnapshotTileIndex } from '../../../../../packages/core-bridge/src/types.ts';
import {
  createRealtimeContext,
  destroyAllSprites as destroyRealtimeSprites,
  generateCopter as generateRealtimeCopter,
  generatePlane as generateRealtimePlane,
  generateShip as generateRealtimeShip,
  generateTrain as generateRealtimeTrain,
  getSprite as getRealtimeSprite,
  makeExplosion as makeRealtimeExplosion,
  makeExplosionAt as makeRealtimeExplosionAt,
  makeMonster as makeRealtimeMonster,
  makeTornado as makeRealtimeTornado,
  type RealtimeContext,
  resetForNewCityFromSeed,
  runRealtimeTick,
  runUiUpdate,
  sendMessages,
  setValves,
  type SimContext,
  type SimSprite,
  type SimState,
} from '../../../../../packages/sim-core/src/index.ts';
import { setFunds } from '../../../../../packages/sim-core/src/systems/funds.ts';
import { loadCityLikeC, loadScenarioLikeC } from '../../../../../packages/sim-io/src/load.ts';
import { saveCityAsLikeC } from '../../../../../packages/sim-io/src/save.ts';
import {
  getScenarioDefinition,
  SCENARIO_TABLE,
  type ScenarioDefinition,
} from '../../../../../packages/sim-io/src/scenarios.ts';
import { Stage4SimCoreAuthorityState } from '../stage4-sim-core-authority-state.ts';
import {
  type ClientEnvelope,
  type CoreHost,
  type CoreHostConnection,
  getPlayableToolSpec,
  type HostEnvelope,
  type HostHudMessagePayload,
  type HostHudOptionsPayload,
  type HostPatchPayload,
  type HostRealtimeObjectDeltaPayload,
  type HostRealtimeObjectPayload,
  isStage2CityIoCommand,
  isStage2CityLifecycleCommand,
  isStage2ScenarioCommand,
  isStage2SimControlCommand,
  isStage2ToolCommand,
  type Stage2CityIoCommand,
  type Stage2LoadCityCommand,
  type Stage2LoadScenarioCommand,
  type Stage2SaveCityCommand,
  type Stage2SimControlCommand,
  type Stage2ToolCommand,
  type Stage2ToolName,
} from './protocol.ts';

const DEMO_WORLD_WIDTH = 120;
const DEMO_WORLD_HEIGHT = 100;
const DEMO_PATCH_INTERVAL_MS = 180;
const DEMO_INITIAL_FUNDS = 20_000;
const DEMO_MESSAGE_LOG_LIMIT = 24;
const DEMO_DEFAULT_CITY_FILE_NAME = 'newcity.cty';
const DEMO_DEFAULT_CITY_NAME = 'New City';
const DEMO_DEFAULT_AUTO_BUDGET = true;
const DEMO_DEFAULT_AUTO_GO = true;
const DEMO_DEFAULT_AUTO_BULLDOZE = true;
const DEMO_DEFAULT_USER_SOUND_ON = true;
const DEMO_DEFAULT_DO_ANIMATION = true;
const DEMO_DEFAULT_DO_MESSAGES = true;
const DEMO_DEFAULT_DO_NOTICES = true;
const DEMO_DEFAULT_DISASTERS = true;
const DEMO_NEW_CITY_TREE_LEVEL = -1;
const DEMO_NEW_CITY_LAKE_LEVEL = -1;
const DEMO_NEW_CITY_CURVE_LEVEL = -1;
const DEMO_NEW_CITY_CREATE_ISLAND = -1;
const DEMO_SCENARIO_RESOURCE_URLS = createScenarioResourceUrlTable();
type NodeFsPromisesModule = {
  readFile: typeof nodeReadFile;
};

const TOOL_TILE_VALUES: Record<Stage2ToolName, number> = {
  road: 66,
  rail: 226,
  wire: 210,
  bulldoze: 0,
  res: 240,
  com: 423,
  ind: 612,
};

const TOOL_COSTS: Record<Stage2ToolName, number> = {
  // Mirrors `CostOf[]` values for road/rail/wire/bulldoze/R/C/I in
  // `ref/micropolis/src/sim/w_tool.c`.
  road: 10,
  rail: 20,
  wire: 5,
  bulldoze: 1,
  res: 100,
  com: 100,
  ind: 100,
};

const ZONE_TOOLS = new Set<Stage2ToolName>(['res', 'com', 'ind']);

const STAGE2_MESSAGE_TEXT: Record<number, string> = {
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
  [-10]: 'Pollution has reached dangerous levels.',
  [-11]: 'Crime is out of control.',
  [-12]: 'Traffic is congested.',
};

/**
 * Scenario choice metadata shown in the Stage 2 browser selector.
 * Mirrors scenario rows from `LoadScenario` in `ref/micropolis/src/sim/s_fileio.c`.
 */
export interface Stage2ScenarioChoice {
  id: number;
  name: string;
  fileName: string;
  startYear: number;
}

/**
 * Stage 2 browser scenario option table.
 * Mirrors `LoadScenario` switch-table labels/file ids from
 * `ref/micropolis/src/sim/s_fileio.c` (1:1 metadata). Runtime scenario starts
 * load canonical `snro.*` payloads from `ref/micropolis/res`.
 */
export const STAGE2_SCENARIO_CHOICES: readonly Stage2ScenarioChoice[] = SCENARIO_TABLE.map(
  (scenario: ScenarioDefinition) => ({
    id: scenario.id,
    name: scenario.name,
    fileName: scenario.fileName,
    startYear: scenario.startYear,
  }),
);

type DemoHudMessagePayload = HostHudMessagePayload;

/**
 * Export/save payload emitted by the demo host after `save-city`.
 * Mirrors `SaveCityAs` output ownership in `ref/micropolis/src/sim/s_fileio.c`.
 * Difference: browser flow carries bytes in-envelope for download instead of
 * writing directly to the local filesystem.
 */
export interface DemoCityExportPayload {
  fileName: string;
  cityName: string;
  cityBytes: Uint8Array;
}

interface DemoPatchPayload extends HostPatchPayload {
  cityIo?: {
    save?: DemoCityExportPayload;
  };
}

interface HostRealtimeObjectWithIdPayload extends HostRealtimeObjectPayload {
  id: string;
}

interface HookDrivenHudState {
  fundsLabel: string;
  dateLabel: string;
  dateMonth: number;
  dateYear: number;
  demandR: number;
  demandC: number;
  demandI: number;
  options: HostHudOptionsPayload;
}

/**
 * Parses a host patch payload for browser save/export bytes.
 * Mirrors `SaveCityAs` data flow in `ref/micropolis/src/sim/s_fileio.c`.
 */
export function readDemoCityExportPayload(payload: unknown): DemoCityExportPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  const cityIo = payload.cityIo;
  if (!isRecord(cityIo)) {
    return null;
  }

  const save = cityIo.save;
  if (!isRecord(save)) {
    return null;
  }

  if (
    typeof save.fileName !== 'string' ||
    typeof save.cityName !== 'string' ||
    !(save.cityBytes instanceof Uint8Array)
  ) {
    return null;
  }

  return {
    fileName: save.fileName,
    cityName: save.cityName,
    cityBytes: save.cityBytes,
  };
}

/**
 * Runtime configuration for the scripted Stage 2 local host.
 * Mirrors timer cadence control intent from `ref/micropolis/src/sim/w_util.c`.
 */
export interface DemoMapHostOptions {
  enableAmbientTicks?: boolean;
  patchIntervalMs?: number;
  /**
   * Seed one realtime copter sprite when no active sprites exist during ambient
   * simulation ticks.
   * Mirrors `GenerateCopter` sprite behavior from `ref/micropolis/src/sim/w_sprite.c`.
   * Difference: C only spawns copters from simulation triggers; this host-level
   * seam ensures Stage 7 manual overlay movement is always observable in browser runs.
   */
  seedRealtimeDemoObject?: boolean;
  /**
   * Optional scenario byte loader for `snro.*` resources.
   * Mirrors `_load_file(fname, ResourceDir)` in `LoadScenario` from
   * `ref/micropolis/src/sim/s_fileio.c`.
   * Parity note: function injection is a TypeScript test seam.
   */
  scenarioResourceLoader?: (fileName: string) => Uint8Array | Promise<Uint8Array>;
}

/**
 * Deterministic local map host used for Stage 2 browser play.
 * Mirrors authoritative command + update intent from
 * `ref/micropolis/src/sim/w_tool.c`, `ref/micropolis/src/sim/w_update.c`,
 * `ref/micropolis/src/sim/w_util.c`, `ref/micropolis/src/sim/s_msg.c`, and
 * `ref/micropolis/src/sim/s_fileio.c`.
 * Difference: map mutation remains deterministic/demo-scripted, but HUD/message/speed
 * projection is sourced from real sim-core hook outputs (`uiSet`, `sendMes`,
 * `sendMesAt`, `tickCount`).
 */
export class DemoMapHost implements CoreHost {
  private readonly enableAmbientTicks: boolean;
  private readonly patchIntervalMs: number;
  private readonly seedRealtimeDemoObject: boolean;
  private readonly simState: SimState;
  private readonly simContext: SimContext;
  private readonly realtimeContext: RealtimeContext;
  private onEnvelope: ((envelope: HostEnvelope) => void) | undefined;
  private intervalHandle: ReturnType<typeof setInterval> | undefined;
  private activeRoomId: string | undefined;
  private activeClientId: string | undefined;
  private serverSeq = 0;
  private tick = 0;
  private readonly messageClockStartMs = Date.now();
  private lastMessageTickCount = 0;
  private simPaused = false;
  private simPausedSpeed = 3;
  private cityFileName: string | null = DEMO_DEFAULT_CITY_FILE_NAME;
  private cityName = DEMO_DEFAULT_CITY_NAME;
  private currentScenarioId = 0;
  private readonly hookHudState: HookDrivenHudState = createInitialHookDrivenHudState();
  private pendingHookMessages: DemoHudMessagePayload[] = [];
  private readonly realtimeObjectIds = new WeakMap<SimSprite, string>();
  private nextRealtimeObjectId = 1;
  private lastRealtimeObjectsById = new Map<string, HostRealtimeObjectWithIdPayload>();
  private readonly mapTiles = buildInitialDemoMapTiles(DEMO_WORLD_WIDTH, DEMO_WORLD_HEIGHT);
  private readonly scenarioResourceBytesCache = new Map<string, Promise<Uint8Array>>();
  private readonly scenarioResourceLoader: (fileName: string) => Promise<Uint8Array>;
  private readonly messageLog: DemoHudMessagePayload[] = [
    {
      id: 0,
      text: 'City initialized.',
    },
  ];
  private readonly commandOutcomes = new Map<
    string,
    { kind: 'ack' } | { kind: 'reject'; reason: string }
  >();

  constructor(options: DemoMapHostOptions = {}) {
    this.enableAmbientTicks = options.enableAmbientTicks ?? true;
    this.patchIntervalMs = options.patchIntervalMs ?? DEMO_PATCH_INTERVAL_MS;
    this.seedRealtimeDemoObject = options.seedRealtimeDemoObject ?? true;
    const scenarioResourceLoader = options.scenarioResourceLoader;
    this.scenarioResourceLoader =
      scenarioResourceLoader === undefined
        ? (fileName) => this.loadScenarioResourceBytes(fileName)
        : (fileName) => Promise.resolve(scenarioResourceLoader(fileName));
    const authorityState = new Stage4SimCoreAuthorityState({
      hooks: {
        tickCount: () => this.readMessageTickCount(),
        uiSet: (key, value) => this.captureUiSet(key, value),
        sendMes: (id) => this.captureMessage(id),
        sendMesAt: (id, x, y) => this.captureMessageAt(id, x, y),
      },
    });
    this.simState = authorityState.simState;
    this.simContext = authorityState.simContext;
    this.realtimeContext = createRealtimeContext({
      store: this.simContext.store,
      rng: this.simContext.rng,
      toolContext: authorityState.toolContext,
      simSpeed: this.simState.SimSpeed,
      doAnimation: this.simState.doAnimation,
      noDisasters: this.simState.NoDisasters,
      scenarioId: this.simState.ScenarioID,
      totalPop: this.simState.TotalPop,
      polMaxX: this.simState.PolMaxX,
      polMaxY: this.simState.PolMaxY,
      messageCoupling: {
        state: this.simState,
        context: this.simContext,
      },
    });
    this.installRealtimeHooks();
    this.simPausedSpeed = normalizePlayableSpeed(this.simState.SimMetaSpeed);
    this.refreshHookDrivenHud();
    this.pendingHookMessages = [];
  }

  public connect(onEnvelope: (envelope: HostEnvelope) => void): CoreHostConnection {
    this.onEnvelope = onEnvelope;

    return {
      send: (envelope) => {
        this.handleClientEnvelope(envelope);
      },
      disconnect: () => {
        this.stopInterval();
        this.activeRoomId = undefined;
        this.activeClientId = undefined;
        this.onEnvelope = undefined;
      },
    };
  }

  /**
   * Routes client envelopes into deterministic host-side command handlers.
   * Mirrors command routing and request-snapshot flow in
   * `ref/micropolis/src/sim/w_sim.c`, adapted to typed bridge envelopes.
   */
  private handleClientEnvelope(envelope: ClientEnvelope): void {
    if (this.onEnvelope === undefined) {
      return;
    }

    if (envelope.kind === 'hello') {
      this.activeRoomId = envelope.roomId;
      this.activeClientId = envelope.clientId;
      this.onEnvelope({
        kind: 'hello',
        roomId: envelope.roomId,
        clientId: envelope.clientId,
        protocolVersion: envelope.protocolVersion,
        coreVersion: envelope.coreVersion,
        accepted: true,
      });

      this.emitSnapshot(envelope.roomId, envelope.clientId);
      this.refreshAmbientInterval();
      return;
    }

    if (envelope.kind === 'request_snapshot') {
      this.emitSnapshot(envelope.roomId, envelope.clientId);
      return;
    }

    if (envelope.kind === 'command') {
      this.handleCommandEnvelope(envelope);
    }
  }

  /**
   * Applies one command envelope and emits `ack`/`reject` plus resulting patch/snapshot.
   * Mirrors command lifecycle handling in `ref/micropolis/src/sim/w_sim.c`.
   */
  private handleCommandEnvelope(envelope: Extract<ClientEnvelope, { kind: 'command' }>): void {
    this.tick += 1;

    const settled = this.commandOutcomes.get(envelope.commandId);
    if (settled !== undefined) {
      if (settled.kind === 'ack') {
        this.emitAck(envelope.roomId, envelope.clientId, envelope.commandId);
      } else {
        this.emitReject(envelope.roomId, envelope.clientId, envelope.commandId, settled.reason);
      }
      return;
    }

    if (isStage2ToolCommand(envelope.command)) {
      this.handleToolCommand(envelope, envelope.command);
      return;
    }

    if (isStage2SimControlCommand(envelope.command)) {
      this.handleSimControlCommand(envelope, envelope.command);
      return;
    }

    if (this.routeLifecycleIoCommand(envelope)) {
      return;
    }

    const reason = 'invalid-command';
    this.commandOutcomes.set(envelope.commandId, { kind: 'reject', reason });
    this.emitReject(envelope.roomId, envelope.clientId, envelope.commandId, reason);
  }

  /**
   * Routes lifecycle + IO command classes through one command surface.
   * Mirrors `SimCmd` command-table dispatch in `ref/micropolis/src/sim/w_sim.c`
   * for `GenerateNewCity`, `LoadCity`, `SaveCity`/`SaveCityAs`, and `LoadScenario`.
   * Parity note: command keys are Stage 2 discriminated unions rather than Tcl strings.
   */
  private routeLifecycleIoCommand(envelope: Extract<ClientEnvelope, { kind: 'command' }>): boolean {
    if (isStage2CityLifecycleCommand(envelope.command)) {
      this.handleCityLifecycleCommand(envelope.roomId, envelope.clientId, envelope.commandId);
      return true;
    }

    if (isStage2CityIoCommand(envelope.command)) {
      this.handleCityIoCommand(
        envelope.roomId,
        envelope.clientId,
        envelope.commandId,
        envelope.command,
      );
      return true;
    }

    if (isStage2ScenarioCommand(envelope.command)) {
      this.handleScenarioCommand(
        envelope.roomId,
        envelope.clientId,
        envelope.commandId,
        envelope.command,
      );
      return true;
    }

    return false;
  }

  /**
   * Applies a Stage 2 tool command and emits map/HUD patch deltas.
   * Mirrors tool placement + spending intent from `do_tool`/`Spend` in
   * `ref/micropolis/src/sim/w_tool.c`.
   * Difference: tile values are synthetic debug IDs in this local host.
   */
  private handleToolCommand(
    envelope: Extract<ClientEnvelope, { kind: 'command' }>,
    command: Stage2ToolCommand,
  ): void {
    const placement = applyDemoToolCommand(
      this.mapTiles,
      DEMO_WORLD_WIDTH,
      DEMO_WORLD_HEIGHT,
      command,
    );

    if (!placement.accepted) {
      const reason = placement.reason;
      this.commandOutcomes.set(envelope.commandId, { kind: 'reject', reason });
      this.emitReject(envelope.roomId, envelope.clientId, envelope.commandId, reason);
      return;
    }

    const toolCost = TOOL_COSTS[command.tool];
    const nextFunds = this.simState.TotalFunds - toolCost;
    if (nextFunds < 0) {
      const reason = 'insufficient-funds';
      this.commandOutcomes.set(envelope.commandId, { kind: 'reject', reason });
      this.emitReject(envelope.roomId, envelope.clientId, envelope.commandId, reason);
      return;
    }

    setFunds(this.simState, nextFunds);
    this.refreshHookDrivenHud();
    this.commandOutcomes.set(envelope.commandId, { kind: 'ack' });
    this.emitAck(envelope.roomId, envelope.clientId, envelope.commandId);
    this.emitPatch(
      envelope.roomId,
      envelope.clientId,
      this.buildHookDrivenPatchPayload({
        includeHud: true,
        mapTileWordDeltas: placement.deltas,
      }),
    );
  }

  /**
   * Applies pause/play/set-speed commands through host authority.
   * Mirrors `Pause`, `Resume`, and `setSpeed` in `ref/micropolis/src/sim/w_util.c`
   * and `SimCmdSpeed` command entry in `ref/micropolis/src/sim/w_sim.c`.
   */
  private handleSimControlCommand(
    envelope: Extract<ClientEnvelope, { kind: 'command' }>,
    command: Stage2SimControlCommand,
  ): void {
    const didEmitSpeedUpdate = this.applySimControl(command);
    this.refreshAmbientInterval();

    this.commandOutcomes.set(envelope.commandId, { kind: 'ack' });
    this.emitAck(envelope.roomId, envelope.clientId, envelope.commandId);
    const payload = this.buildHookDrivenPatchPayload({
      includeHud: didEmitSpeedUpdate,
    });
    if (payload.hud === undefined && payload.messageDeltas === undefined) {
      return;
    }

    this.emitPatch(envelope.roomId, envelope.clientId, payload);
  }

  /**
   * Applies new-city lifecycle reset through host authority.
   * Mirrors `DoNewCity` startup/reset intent in `ref/micropolis/src/sim/s_init.c`.
   */
  private handleCityLifecycleCommand(roomId: string, clientId: string, commandId: string): void {
    this.resetToNewCity();
    this.commandOutcomes.set(commandId, { kind: 'ack' });
    this.emitAck(roomId, clientId, commandId);
    this.emitSnapshot(roomId, clientId);
  }

  /**
   * Applies save/load city flows through host authority.
   * Mirrors `SaveCityAs` / `LoadCity` in `ref/micropolis/src/sim/s_fileio.c`.
   */
  private handleCityIoCommand(
    roomId: string,
    clientId: string,
    commandId: string,
    command: Stage2CityIoCommand,
  ): void {
    if (command.action === 'save-city') {
      this.handleSaveCityCommand(roomId, clientId, commandId, command);
      return;
    }

    this.handleLoadCityCommand(roomId, clientId, commandId, command);
  }

  private handleSaveCityCommand(
    roomId: string,
    clientId: string,
    commandId: string,
    command: Stage2SaveCityCommand,
  ): void {
    const fileName = sanitizeCityFileName(command.fileName);
    this.syncRuntimeTilesToClassicMapLayerForSave();
    const saveResult = saveCityAsLikeC(this.simState, this.simContext, fileName);
    this.cityFileName = saveResult.cityFileName;
    this.cityName = saveResult.cityName;

    this.commandOutcomes.set(commandId, { kind: 'ack' });
    this.emitAck(roomId, clientId, commandId);
    this.emitPatch(roomId, clientId, {
      cityIo: {
        save: {
          fileName: saveResult.cityFileName,
          cityName: this.cityName,
          cityBytes: saveResult.cityBytes,
        },
      },
      messageDeltas: [
        {
          id: 30,
          text: `Saved ${this.cityName}.`,
        },
      ],
    });
  }

  private handleLoadCityCommand(
    roomId: string,
    clientId: string,
    commandId: string,
    command: Stage2LoadCityCommand,
  ): void {
    const fileName = sanitizeCityFileName(command.fileName);

    let loadResult: ReturnType<typeof loadCityLikeC>;
    try {
      loadResult = loadCityLikeC(this.simState, this.simContext, fileName, command.cityBytes);
    } catch {
      const reason = 'invalid-city-file';
      this.commandOutcomes.set(commandId, { kind: 'reject', reason });
      this.emitReject(roomId, clientId, commandId, reason);
      return;
    }

    this.cityFileName = loadResult.cityFileName;
    this.cityName = loadResult.cityName;
    this.currentScenarioId = 0;

    this.syncRuntimeTilesFromClassicMapLayer();
    this.syncHostLoadStateFromSimState();

    this.resetMessageLog(`Loaded ${this.cityName}.`);

    this.commandOutcomes.set(commandId, { kind: 'ack' });
    this.emitAck(roomId, clientId, commandId);
    this.emitSnapshot(roomId, clientId);
  }

  /**
   * Applies scenario start through host authority.
   * Mirrors `LoadScenario` in `ref/micropolis/src/sim/s_fileio.c` by applying
   * scenario metadata constants and loading the corresponding `snro.*` bytes.
   * Parity note: async resource reads replace C's synchronous file API, but the
   * resulting state/order of `loadScenarioLikeC` effects remains aligned.
   */
  private handleScenarioCommand(
    roomId: string,
    clientId: string,
    commandId: string,
    command: Stage2LoadScenarioCommand,
  ): void {
    const scenario = getScenarioDefinition(command.scenarioId);
    const commandTick = this.tick;
    void this.handleScenarioCommandAsync(roomId, clientId, commandId, scenario.id, commandTick);
  }

  /**
   * Async `LoadScenario` orchestration with `snro.*` payload bytes.
   * Mirrors `LoadScenario` resource read + init ordering in
   * `ref/micropolis/src/sim/s_fileio.c`.
   * Parity note: `loadScenarioLikeC` owns the C-equivalent scalar/map lifecycle;
   * this host wrapper translates completion into bridge `ack`/`snapshot` envelopes.
   */
  private async handleScenarioCommandAsync(
    roomId: string,
    clientId: string,
    commandId: string,
    scenarioId: number,
    commandTick: number,
  ): Promise<void> {
    const scenario = getScenarioDefinition(scenarioId);

    let scenarioBytes: Uint8Array;
    try {
      scenarioBytes = await this.scenarioResourceLoader(scenario.fileName);
    } catch {
      const reason = 'invalid-scenario-file';
      this.commandOutcomes.set(commandId, { kind: 'reject', reason });
      this.emitReject(roomId, clientId, commandId, reason, commandTick);
      return;
    }

    let loadResult: ReturnType<typeof loadScenarioLikeC>;
    try {
      loadResult = loadScenarioLikeC(this.simState, this.simContext, scenario.id, scenarioBytes);
    } catch {
      const reason = 'invalid-scenario-file';
      this.commandOutcomes.set(commandId, { kind: 'reject', reason });
      this.emitReject(roomId, clientId, commandId, reason, commandTick);
      return;
    }

    this.currentScenarioId = loadResult.scenario.id;
    this.cityName = loadResult.scenario.name;
    this.cityFileName = `${loadResult.scenario.fileName}.cty`;
    this.syncRuntimeTilesFromClassicMapLayer();
    this.syncHostLoadStateFromSimState();
    this.resetMessageLog(
      `Scenario: ${loadResult.scenario.name} (${loadResult.scenario.startYear})`,
    );

    this.commandOutcomes.set(commandId, { kind: 'ack' });
    this.emitAck(roomId, clientId, commandId, commandTick);
    this.emitSnapshot(roomId, clientId, commandTick);
  }

  /**
   * Emits an authoritative snapshot baseline with map + HUD + message feed.
   * Mirrors full refresh intent in `ref/micropolis/src/sim/w_update.c`.
   */
  private emitSnapshot(roomId: string, clientId: string, tickOverride = this.tick): void {
    if (this.onEnvelope === undefined) {
      return;
    }

    this.syncRealtimeContextFromSimState();
    const snapshotServerSeq = this.serverSeq + 1;
    const snapshotTick = tickOverride;
    const pendingMessages = this.drainPendingHookMessages();
    if (pendingMessages.length > 0) {
      this.recordMessages(pendingMessages, snapshotTick, snapshotServerSeq);
    }
    const realtimePayload = this.buildRealtimeSnapshotPayload();
    this.ensureMessageLogReplayMetadata(snapshotTick, snapshotServerSeq);
    this.serverSeq = snapshotServerSeq;
    this.onEnvelope({
      kind: 'snapshot',
      roomId,
      clientId,
      tick: snapshotTick,
      serverSeq: snapshotServerSeq,
      payload: {
        map: {
          width: DEMO_WORLD_WIDTH,
          height: DEMO_WORLD_HEIGHT,
          tileWords: buildSnapshotTileWordsFromRuntimeMap(
            this.mapTiles,
            DEMO_WORLD_WIDTH,
            DEMO_WORLD_HEIGHT,
          ),
        },
        hud: {
          ...this.getHudHeadsPayload(),
        },
        realtime: realtimePayload,
        messages: this.messageLog,
      },
    });
  }

  /**
   * Emits a command `ack` envelope.
   * Mirrors successful command completion signaling in
   * `ref/micropolis/src/sim/w_sim.c`.
   */
  private emitAck(
    roomId: string,
    clientId: string,
    commandId: string,
    tickOverride = this.tick,
  ): void {
    if (this.onEnvelope === undefined) {
      return;
    }

    this.serverSeq += 1;
    this.onEnvelope({
      kind: 'ack',
      roomId,
      clientId,
      tick: tickOverride,
      serverSeq: this.serverSeq,
      commandId,
    });
  }

  /**
   * Emits a command `reject` envelope.
   * Mirrors expected-denial command results in `ref/micropolis/src/sim/w_sim.c`.
   */
  private emitReject(
    roomId: string,
    clientId: string,
    commandId: string,
    reason: string,
    tickOverride = this.tick,
  ): void {
    if (this.onEnvelope === undefined) {
      return;
    }

    this.serverSeq += 1;
    this.onEnvelope({
      kind: 'reject',
      roomId,
      clientId,
      tick: tickOverride,
      serverSeq: this.serverSeq,
      commandId,
      reason,
    });
  }

  /**
   * Emits one authoritative patch envelope for map/HUD/message deltas.
   * Mirrors incremental `UISet*` and map update propagation intent from
   * `ref/micropolis/src/sim/w_update.c` and `ref/micropolis/src/sim/s_msg.c`.
   */
  private emitPatch(roomId: string, clientId: string, payload: DemoPatchPayload): void {
    if (this.onEnvelope === undefined) {
      return;
    }

    const patchServerSeq = this.serverSeq + 1;
    if (payload.messageDeltas !== undefined) {
      this.recordMessages(payload.messageDeltas, this.tick, patchServerSeq);
    } else if (payload.messages !== undefined) {
      this.recordMessages(payload.messages, this.tick, patchServerSeq);
    }

    this.serverSeq = patchServerSeq;
    this.onEnvelope({
      kind: 'patch',
      roomId,
      clientId,
      tick: this.tick,
      serverSeq: patchServerSeq,
      payload,
    });
  }

  /**
   * Runs one ambient simulation slice and emits HUD/message deltas.
   * Mirrors speed-gated frame stepping in `ref/micropolis/src/sim/s_sim.c`
   * plus head updates in `ref/micropolis/src/sim/w_update.c`.
   * Parity note: unlike earlier Stage 2 scaffolding, this no longer emits
   * synthetic random map tile churn; map deltas are reserved for authoritative
   * map mutations (tools/new city/load/scenario), matching `DoUpdateMap`
   * invalidation ownership in `ref/micropolis/src/sim/w_map.c`.
   */
  private emitAmbientPatch(roomId: string, clientId: string): void {
    if (this.getVisibleSpeed() === 0) {
      return;
    }

    this.simState.Spdcycle = (this.simState.Spdcycle + 1) & 0xffff;
    if (this.simState.SimSpeed === 1 && this.simState.Spdcycle % 5 !== 0) {
      return;
    }
    if (this.simState.SimSpeed === 2 && this.simState.Spdcycle % 3 !== 0) {
      return;
    }

    this.simContext.store.beginTick();
    try {
      this.simState.CityTime += 1;
      setValves(this.simState, this.simContext);
      sendMessages(this.simState, this.simContext);
      this.ensureRealtimeDemoObject();
      this.advanceRealtimeStep();
      runUiUpdate(this.simState, this.simContext);
    } finally {
      this.simContext.store.commitTick();
    }

    this.tick += 1;
    this.emitPatch(
      roomId,
      clientId,
      this.buildHookDrivenPatchPayload({
        includeHud: true,
      }),
    );
  }

  /**
   * Hook clock used by sim-core message expiry checks.
   * Mirrors `TickCount()` from `ref/micropolis/src/sim/w_stubs.c` as consumed by
   * `doMessage()` in `ref/micropolis/src/sim/s_msg.c` (`> 60 * 30` timeout).
   *
   * Parity note: message timing is wall-clock based in C, not simulation-step based.
   * This keeps the hook monotonic even if wall-clock time moves backward.
   */
  private readMessageTickCount(): number {
    const elapsedMs = Date.now() - this.messageClockStartMs;
    const candidateTicks = elapsedMs > 0 ? Math.trunc((elapsedMs * 60) / 1000) : 0;
    if (candidateTicks <= this.lastMessageTickCount) {
      return this.lastMessageTickCount;
    }
    this.lastMessageTickCount = candidateTicks;
    return candidateTicks;
  }

  /**
   * Builds one patch payload from hook-driven HUD and message queues.
   * Mirrors `DoUpdateHeads` (`ref/micropolis/src/sim/w_update.c`) and `doMessage`
   * (`ref/micropolis/src/sim/s_msg.c`) dispatch ownership, adapted to Stage 2
   * bridge payload fields.
   * Difference: map deltas are passed in by host command handlers instead of
   * being emitted directly from C update globals.
   */
  private buildHookDrivenPatchPayload(options: {
    includeHud: boolean;
    mapTileWordDeltas?: ReadonlyArray<{
      x: number;
      y: number;
      tileWord: number;
    }>;
  }): DemoPatchPayload {
    const payload: DemoPatchPayload = {};

    this.syncRealtimeContextFromSimState();
    if (options.includeHud) {
      payload.hud = this.getHudHeadsPayload();
    }

    if (options.mapTileWordDeltas !== undefined && options.mapTileWordDeltas.length > 0) {
      payload.map = {
        tileWordDeltas: [...options.mapTileWordDeltas],
      };
    }

    const hookMessages = this.drainPendingHookMessages();
    if (hookMessages.length > 0) {
      payload.messageDeltas = hookMessages;
    }

    payload.realtime = this.buildRealtimeDeltaPayload();

    return payload;
  }

  /**
   * Installs sprite/realtime hooks onto sim-core context callbacks.
   * Mirrors `sim->hooks` ownership from `ref/micropolis/src/sim/sim.c`,
   * routing `MoveObjects` (`w_sprite.c`) and sprite factory calls through the
   * Stage 7 TypeScript realtime port in `packages/sim-core/src/sim/realtime.ts`.
   */
  private installRealtimeHooks(): void {
    this.simContext.hooks.destroyAllSprites = () => {
      destroyRealtimeSprites(this.realtimeContext);
    };
    this.simContext.hooks.generateTrain = (x, y) => {
      generateRealtimeTrain(this.realtimeContext, x, y);
    };
    this.simContext.hooks.generateShip = () => {
      generateRealtimeShip(this.realtimeContext);
    };
    // Hook parity note: current sim-core `generatePlane`/`generateCopter` hooks do
    // not carry tile coordinates (unlike C `GeneratePlane(x,y)`/`GenerateCopter(x,y)`),
    // so Stage 7 host integration uses world-center launch coordinates.
    this.simContext.hooks.generatePlane = () => {
      generateRealtimePlane(this.realtimeContext, DEMO_WORLD_WIDTH >> 1, DEMO_WORLD_HEIGHT >> 1);
    };
    this.simContext.hooks.generateCopter = () => {
      generateRealtimeCopter(this.realtimeContext, DEMO_WORLD_WIDTH >> 1, DEMO_WORLD_HEIGHT >> 1);
    };
    this.simContext.hooks.getSprite = (type) => {
      if (type < 1 || type > 8) {
        return null;
      }
      return getRealtimeSprite(this.realtimeContext, type as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8);
    };
    this.simContext.hooks.moveObjects = () => {
      this.advanceRealtimeStep();
    };
    this.simContext.hooks.makeExplosion = (x, y) => {
      makeRealtimeExplosion(this.realtimeContext, x, y);
    };
    this.simContext.hooks.makeExplosionAt = (x, y) => {
      makeRealtimeExplosionAt(this.realtimeContext, x, y);
    };
    this.simContext.hooks.makeMonster = () => {
      makeRealtimeMonster(this.realtimeContext);
    };
    this.simContext.hooks.makeTornado = () => {
      makeRealtimeTornado(this.realtimeContext);
    };
  }

  /**
   * Syncs mutable realtime timing/scalar inputs from authoritative sim state.
   * Mirrors `DoAnimation`/`SimSpeed` gate context from `ref/micropolis/src/sim/g_ani.c`
   * + `ref/micropolis/src/sim/w_editor.c` and sprite/disaster scalar ownership
   * in `ref/micropolis/src/sim/w_sprite.c`.
   */
  private syncRealtimeContextFromSimState(): void {
    this.realtimeContext.simSpeed = this.simState.SimSpeed;
    this.realtimeContext.doAnimation = this.simState.doAnimation;
    this.realtimeContext.noDisasters = this.simState.NoDisasters;
    this.realtimeContext.scenarioId = this.simState.ScenarioID;
    this.realtimeContext.totalPop = this.simState.TotalPop;
    this.realtimeContext.polMaxX = this.simState.PolMaxX;
    this.realtimeContext.polMaxY = this.simState.PolMaxY;
  }

  /**
   * Runs one realtime movement/animation pass inside the current store tick.
   * Mirrors `sim_loop` -> `MoveObjects` -> `animateTiles` timing from
   * `ref/micropolis/src/sim/sim.c`, `ref/micropolis/src/sim/w_sprite.c`, and
   * `ref/micropolis/src/sim/g_ani.c`.
   */
  private advanceRealtimeStep(): void {
    this.syncRealtimeContextFromSimState();
    runRealtimeTick(this.realtimeContext);
  }

  /**
   * Ensures Stage 7 overlay payloads always have at least one moving object
   * while ambient simulation is running.
   * Mirrors realtime copter movement from `GenerateCopter`/`DoCopterSprite` in
   * `ref/micropolis/src/sim/w_sprite.c`.
   * Difference: this host-only bootstrap seam is intentionally additive so
   * manual browser verification does not depend on rare city/disaster triggers.
   */
  private ensureRealtimeDemoObject(): void {
    if (!this.seedRealtimeDemoObject) {
      return;
    }

    if (this.realtimeContext.sprites.some((sprite) => sprite.frame > 0)) {
      return;
    }

    generateRealtimeCopter(this.realtimeContext, DEMO_WORLD_WIDTH >> 1, DEMO_WORLD_HEIGHT >> 1);
  }

  /**
   * Builds one full realtime snapshot payload from active sprite state.
   * Mirrors full sprite list ownership in `DrawObjects` (`ref/micropolis/src/sim/w_sprite.c`).
   * Parity note: adds bridge `id` keys for deterministic delta application.
   */
  private buildRealtimeSnapshotPayload(): NonNullable<DemoPatchPayload['realtime']> {
    const objects = this.collectRealtimeObjectsWithIds();
    this.lastRealtimeObjectsById = indexRealtimeObjectsById(objects);
    return {
      snapshot: objects,
      objects,
    };
  }

  /**
   * Builds one incremental realtime delta payload for the current authority tick.
   * Mirrors per-tick sprite move/create/destroy progression in
   * `ref/micropolis/src/sim/w_sprite.c`.
   * Parity note: explicit bridge deltas are transport metadata and keep legacy
   * `objects` compatibility while Stage 7 overlay projection migrates.
   */
  private buildRealtimeDeltaPayload(): NonNullable<DemoPatchPayload['realtime']> {
    const objects = this.collectRealtimeObjectsWithIds();
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
    return {
      objects,
      deltas,
    };
  }

  /**
   * Collects active realtime sprites as transport payload objects.
   * Mirrors active sprite filtering (`frame != 0`) in `DrawObjects` from
   * `ref/micropolis/src/sim/w_sprite.c`.
   * Parity note: bridge `id` values are deterministic per-host-process ids.
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
   * Reads or assigns one deterministic bridge realtime object id.
   * Mirrors stable in-process sprite identity intent in `ref/micropolis/src/sim/w_sprite.c`.
   * Parity note: C identity uses pointers/slots; bridge payloads need explicit ids.
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
   * Starts the deterministic local tick interval.
   * Mirrors timer-based step scheduling intent in `ref/micropolis/src/sim/w_util.c`.
   */
  private startInterval(roomId: string, clientId: string): void {
    this.stopInterval();
    if (!this.enableAmbientTicks) {
      return;
    }

    this.intervalHandle = setInterval(() => {
      this.emitAmbientPatch(roomId, clientId);
    }, this.patchIntervalMs);
  }

  /**
   * Syncs ambient timer state with effective simulation speed.
   * Mirrors timer start/stop behavior in `setSpeed(short)` from
   * `ref/micropolis/src/sim/w_util.c`.
   * Parity note: browser host timer wiring substitutes for C
   * `StartMicropolisTimer()`/`StopMicropolisTimer()` callbacks.
   */
  private refreshAmbientInterval(): void {
    if (
      !this.enableAmbientTicks ||
      this.onEnvelope === undefined ||
      this.activeRoomId === undefined ||
      this.activeClientId === undefined ||
      this.simState.SimSpeed === 0
    ) {
      this.stopInterval();
      return;
    }

    if (this.intervalHandle !== undefined) {
      return;
    }

    this.startInterval(this.activeRoomId, this.activeClientId);
  }

  /**
   * Stops the local tick interval.
   * Mirrors timer stop behavior from `StopMicropolisTimer` usage in
   * `ref/micropolis/src/sim/w_util.c`.
   */
  private stopInterval(): void {
    if (this.intervalHandle !== undefined) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  /**
   * Captures one authoritative `uiSet` head update from sim-core hooks.
   * Mirrors `UISet*` calls from `DoUpdateHeads` in `ref/micropolis/src/sim/w_update.c`.
   */
  private captureUiSet(key: string, value: number | boolean | string): void {
    switch (key) {
      case 'funds':
        if (typeof value === 'string') {
          this.hookHudState.fundsLabel = value;
        }
        return;
      case 'date':
        if (typeof value === 'string') {
          this.hookHudState.dateLabel = value;
        }
        return;
      case 'dateMonth':
        if (typeof value === 'number') {
          this.hookHudState.dateMonth = Math.trunc(value);
        }
        return;
      case 'dateYear':
        if (typeof value === 'number') {
          this.hookHudState.dateYear = Math.trunc(value);
        }
        return;
      case 'demandR':
        if (typeof value === 'number') {
          this.hookHudState.demandR = Math.trunc(value);
        }
        return;
      case 'demandC':
        if (typeof value === 'number') {
          this.hookHudState.demandC = Math.trunc(value);
        }
        return;
      case 'demandI':
        if (typeof value === 'number') {
          this.hookHudState.demandI = Math.trunc(value);
        }
        return;
      case 'optionAutoBudget':
        if (typeof value === 'boolean') {
          this.hookHudState.options.autoBudget = value;
        }
        return;
      case 'optionAutoGo':
        if (typeof value === 'boolean') {
          this.hookHudState.options.autoGo = value;
        }
        return;
      case 'optionAutoBulldoze':
        if (typeof value === 'boolean') {
          this.hookHudState.options.autoBulldoze = value;
        }
        return;
      case 'optionDisasters':
        if (typeof value === 'boolean') {
          this.hookHudState.options.disasters = value;
        }
        return;
      case 'optionUserSoundOn':
        if (typeof value === 'boolean') {
          this.hookHudState.options.userSoundOn = value;
        }
        return;
      case 'optionDoAnimation':
        if (typeof value === 'boolean') {
          this.hookHudState.options.doAnimation = value;
        }
        return;
      case 'optionDoMessages':
        if (typeof value === 'boolean') {
          this.hookHudState.options.doMessages = value;
        }
        return;
      case 'optionDoNotices':
        if (typeof value === 'boolean') {
          this.hookHudState.options.doNotices = value;
        }
        return;
    }
  }

  /**
   * Captures one authoritative `SendMes` dispatch from sim-core hooks.
   * Mirrors `SendMes`/`doMessage` delivery in `ref/micropolis/src/sim/s_msg.c`.
   */
  private captureMessage(id: number): void {
    this.pendingHookMessages.push({
      id,
      text: messageTextForId(id),
    });
  }

  /**
   * Captures one authoritative `SendMesAt` dispatch from sim-core hooks.
   * Mirrors `SendMesAt`/`doMessage` delivery in `ref/micropolis/src/sim/s_msg.c`.
   */
  private captureMessageAt(id: number, x: number, y: number): void {
    this.pendingHookMessages.push({
      id,
      text: messageTextForId(id),
      x,
      y,
    });
  }

  /**
   * Consumes buffered hook-delivered messages for one host patch emission.
   * Mirrors one-heads-cycle message delivery ownership in `ref/micropolis/src/sim/s_msg.c`.
   */
  private drainPendingHookMessages(): DemoHudMessagePayload[] {
    if (this.pendingHookMessages.length === 0) {
      return [];
    }
    const messages = this.pendingHookMessages;
    this.pendingHookMessages = [];
    return messages;
  }

  /**
   * Appends host-generated messages to the local snapshot baseline feed.
   * Mirrors one-slot message replacement in `SetMessageField` from
   * `ref/micropolis/src/sim/s_msg.c`, but intentionally keeps a bounded log.
   */
  private recordMessages(
    messages: readonly DemoHudMessagePayload[],
    tick: number,
    serverSeq: number,
  ): void {
    for (const message of messages) {
      this.messageLog.push({
        ...message,
        tick: message.tick ?? tick,
        serverSeq: message.serverSeq ?? serverSeq,
      });
    }
    if (this.messageLog.length > DEMO_MESSAGE_LOG_LIMIT) {
      this.messageLog.splice(0, this.messageLog.length - DEMO_MESSAGE_LOG_LIMIT);
    }
  }

  private resetMessageLog(text: string): void {
    this.messageLog.splice(0, this.messageLog.length, { id: 0, text });
  }

  /**
   * Ensures snapshot baseline messages retain stable ordering metadata.
   * Mirrors deterministic replay cursor intent from
   * `ref/micropolis/spec/integration/SPEC.md`.
   * Difference: C message payloads do not carry tick/sequence fields, so Stage 2
   * records these bridge metadata fields for deterministic snapshot replay.
   */
  private ensureMessageLogReplayMetadata(tick: number, serverSeq: number): void {
    for (let index = 0; index < this.messageLog.length; index += 1) {
      const message = this.messageLog[index];
      if (message === undefined) {
        continue;
      }
      if (message.tick !== undefined && message.serverSeq !== undefined) {
        continue;
      }

      this.messageLog[index] = {
        ...message,
        tick: message.tick ?? tick,
        serverSeq: message.serverSeq ?? serverSeq,
      };
    }
  }

  /**
   * Runs one heads update pass so hook-owned HUD state stays current.
   * Mirrors `sim_update_editors` -> `DoUpdateHeads` flow in
   * `ref/micropolis/src/sim/sim.c` and `ref/micropolis/src/sim/w_update.c`.
   */
  private refreshHookDrivenHud(): void {
    this.simContext.store.beginTick();
    try {
      runUiUpdate(this.simState, this.simContext);
    } finally {
      this.simContext.store.commitTick();
    }
  }

  /**
   * Builds Stage 2 HUD payload heads from authoritative sim-core hook state.
   * Mirrors `UISetFunds`, `UISetDate`, `UISetDemand`, and `UISetSpeed` flows in
   * `ref/micropolis/src/sim/w_update.c` and `ref/micropolis/src/sim/w_util.c`.
   */
  private getHudHeadsPayload(): NonNullable<DemoPatchPayload['hud']> {
    return {
      funds: this.simState.TotalFunds,
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
      speed: this.getVisibleSpeed(),
      options: this.getHudOptionsHeads(),
    };
  }

  /**
   * Reads visible speed exactly like `UISetSpeed` in `setSpeed(short)`.
   * Mirrors `setSpeed` display behavior from `ref/micropolis/src/sim/w_util.c`.
   */
  private getVisibleSpeed(): number {
    return this.simPaused ? 0 : this.simState.SimMetaSpeed;
  }

  /**
   * Returns current options heads payload for HUD projection.
   * Mirrors option booleans emitted by `updateOptions` / `UISetOptions` in
   * `ref/micropolis/src/sim/w_update.c`.
   */
  private getHudOptionsHeads(): HostHudOptionsPayload {
    return { ...this.hookHudState.options };
  }

  /**
   * Sets paused state and remembered speed metadata.
   * Mirrors `Pause`/`Resume`/`setSpeed` interactions from
   * `ref/micropolis/src/sim/w_util.c`.
   * Parity note: returns whether this command path executed `setSpeed` and
   * therefore emitted `UISetSpeed` in C.
   */
  private applySimControl(command: Stage2SimControlCommand): boolean {
    if (command.control === 'pause') {
      return this.pauseSimulation();
    }

    if (command.control === 'play') {
      return this.resumeSimulation();
    }

    return this.setSimulationSpeed(command.speed);
  }

  /**
   * Pause semantics for Stage 2 host sim controls.
   * Mirrors `Pause()` in `ref/micropolis/src/sim/w_util.c`.
   * Parity note: returns false on C-equivalent no-op (`sim_paused` already true).
   */
  private pauseSimulation(): boolean {
    if (this.simPaused) {
      return false;
    }
    this.simPausedSpeed = normalizePlayableSpeed(this.simState.SimMetaSpeed);
    this.setSimulationSpeed(0);
    this.simPaused = true;
    return true;
  }

  /**
   * Resume semantics for Stage 2 host sim controls.
   * Mirrors `Resume()` in `ref/micropolis/src/sim/w_util.c`.
   * Parity note: returns false on C-equivalent no-op (`sim_paused` already false).
   */
  private resumeSimulation(): boolean {
    if (!this.simPaused) {
      return false;
    }
    this.simPaused = false;
    this.setSimulationSpeed(this.simPausedSpeed);
    return true;
  }

  /**
   * Speed semantics for Stage 2 host sim controls.
   * Mirrors `setSpeed(short)` in `ref/micropolis/src/sim/w_util.c`.
   * Parity note: always returns true because C `setSpeed` always emits `UISetSpeed`,
   * even when the clamped speed value is unchanged.
   */
  private setSimulationSpeed(candidate: number): true {
    let speed = normalizePlayableSpeed(candidate);
    this.simState.SimMetaSpeed = speed;

    if (this.simPaused) {
      this.simPausedSpeed = this.simState.SimMetaSpeed;
      speed = 0;
    }

    this.simState.SimSpeed = speed;
    return true;
  }

  /**
   * Applies host-side pause/timer/HUD sync after `loadCityLikeC`.
   * Mirrors `loadFile` + `setSpeed` + `DoSimInit` ownership in
   * `ref/micropolis/src/sim/s_fileio.c`, while preserving TypeScript-only host
   * pause bookkeeping.
   */
  private syncHostLoadStateFromSimState(): void {
    this.simPaused = false;
    this.simPausedSpeed = normalizePlayableSpeed(this.simState.SimMetaSpeed);
    this.pendingHookMessages = [];
    this.refreshAmbientInterval();
    this.refreshHookDrivenHud();
  }

  /**
   * Runs core new-city map generation + lifecycle initialization in Micropolis order.
   * Mirrors `GenerateSomeCity` in `ref/micropolis/src/sim/s_gen.c`:
   * `GenerateMap(Rand16())` followed by core reset lifecycle init (`InitWillStuff`,
   * `DoSimInit`) and the same default terrain globals (`TreeLevel/LakeLevel/CurveLevel/
   * CreateIsland` all `-1`).
   * Parity note: editor/map invalidation UI calls in C stay outside this host helper.
   */
  private runNewCityLifecycleReset(): void {
    const terrainSeed = this.simContext.rng.next16();
    resetForNewCityFromSeed(this.simState, this.simContext, {
      seed: terrainSeed,
      treeLevel: DEMO_NEW_CITY_TREE_LEVEL,
      lakeLevel: DEMO_NEW_CITY_LAKE_LEVEL,
      curveLevel: DEMO_NEW_CITY_CURVE_LEVEL,
      createIsland: DEMO_NEW_CITY_CREATE_ISLAND,
    });
    this.syncRuntimeTilesFromClassicMapLayer();
  }

  /**
   * Applies scenario/new-city scalar heads baseline into sim-core HUD controls.
   * Mirrors scenario/reset scalar bootstrap intent from
   * `ref/micropolis/src/sim/s_fileio.c` (`LoadScenario`) and
   * `ref/micropolis/src/sim/s_init.c` reset ownership.
   * Parity note: map tile payload remains Stage 2 demo-owned in this host.
   */
  private applyScenarioSimulationMeta(cityTime: number, totalFunds: number): void {
    this.simState.CityTime = cityTime;
    setFunds(this.simState, totalFunds);
    this.simState.CityTax = 7;
    this.simState.autoBudget = DEMO_DEFAULT_AUTO_BUDGET;
    this.simState.autoGo = DEMO_DEFAULT_AUTO_GO;
    this.simState.autoBulldoze = DEMO_DEFAULT_AUTO_BULLDOZE;
    this.simState.userSoundOn = DEMO_DEFAULT_USER_SOUND_ON;
    this.simState.doAnimation = DEMO_DEFAULT_DO_ANIMATION;
    this.simState.doMessages = DEMO_DEFAULT_DO_MESSAGES;
    this.simState.doNotices = DEMO_DEFAULT_DO_NOTICES;
    this.simState.NoDisasters = !DEMO_DEFAULT_DISASTERS;
    this.simState.MustUpdateOptions = 1;
    this.simState.ValveFlag = 1;
    this.simState.MessagePort = 0;
    this.simState.MesNum = 0;
    this.simState.MesX = 0;
    this.simState.MesY = 0;
    this.simState.LastPicNum = 0;
    this.simState.LastMesTime = 0;

    this.simPaused = false;
    this.setSimulationSpeed(3);
    this.pendingHookMessages = [];
    this.refreshAmbientInterval();
    this.refreshHookDrivenHud();
  }

  /**
   * Resets Stage 2 host state to a new-city baseline.
   * Mirrors `DoNewCity` reset intent in `ref/micropolis/src/sim/s_init.c`.
   * Parity note: map regeneration remains deterministic/demo-scripted here.
   */
  private resetToNewCity(): void {
    this.currentScenarioId = 0;
    this.runNewCityLifecycleReset();
    this.applyScenarioSimulationMeta(0, DEMO_INITIAL_FUNDS);
    this.cityFileName = DEMO_DEFAULT_CITY_FILE_NAME;
    this.cityName = DEMO_DEFAULT_CITY_NAME;
    this.resetMessageLog('Started a new city.');
  }

  /**
   * Sync row-major runtime map tiles into the classic x-major map layer before save.
   * Mirrors `saveFile` map persistence in `ref/micropolis/src/sim/s_fileio.c`
   * where `_save_short((&Map[0][0]), WORLD_X * WORLD_Y, f)` writes contiguous
   * `Map[x][y]` storage.
   * Parity note: Stage 2 host mutates row-major `mapTiles` for rendering and only
   * mirrors into sim-core classic storage at save boundaries.
   */
  private syncRuntimeTilesToClassicMapLayerForSave(): void {
    this.simContext.store.beginTick();
    try {
      const mapLayer = this.simContext.store.getLayer('map');
      if (!(mapLayer instanceof Uint16Array)) {
        throw new Error(`expected Uint16Array map layer; got ${mapLayer.constructor.name}`);
      }
      if (mapLayer.length < this.mapTiles.length) {
        throw new Error(
          `expected map layer length >= ${this.mapTiles.length}; got ${mapLayer.length}`,
        );
      }

      copyRuntimeRowMajorTilesToClassicXMajorMap(
        this.mapTiles,
        mapLayer,
        DEMO_WORLD_WIDTH,
        DEMO_WORLD_HEIGHT,
      );
    } finally {
      this.simContext.store.commitTick();
    }
  }

  /**
   * Mirrors one authoritative classic map snapshot into runtime row-major tiles.
   * Mirrors `Map[x][y]` ownership in `ref/micropolis/src/sim/s_alloc.c` and
   * load/new-city map copy boundaries in `ref/micropolis/src/sim/s_fileio.c`
   * and `ref/micropolis/src/sim/s_gen.c`.
   */
  private syncRuntimeTilesFromClassicMapLayer(): void {
    const mapLayer = this.simContext.store.snapshot('map');
    if (!(mapLayer instanceof Uint16Array)) {
      throw new Error(
        `expected Uint16Array map layer for runtime tile sync; got ${mapLayer.constructor.name}`,
      );
    }

    copyClassicXMajorMapToRuntimeTiles(
      mapLayer,
      this.mapTiles,
      DEMO_WORLD_WIDTH,
      DEMO_WORLD_HEIGHT,
    );
  }

  /**
   * Resolve and cache one scenario resource payload from canonical `snro.*` files.
   * Mirrors `_load_file(fname, ResourceDir)` lookup identity from `LoadScenario`
   * in `ref/micropolis/src/sim/s_fileio.c`.
   * Parity note: cache lifetime is host-process scoped, matching C resource reuse intent.
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
}

function sanitizeCityFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (trimmed.length === 0) {
    return DEMO_DEFAULT_CITY_FILE_NAME;
  }
  return trimmed.toLowerCase().endsWith('.cty') ? trimmed : `${trimmed}.cty`;
}

/**
 * Initial HUD scalar cache used before the first sim-core `uiSet` heads pass.
 * Mirrors pre-`DoUpdateHeads` UI baseline intent in
 * `ref/micropolis/src/sim/w_update.c`.
 */
function createInitialHookDrivenHudState(): HookDrivenHudState {
  return {
    fundsLabel: formatFundsLabel(DEMO_INITIAL_FUNDS),
    dateLabel: 'Jan 1900',
    dateMonth: 0,
    dateYear: 1900,
    demandR: 0,
    demandC: 0,
    demandI: 0,
    options: {
      autoBudget: DEMO_DEFAULT_AUTO_BUDGET,
      autoGo: DEMO_DEFAULT_AUTO_GO,
      autoBulldoze: DEMO_DEFAULT_AUTO_BULLDOZE,
      disasters: DEMO_DEFAULT_DISASTERS,
      userSoundOn: DEMO_DEFAULT_USER_SOUND_ON,
      doAnimation: DEMO_DEFAULT_DO_ANIMATION,
      doMessages: DEMO_DEFAULT_DO_MESSAGES,
      doNotices: DEMO_DEFAULT_DO_NOTICES,
    },
  };
}

/**
 * Clamps an arbitrary candidate to the playable `setSpeed(short)` domain `0..3`.
 * Mirrors clamping in `setSpeed(short)` from `ref/micropolis/src/sim/w_util.c`.
 */
function normalizePlayableSpeed(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const speed = Math.trunc(value);
  if (speed <= 0) {
    return 0;
  }
  if (speed >= 3) {
    return 3;
  }
  return speed;
}

/**
 * Resolves message text for one message id.
 * Mirrors `GetIndString` message lookup intent in `ref/micropolis/src/sim/s_msg.c`.
 * Difference: Stage 2 uses a compact local subset instead of full resource tables.
 */
function messageTextForId(id: number): string {
  const text = STAGE2_MESSAGE_TEXT[id];
  if (text !== undefined) {
    return text;
  }

  return `Message ${id}`;
}

/**
 * Formats funds label using Micropolis dollar-grouping style.
 * Mirrors `ReallyUpdateFunds` + `makeDollarDecimalStr` behavior in
 * `ref/micropolis/src/sim/w_update.c` and `ref/micropolis/src/sim/w_util.c`.
 */
function formatFundsLabel(value: number): string {
  return `Funds: ${formatDollarDecimal(value)}`;
}

/**
 * Formats one number into Micropolis-style dollar text.
 * Mirrors `makeDollarDecimalStr` in `ref/micropolis/src/sim/w_util.c`.
 */
function formatDollarDecimal(value: number): string {
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
 * Applies one Stage 2 tool command to the local demo map and returns changed
 * tiles for a host `patch` envelope.
 * Mirrors placement footprint rules from `ref/micropolis/src/sim/w_tool.c`
 * (`toolSize[]`, `toolOffset[]`, 3x3 zone stamp shape).
 * Difference: this uses synthetic debug tile ids and does not run simulation.
 */
function applyDemoToolCommand(
  tiles: Uint16Array,
  width: number,
  height: number,
  command: Stage2ToolCommand,
):
  | { accepted: true; deltas: Array<{ x: number; y: number; tileWord: number }> }
  | { accepted: false; reason: string } {
  if (!Number.isInteger(command.x) || !Number.isInteger(command.y)) {
    return { accepted: false, reason: 'out-of-bounds' };
  }

  const spec = getPlayableToolSpec(command.tool);
  const startX = command.x - spec.offset;
  const startY = command.y - spec.offset;
  const endX = startX + spec.size;
  const endY = startY + spec.size;

  if (startX < 0 || startY < 0 || endX > width || endY > height) {
    return { accepted: false, reason: 'out-of-bounds' };
  }

  const deltas: Array<{ x: number; y: number; tileWord: number }> = [];

  if (ZONE_TOOLS.has(command.tool)) {
    const base = TOOL_TILE_VALUES[command.tool];
    let offset = 0;
    for (let yy = startY; yy < endY; yy += 1) {
      for (let xx = startX; xx < endX; xx += 1) {
        writeDemoTile(tiles, width, xx, yy, (base + offset) & 0xffff, deltas);
        offset += 1;
      }
    }
    return { accepted: true, deltas };
  }

  writeDemoTile(tiles, width, command.x, command.y, TOOL_TILE_VALUES[command.tool], deltas);
  return { accepted: true, deltas };
}

/**
 * Updates one tile and records a patch delta only when the value changes.
 * Mirrors tile-write + dirty update intent in `ref/micropolis/src/sim/w_map.c`.
 */
function writeDemoTile(
  tiles: Uint16Array,
  width: number,
  x: number,
  y: number,
  tile: number,
  deltas: Array<{ x: number; y: number; tileWord: number }>,
): void {
  const index = y * width + x;
  if (tiles[index] === tile) {
    return;
  }

  tiles[index] = tile;
  deltas.push({ x, y, tileWord: tile });
}

/**
 * Builds authoritative snapshot tile words in classic Micropolis x-major order.
 * Mirrors contiguous `Map[x][y]` storage in `ref/micropolis/src/sim/s_alloc.c`
 * and flat map IO ordering in `ref/micropolis/src/sim/s_fileio.c`.
 * Difference: demo host stores working tiles row-major for canvas convenience,
 * then converts to authoritative snapshot order at the payload boundary.
 */
function buildSnapshotTileWordsFromRuntimeMap(
  runtimeTiles: Uint16Array,
  width: number,
  height: number,
): Uint16Array {
  const snapshotTileWords = new Uint16Array(width * height);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const runtimeIndex = y * width + x;
      const snapshotIndex = getCoreBridgeV1SnapshotTileIndex(x, y, height);
      snapshotTileWords[snapshotIndex] = runtimeTiles[runtimeIndex] ?? 0;
    }
  }
  return snapshotTileWords;
}

/**
 * Copies classic Micropolis x-major map storage (`Map[x][y]`) into runtime row-major
 * tile order for the browser projection buffer.
 * Mirrors x-major ownership in `ref/micropolis/src/sim/s_alloc.c` and terrain writes in
 * `ref/micropolis/src/sim/s_gen.c`.
 * Difference: the runtime buffer stays row-major for canvas-friendly indexing.
 */
function copyClassicXMajorMapToRuntimeTiles(
  sourceTileWords: Uint16Array,
  runtimeTiles: Uint16Array,
  width: number,
  height: number,
): void {
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const sourceIndex = getCoreBridgeV1SnapshotTileIndex(x, y, height);
      const runtimeIndex = y * width + x;
      runtimeTiles[runtimeIndex] = sourceTileWords[sourceIndex] ?? 0;
    }
  }
}

/**
 * Copies runtime row-major tile order into classic Micropolis x-major map storage.
 * Mirrors contiguous `Map[x][y]` map ownership consumed by `saveFile` in
 * `ref/micropolis/src/sim/s_fileio.c`.
 * Difference: Stage 2 host runtime map is row-major for canvas convenience.
 */
function copyRuntimeRowMajorTilesToClassicXMajorMap(
  runtimeTiles: Uint16Array,
  destinationTileWords: Uint16Array,
  width: number,
  height: number,
): void {
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const runtimeIndex = y * width + x;
      const destinationIndex = getCoreBridgeV1SnapshotTileIndex(x, y, height);
      destinationTileWords[destinationIndex] = runtimeTiles[runtimeIndex] ?? 0;
    }
  }
}

/**
 * Builds an initial deterministic tile baseline for the Stage 2 debug map view.
 * Mirrors map-buffer baseline setup intent from `ref/micropolis/src/sim/g_map.c`.
 * Difference: values are synthetic so UI work can proceed before full art parity.
 */
function buildInitialDemoMapTiles(width: number, height: number): Uint16Array {
  const tiles = new Uint16Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const band = (x >> 3) & 31;
      const stripe = (y >> 2) & 31;
      tiles[index] = ((band << 8) | stripe) & 0xffff;
    }
  }
  return tiles;
}

/**
 * Builds id-indexed lookup table for one realtime payload object array.
 * Mirrors keyed sprite ownership intent behind per-sprite mutation in
 * `ref/micropolis/src/sim/w_sprite.c`.
 * Parity note: explicit id indexing is bridge payload metadata.
 */
function indexRealtimeObjectsById(
  objects: readonly HostRealtimeObjectWithIdPayload[],
): Map<string, HostRealtimeObjectWithIdPayload> {
  const byId = new Map<string, HostRealtimeObjectWithIdPayload>();
  for (const object of objects) {
    byId.set(object.id, object);
  }
  return byId;
}

/**
 * Compares two realtime payload objects for transport delta generation.
 * Mirrors sprite field mutation checks in `ref/micropolis/src/sim/w_sprite.c`.
 * Parity note: comparison is on payload fields only, not object identity.
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function getScenarioResourceUrl(fileName: string): URL {
  const resourceUrl = DEMO_SCENARIO_RESOURCE_URLS.get(fileName);
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
