import type { readFile as nodeReadFile } from 'node:fs/promises';

import { getCoreBridgeV1SnapshotTileIndex } from '../../../../../packages/core-bridge/src/types.ts';
import {
  ANI_TILE,
  consumeMapRedrawPlan,
  createRealtimeContext,
  destroyAllSprites as destroyRealtimeSprites,
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
  type MapRedrawPlan,
  type Patch,
  planMapRedraw,
  type RealtimeContext,
  resetForNewCityFromSeed,
  runRealtimeTick,
  runUiUpdate,
  sendMessages,
  setValves,
  type SimContext,
  type SimSprite,
  type SimState,
  Tile,
  TileFlag,
  TileMask,
  WIRE_TABLE,
} from '../../../../../packages/sim-core/src/index.ts';
import { setFunds } from '../../../../../packages/sim-core/src/systems/funds.ts';
import { loadCityLikeC, loadScenarioLikeC } from '../../../../../packages/sim-io/src/load.ts';
import { saveCityAsLikeC } from '../../../../../packages/sim-io/src/save.ts';
import {
  getScenarioDefinition,
  SCENARIO_TABLE,
  type ScenarioDefinition,
} from '../../../../../packages/sim-io/src/scenarios.ts';
import { SimCoreRuntimeState } from '../sim-core-runtime-state.ts';
import {
  type ClientEnvelope,
  type CoreHost,
  type CoreHostConnection,
  getPlayableToolSpec,
  type HostEnvelope,
  type HostHudMessagePayload,
  type HostHudOptionsPayload,
  type HostMapPatchTileWordDelta,
  type HostMapRedrawPlanPayload,
  type HostPatchPayload,
  type HostRealtimeObjectDeltaPayload,
  type HostRealtimeObjectPayload,
  isPlayableCityIoCommand,
  isPlayableCityLifecycleCommand,
  isPlayableScenarioCommand,
  isPlayableSimControlCommand,
  isPlayableToolCommand,
  type PlayableCityIoCommand,
  type PlayableLoadCityCommand,
  type PlayableLoadScenarioCommand,
  type PlayableSaveCityCommand,
  type PlayableSimControlCommand,
  type PlayableToolCommand,
  type PlayableToolName,
} from './protocol.ts';

const DEMO_WORLD_WIDTH = 120;
const DEMO_WORLD_HEIGHT = 100;
// `map_state` index 0 selects `ALMAP` in `setUpMapProcs` (`g_map.c`).
const DEMO_ACTIVE_MAP_STATE = 0;
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

const TOOL_TILE_VALUES: Record<PlayableToolName, number> = {
  res: Tile.RESBASE,
  com: Tile.COMBASE,
  ind: Tile.INDBASE,
  fire: Tile.FIRESTBASE,
  query: Tile.DIRT,
  police: Tile.POLICESTBASE,
  wire: Tile.LHPOWER,
  bulldoze: Tile.DIRT,
  rail: Tile.LHRAIL,
  road: Tile.ROADS,
  stadium: Tile.STADIUMBASE,
  park: Tile.WOODS2,
  seaport: Tile.PORTBASE,
  coal: Tile.COALBASE,
  nuclear: Tile.NUCLEARBASE,
  airport: Tile.AIRPORTBASE,
};

const TOOL_COSTS: Record<PlayableToolName, number> = {
  // Mirrors `CostOf[]` values for all playable editor tools in
  // `ref/micropolis/src/sim/w_tool.c`.
  res: 100,
  com: 100,
  ind: 100,
  fire: 500,
  query: 0,
  police: 500,
  wire: 5,
  bulldoze: 1,
  rail: 20,
  road: 10,
  stadium: 5000,
  park: 10,
  seaport: 3000,
  coal: 3000,
  nuclear: 5000,
  airport: 10000,
};

const AREA_STAMP_TOOLS = new Set<PlayableToolName>([
  'res',
  'com',
  'ind',
  'fire',
  'police',
  'stadium',
  'seaport',
  'coal',
  'nuclear',
  'airport',
]);
const DEMO_WIRE_REBUILD_MIN_TILE_ID = 210;
const DEMO_WIRE_REBUILD_MAX_TILE_ID = 220;

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

/**
 * Manual disaster choices exposed in the browser QA panel.
 * Mirrors the Disasters menu entries in `ref/micropolis/res/whead.tcl`
 * (`Monster`, `Fire`, `Flood`, `Meltdown`, `Tornado`, `Earthquake`).
 */
export const MANUAL_REALTIME_EVENT_CHOICES = [
  {
    id: 'tornado',
    label: 'Trigger Tornado',
  },
  {
    id: 'monster',
    label: 'Trigger Monster',
  },
  {
    id: 'fire',
    label: 'Trigger Fire',
  },
  {
    id: 'flood',
    label: 'Trigger Flood',
  },
  {
    id: 'meltdown',
    label: 'Trigger Meltdown',
  },
  {
    id: 'earthquake',
    label: 'Trigger Earthquake',
  },
] as const;

/**
 * Union of manual disaster ids.
 * Mirrors disaster entrypoint families in `ref/micropolis/src/sim/s_disast.c`
 * and sprite disaster entrypoints in `ref/micropolis/src/sim/w_sprite.c`.
 */
export type ManualRealtimeEventId = (typeof MANUAL_REALTIME_EVENT_CHOICES)[number]['id'];

/**
 * Scenario choice metadata shown in the Playable Runtime browser selector.
 * Mirrors scenario rows from `LoadScenario` in `ref/micropolis/src/sim/s_fileio.c`.
 */
export interface PlayableScenarioChoice {
  id: number;
  name: string;
  fileName: string;
  startYear: number;
}

/**
 * Playable Runtime browser scenario option table.
 * Mirrors `LoadScenario` switch-table labels/file ids from
 * `ref/micropolis/src/sim/s_fileio.c` (1:1 metadata). Runtime scenario starts
 * load canonical `snro.*` payloads from `ref/micropolis/res`.
 */
export const PLAYABLE_SCENARIO_CHOICES: readonly PlayableScenarioChoice[] = SCENARIO_TABLE.map(
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

type DemoMapTileWordDelta = HostMapPatchTileWordDelta;

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
 * Runtime configuration for the scripted Playable Runtime local host.
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
   * seam ensures Realtime Overlay manual overlay movement is always observable in browser runs.
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
 * Deterministic local map host used for Playable Runtime browser play.
 * Mirrors authoritative command + update intent from
 * `ref/micropolis/src/sim/w_tool.c`, `ref/micropolis/src/sim/w_update.c`,
 * `ref/micropolis/src/sim/w_util.c`, `ref/micropolis/src/sim/s_msg.c`, and
 * `ref/micropolis/src/sim/s_fileio.c`.
 * Difference: map mutation remains deterministic/demo-scripted, but HUD/message/speed
 * projection is sourced from real sim-core hook outputs (`uiSet`, `sendMes`,
 * `sendMesAt`, `tickCount`).
 * Migration note: this host is migration-frozen for gameplay behavior. Route `/`
 * gameplay changes must be implemented in the sim-core envelope host path.
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
    const authorityState = new SimCoreRuntimeState({
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
   * Triggers one manual disaster event from the browser QA panel.
   * Mirrors Disasters menu entrypoints in `ref/micropolis/res/whead.tcl` and
   * the corresponding runtime handlers in `ref/micropolis/src/sim/s_disast.c`
   * and `ref/micropolis/src/sim/w_sprite.c`.
   * Parity note: the host first mirrors runtime row-major tiles back to classic
   * `Map[x][y]` storage so disaster handlers operate over the current visible map.
   */
  public triggerManualRealtimeEvent(eventId: ManualRealtimeEventId): boolean {
    if (
      this.onEnvelope === undefined ||
      this.activeRoomId === undefined ||
      this.activeClientId === undefined
    ) {
      return false;
    }

    const previousRuntimeTiles = new Uint16Array(this.mapTiles);
    this.syncRuntimeTilesToClassicMapLayerForSave();

    this.tick += 1;
    this.simContext.store.beginTick();
    try {
      this.syncRealtimeContextFromSimState();
      this.applyManualRealtimeEvent(eventId);
      runUiUpdate(this.simState, this.simContext);
    } finally {
      this.simContext.store.commitTick();
    }

    this.syncRuntimeTilesFromClassicMapLayer();
    const mapTileWordDeltas = buildRuntimeMapTileWordDeltas(
      previousRuntimeTiles,
      this.mapTiles,
      DEMO_WORLD_WIDTH,
      DEMO_WORLD_HEIGHT,
    );

    this.emitPatch(
      this.activeRoomId,
      this.activeClientId,
      this.buildHookDrivenPatchPayload({
        includeHud: true,
        mapTileWordDeltas,
      }),
    );

    return true;
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

    if (isPlayableToolCommand(envelope.command)) {
      this.handleToolCommand(envelope, envelope.command);
      return;
    }

    if (isPlayableSimControlCommand(envelope.command)) {
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
   * Parity note: command keys are Playable Runtime discriminated unions rather than Tcl strings.
   */
  private routeLifecycleIoCommand(envelope: Extract<ClientEnvelope, { kind: 'command' }>): boolean {
    if (isPlayableCityLifecycleCommand(envelope.command)) {
      this.handleCityLifecycleCommand(envelope.roomId, envelope.clientId, envelope.commandId);
      return true;
    }

    if (isPlayableCityIoCommand(envelope.command)) {
      this.handleCityIoCommand(
        envelope.roomId,
        envelope.clientId,
        envelope.commandId,
        envelope.command,
      );
      return true;
    }

    if (isPlayableScenarioCommand(envelope.command)) {
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
   * Applies a Playable Runtime tool command and emits map/HUD patch deltas.
   * Mirrors tool placement + spending intent from `do_tool`/`Spend` in
   * `ref/micropolis/src/sim/w_tool.c`.
   * Difference: tile values are synthetic debug IDs in this local host.
   */
  private handleToolCommand(
    envelope: Extract<ClientEnvelope, { kind: 'command' }>,
    command: PlayableToolCommand,
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
    command: PlayableSimControlCommand,
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
    command: PlayableCityIoCommand,
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
    command: PlayableSaveCityCommand,
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
    command: PlayableLoadCityCommand,
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
    command: PlayableLoadScenarioCommand,
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
    this.ensureRealtimeDemoObject();
    const snapshotServerSeq = this.serverSeq + 1;
    const snapshotTick = tickOverride;
    const pendingMessages = this.drainPendingHookMessages();
    if (pendingMessages.length > 0) {
      this.recordMessages(pendingMessages, snapshotTick, snapshotServerSeq);
    }
    const mapRedrawPlan = this.planAndConsumeMapRedraw();
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
          redrawPlan: mapRedrawPlan,
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
   * Parity note: map payloads are only emitted when authoritative map words
   * changed during the tick (tool/lifecycle updates or C-style ANIMBIT tile
   * animation), matching `DoUpdateMap` invalidation ownership in
   * `ref/micropolis/src/sim/w_map.c`.
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

    const mapTileWordDeltas = animateRuntimeMapTilesLikeC(
      this.mapTiles,
      DEMO_WORLD_WIDTH,
      DEMO_WORLD_HEIGHT,
      this.simState.doAnimation,
    );

    this.tick += 1;
    this.emitPatch(
      roomId,
      clientId,
      this.buildHookDrivenPatchPayload({
        includeHud: true,
        mapTileWordDeltas,
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
   * (`ref/micropolis/src/sim/s_msg.c`) dispatch ownership, adapted to Playable Runtime
   * bridge payload fields.
   * Difference: map deltas are passed in by host command handlers instead of
   * being emitted directly from C update globals.
   */
  private buildHookDrivenPatchPayload(options: {
    includeHud: boolean;
    mapTileWordDeltas?: ReadonlyArray<DemoMapTileWordDelta>;
  }): DemoPatchPayload {
    const payload: DemoPatchPayload = {};
    const mapRedrawPlan = this.planAndConsumeMapRedraw(options.mapTileWordDeltas);

    this.syncRealtimeContextFromSimState();
    this.ensureRealtimeDemoObject();
    if (options.includeHud) {
      payload.hud = this.getHudHeadsPayload();
    }

    const mapTileWordDeltas = options.mapTileWordDeltas ?? [];
    const hasMapTileWordDeltas = mapTileWordDeltas.length > 0;
    if (hasMapTileWordDeltas || mapRedrawPlan.fullRedraw || mapRedrawPlan.dirtyRects.length > 0) {
      payload.map = {
        tileWordDeltas: [...mapTileWordDeltas],
        redrawPlan: mapRedrawPlan,
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
   * Plans one map redraw outcome from authoritative invalidation markers and
   * consumes the cycle markers after planning.
   * Mirrors `DoUpdateMap` invalidation gating in `ref/micropolis/src/sim/w_map.c`
   * and `sim_update_maps` clear behavior in `ref/micropolis/src/sim/sim.c`.
   * Parity note: Authoritative Runtime currently uses one `map_state` view (`ALMAP` index 0).
   */
  private planAndConsumeMapRedraw(
    mapTileWordDeltas?: ReadonlyArray<DemoMapTileWordDelta>,
  ): HostMapRedrawPlanPayload {
    const redrawPlan = planMapRedraw({
      activeMapState: DEMO_ACTIVE_MAP_STATE,
      newMap: this.simState.NewMap,
      newMapFlags: this.simState.NewMapFlags,
      mapPatch: buildMapPatchForRedrawPlan(mapTileWordDeltas, DEMO_WORLD_HEIGHT),
    });
    consumeMapRedrawPlan(this.simState, redrawPlan);
    return toHostMapRedrawPlanPayload(redrawPlan);
  }

  /**
   * Installs sprite/realtime hooks onto sim-core context callbacks.
   * Mirrors `sim->hooks` ownership from `ref/micropolis/src/sim/sim.c`,
   * routing `MoveObjects` (`w_sprite.c`) and sprite factory calls through the
   * Realtime Overlay TypeScript realtime port in `packages/sim-core/src/sim/realtime.ts`.
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
    // so Realtime Overlay host integration uses world-center launch coordinates.
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
   * Ensures Realtime Overlay overlay payloads always have at least one moving object
   * while simulation is running.
   * Mirrors realtime copter movement from `GenerateCopter`/`DoCopterSprite` in
   * `ref/micropolis/src/sim/w_sprite.c`.
   * Difference: this host-only bootstrap seam is intentionally additive so
   * manual browser verification does not depend on rare city/disaster triggers,
   * including command-driven resume/set-speed patches before ambient ticks.
   * Parity note: this only seeds while effective sim speed is non-zero, matching
   * C timer-driven realtime updates that stop when simulation speed is zero.
   */
  private ensureRealtimeDemoObject(): void {
    if (!this.seedRealtimeDemoObject) {
      return;
    }

    if (this.getVisibleSpeed() === 0 || this.simState.SimSpeed === 0) {
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
   * `objects` compatibility while Realtime Overlay overlay projection migrates.
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
   * Applies one manual disaster event into authoritative sim/realtime state.
   * Mirrors disaster handlers in `ref/micropolis/src/sim/s_disast.c`
   * (`MakeFire`, `MakeFlood`, `MakeMeltdown`, `MakeEarthquake`) and sprite
   * disaster entrypoints in `ref/micropolis/src/sim/w_sprite.c`
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
        makeFire(this.simState, this.simContext);
        return;
      case 'flood':
        makeFlood(this.simState, this.simContext);
        return;
      case 'meltdown':
        makeMeltdown(this.simState, this.simContext);
        return;
      case 'earthquake':
        makeEarthquake(this.simState, this.simContext);
        return;
    }
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
   * Difference: C message payloads do not carry tick/sequence fields, so Playable Runtime
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
   * Builds Playable Runtime HUD payload heads from authoritative sim-core hook state.
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
  private applySimControl(command: PlayableSimControlCommand): boolean {
    if (command.control === 'pause') {
      return this.pauseSimulation();
    }

    if (command.control === 'play') {
      return this.resumeSimulation();
    }

    return this.setSimulationSpeed(command.speed);
  }

  /**
   * Pause semantics for Playable Runtime host sim controls.
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
   * Resume semantics for Playable Runtime host sim controls.
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
   * Speed semantics for Playable Runtime host sim controls.
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
   * Parity note: map tile payload remains Playable Runtime demo-owned in this host.
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
   * Resets Playable Runtime host state to a new-city baseline.
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
   * Parity note: Playable Runtime host mutates row-major `mapTiles` for rendering and only
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

/**
 * Builds one map-store patch shape from coordinate-addressed tile deltas.
 * Mirrors classic `Map[x][y]` index math in `ref/micropolis/src/sim/s_alloc.c`
 * (`index = x * WORLD_Y + y`) used by redraw invalidation planning helpers.
 * Parity note: only the patch `index` vector is consumed by `planMapRedraw`.
 */
function buildMapPatchForRedrawPlan(
  mapTileWordDeltas: ReadonlyArray<DemoMapTileWordDelta> | undefined,
  mapHeight: number,
): Patch | null {
  if (mapTileWordDeltas === undefined || mapTileWordDeltas.length === 0) {
    return null;
  }

  const patchLength = mapTileWordDeltas.length;
  const index = new Uint32Array(patchLength);
  for (let cursor = 0; cursor < patchLength; cursor += 1) {
    const delta = mapTileWordDeltas[cursor];
    if (delta === undefined) {
      continue;
    }
    index[cursor] = delta.x * mapHeight + delta.y;
  }

  return {
    layer: 'map',
    index,
    prev: new Uint16Array(patchLength),
    next: new Uint16Array(patchLength),
  };
}

/**
 * Converts one sim-core redraw plan to the Playable Runtime host payload contract.
 * Mirrors invalidation plan metadata generated by `planMapRedraw` in
 * `packages/sim-core/src/core/map-invalidation.ts`.
 * Parity note: this is a shape conversion only; redraw policy decisions stay
 * in sim-core.
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
 * Difference: Playable Runtime uses a compact local subset instead of full resource tables.
 */
function messageTextForId(id: number): string {
  const text = RUNTIME_MESSAGE_TEXT[id];
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
 * Applies one Playable Runtime tool command to the local demo map and returns changed
 * tiles for a host `patch` envelope.
 * Mirrors placement footprint rules from `ref/micropolis/src/sim/w_tool.c`
 * (`toolSize[]`, `toolOffset[]`, and multi-tile stamp shapes for 3x3/4x4/6x6 tools).
 * Difference: this uses synthetic debug tile ids and does not run simulation.
 */
function applyDemoToolCommand(
  tiles: Uint16Array,
  width: number,
  height: number,
  command: PlayableToolCommand,
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

  if (command.tool === 'query') {
    return { accepted: true, deltas };
  }

  if (command.tool === 'wire') {
    return {
      accepted: true,
      deltas: applyDemoWireToolCommand(tiles, width, height, command.x, command.y),
    };
  }

  if (AREA_STAMP_TOOLS.has(command.tool)) {
    for (let yy = startY; yy < endY; yy += 1) {
      for (let xx = startX; xx < endX; xx += 1) {
        const index = yy * width + xx;
        const tileWord = tiles[index] ?? 0;
        if (!canPlaceDemoZoneOnTile(tileWord)) {
          return { accepted: false, reason: 'invalid-placement' };
        }
      }
    }

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
 * Zone placement terrain gate used by the demo host tool path.
 * Mirrors the `check3x3` + `tally` interaction in `ref/micropolis/src/sim/w_tool.c`:
 * deep water tiles (`RIVER`, `REDGE`, `CHANNEL`) are never auto-bulldozable and
 * therefore reject zone placement.
 * Difference: demo host intentionally keeps other occupancy checks permissive.
 */
function canPlaceDemoZoneOnTile(tileWord: number): boolean {
  const tileId = tileWord & TileMask.LOMASK;
  return tileId !== Tile.RIVER && tileId !== Tile.REDGE && tileId !== Tile.CHANNEL;
}

/**
 * Applies one wire placement and rebuilds local wire connectivity.
 * Mirrors `_FixZone` + `_FixSingle` cleanup for wire tiles in
 * `ref/micropolis/src/sim/w_con.c` using `_WireTable` adjacency mapping.
 * Parity note: demo map tiles may be stored without `CONDBIT`, so this treats
 * bare conductive tile ids as connectable in addition to `CONDBIT`-flagged
 * words to keep browser-stage wire visuals coherent.
 */
function applyDemoWireToolCommand(
  tiles: Uint16Array,
  width: number,
  height: number,
  x: number,
  y: number,
): DemoMapTileWordDelta[] {
  const fixupCoords = collectDemoWireFixupCoordinates(width, height, x, y);
  const previousTileWordByIndex = new Map<number, number>();
  for (const coord of fixupCoords) {
    const index = coord.y * width + coord.x;
    previousTileWordByIndex.set(index, tiles[index] ?? 0);
  }

  const centerIndex = y * width + x;
  tiles[centerIndex] = TOOL_TILE_VALUES.wire;
  for (const coord of fixupCoords) {
    fixDemoWireTileAt(tiles, width, height, coord.x, coord.y);
  }

  const deltas: DemoMapTileWordDelta[] = [];
  for (const coord of fixupCoords) {
    const index = coord.y * width + coord.x;
    const previousTileWord = previousTileWordByIndex.get(index) ?? 0;
    const nextTileWord = tiles[index] ?? 0;
    if (previousTileWord === nextTileWord) {
      continue;
    }
    deltas.push({
      x: coord.x,
      y: coord.y,
      tileWord: nextTileWord,
    });
  }
  return deltas;
}

/**
 * Collects the wire fixup neighborhood for one placement.
 * Mirrors `_FixZone` visit order in `ref/micropolis/src/sim/w_con.c`:
 * center, north, east, south, west.
 */
function collectDemoWireFixupCoordinates(
  width: number,
  height: number,
  x: number,
  y: number,
): ReadonlyArray<Readonly<{ x: number; y: number }>> {
  const coords: Array<{ x: number; y: number }> = [{ x, y }];
  if (y > 0) {
    coords.push({ x, y: y - 1 });
  }
  if (x < width - 1) {
    coords.push({ x: x + 1, y });
  }
  if (y < height - 1) {
    coords.push({ x, y: y + 1 });
  }
  if (x > 0) {
    coords.push({ x: x - 1, y });
  }
  return coords;
}

/**
 * Rebuilds one wire tile by cardinal-neighbor adjacency.
 * Mirrors the wire branch in `_FixSingle` from `ref/micropolis/src/sim/w_con.c`,
 * including direction-specific exclusions for `HPOWER`/`VPOWER`,
 * `HROADPOWER`/`VROADPOWER`, and `RAILHPOWERV`/`RAILVPOWERH`.
 */
function fixDemoWireTileAt(
  tiles: Uint16Array,
  width: number,
  height: number,
  x: number,
  y: number,
): void {
  const index = y * width + x;
  const tileWord = tiles[index] ?? 0;
  const normalizedTile = normalizeDemoRoadLikeC(tileWord);
  if (
    normalizedTile < DEMO_WIRE_REBUILD_MIN_TILE_ID ||
    normalizedTile > DEMO_WIRE_REBUILD_MAX_TILE_ID
  ) {
    return;
  }

  let adjacency = 0;
  if (
    y > 0 &&
    isDemoWireNeighborConnected({
      tileWord: tiles[(y - 1) * width + x] ?? 0,
      axis: 'vertical',
    })
  ) {
    adjacency |= 0x0001;
  }
  if (
    x < width - 1 &&
    isDemoWireNeighborConnected({
      tileWord: tiles[y * width + (x + 1)] ?? 0,
      axis: 'horizontal',
    })
  ) {
    adjacency |= 0x0002;
  }
  if (
    y < height - 1 &&
    isDemoWireNeighborConnected({
      tileWord: tiles[(y + 1) * width + x] ?? 0,
      axis: 'vertical',
    })
  ) {
    adjacency |= 0x0004;
  }
  if (
    x > 0 &&
    isDemoWireNeighborConnected({
      tileWord: tiles[y * width + (x - 1)] ?? 0,
      axis: 'horizontal',
    })
  ) {
    adjacency |= 0x0008;
  }

  const rebuiltWireTile = WIRE_TABLE[adjacency];
  if (rebuiltWireTile === undefined) {
    throw new Error(`Missing wire adjacency mapping for index ${adjacency}`);
  }
  tiles[index] = rebuiltWireTile;
}

/**
 * Checks whether one neighboring tile contributes wire connectivity.
 * Mirrors `_FixSingle` wire-neighbor tests in `ref/micropolis/src/sim/w_con.c`:
 * only conductive neighbors are considered, then direction-specific exclusions
 * filter out incompatible straight-through variants.
 */
function isDemoWireNeighborConnected({
  tileWord,
  axis,
}: Readonly<{
  tileWord: number;
  axis: 'vertical' | 'horizontal';
}>): boolean {
  const normalizedNeighborTile = normalizeDemoRoadLikeC(tileWord);
  if (!isDemoConductiveTileWord(tileWord, normalizedNeighborTile)) {
    return false;
  }

  if (axis === 'vertical') {
    return (
      normalizedNeighborTile !== Tile.VPOWER &&
      normalizedNeighborTile !== Tile.VROADPOWER &&
      normalizedNeighborTile !== Tile.RAILVPOWERH
    );
  }

  return (
    normalizedNeighborTile !== Tile.HPOWER &&
    normalizedNeighborTile !== Tile.HROADPOWER &&
    normalizedNeighborTile !== Tile.RAILHPOWERV
  );
}

/**
 * Determines whether one tile participates in power conductivity checks.
 * Mirrors `_FixSingle` `if (Tile & CONDBIT)` behavior in
 * `ref/micropolis/src/sim/w_con.c`.
 * Parity note: demo writes often omit high-bit flags, so this also recognizes
 * bare conductive tile ids in the power/road-power/rail-power families.
 */
function isDemoConductiveTileWord(tileWord: number, normalizedTile: number): boolean {
  if ((tileWord & TileFlag.CONDBIT) !== 0) {
    return true;
  }

  return (
    (normalizedTile >= Tile.HPOWER && normalizedTile <= Tile.RAILVPOWERH) ||
    normalizedTile === Tile.HROADPOWER ||
    normalizedTile === Tile.VROADPOWER
  );
}

/**
 * Applies C road neutralization before adjacency checks.
 * Mirrors `NeutralizeRoad(Tile)` macro in `ref/micropolis/src/sim/w_con.c`,
 * where road variants in `[64, 207]` are normalized to base nibble forms.
 */
function normalizeDemoRoadLikeC(tileWord: number): number {
  let tile = tileWord & 0xffff;
  if (tile >= Tile.ROADBASE && tile <= Tile.LASTROAD) {
    tile = (tile & 0x000f) + Tile.ROADBASE;
  }
  return tile;
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
 * Computes coordinate-addressed tile deltas between two runtime row-major map buffers.
 * Mirrors patch payload coordinate ownership used by `DoUpdateMap` in
 * `ref/micropolis/src/sim/w_map.c`, while preserving Playable Runtime row-major
 * storage in this host adapter.
 */
function buildRuntimeMapTileWordDeltas(
  previousTiles: Uint16Array,
  nextTiles: Uint16Array,
  width: number,
  height: number,
): DemoMapTileWordDelta[] | undefined {
  const deltas: DemoMapTileWordDelta[] = [];
  for (let index = 0; index < nextTiles.length; index += 1) {
    const previousTileWord = previousTiles[index] ?? 0;
    const nextTileWord = nextTiles[index] ?? 0;
    if (previousTileWord === nextTileWord) {
      continue;
    }

    const y = Math.trunc(index / width);
    const x = index - y * width;
    if (x < 0 || x >= width || y < 0 || y >= height) {
      continue;
    }

    deltas.push({
      x,
      y,
      tileWord: nextTileWord,
    });
  }

  return deltas.length > 0 ? deltas : undefined;
}

/**
 * Applies one `animateTiles` pass to the runtime row-major map tile buffer.
 * Mirrors `animateTiles` in `ref/micropolis/src/sim/g_ani.c` using
 * `aniTile[]` from `ref/micropolis/src/sim/animtab.h`: if `ANIMBIT` is set,
 * preserve high bits (`ALLBITS`) and rewrite low tile-id bits (`LOMASK`) via
 * the animation lookup table.
 * Difference: this mutates the Playable Runtime host row-major runtime buffer, while C
 * mutates classic `Map[x][y]` x-major storage.
 */
function animateRuntimeMapTilesLikeC(
  tiles: Uint16Array,
  width: number,
  height: number,
  doAnimation: boolean,
): DemoMapTileWordDelta[] | undefined {
  if (!doAnimation) {
    return undefined;
  }

  const deltas: DemoMapTileWordDelta[] = [];
  for (let index = 0; index < tiles.length; index += 1) {
    const tileWord = tiles[index] ?? 0;
    if ((tileWord & TileFlag.ANIMBIT) === 0) {
      continue;
    }

    const flags = tileWord & TileMask.ALLBITS;
    const tileId = tileWord & TileMask.LOMASK;
    const nextTileId = ANI_TILE[tileId] ?? tileId;
    const nextTileWord = nextTileId | flags;
    if (nextTileWord === tileWord) {
      continue;
    }

    tiles[index] = nextTileWord;
    const y = Math.trunc(index / width);
    const x = index - y * width;
    if (x < 0 || x >= width || y < 0 || y >= height) {
      continue;
    }
    deltas.push({
      x,
      y,
      tileWord: nextTileWord,
    });
  }

  return deltas.length > 0 ? deltas : undefined;
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
 * Difference: Playable Runtime host runtime map is row-major for canvas convenience.
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
 * Builds an initial deterministic tile baseline for the Playable Runtime debug map view.
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
