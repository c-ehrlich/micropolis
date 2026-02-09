import { getCoreBridgeV1SnapshotTileIndex } from '../../../../../packages/core-bridge/src/types.ts';
import {
  runUiUpdate,
  sendMessages,
  setValves,
  type SimContext,
  type SimState,
} from '../../../../../packages/sim-core/src/index.ts';
import {
  applyLoadNormalization,
  createCityFile,
  decodeCityFileForMap,
  encodeCityFile,
  readCityMeta,
  writeCityMeta,
} from '../../../../../packages/sim-core/src/io/cty.ts';
import { setFunds } from '../../../../../packages/sim-core/src/systems/funds.ts';
import { deriveCityNameFromPath } from '../../../../../packages/sim-io/src/load.ts';
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
  type Stage2SimSpeed,
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
 * `ref/micropolis/src/sim/s_fileio.c` (1:1 metadata), while map payloads stay
 * scripted in this LocalHost demo.
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
  private readonly simState: SimState;
  private readonly simContext: SimContext;
  private onEnvelope: ((envelope: HostEnvelope) => void) | undefined;
  private intervalHandle: ReturnType<typeof setInterval> | undefined;
  private serverSeq = 0;
  private tick = 0;
  private hookTickCount = 0;
  private simPaused = false;
  private simPausedSpeed = 3;
  private cityFileName: string | null = DEMO_DEFAULT_CITY_FILE_NAME;
  private cityName = DEMO_DEFAULT_CITY_NAME;
  private currentScenarioId = 0;
  private readonly hookHudState: HookDrivenHudState = createInitialHookDrivenHudState();
  private pendingHookMessages: DemoHudMessagePayload[] = [];
  private readonly mapTiles = buildInitialDemoMapTiles(DEMO_WORLD_WIDTH, DEMO_WORLD_HEIGHT);
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
    const authorityState = new Stage4SimCoreAuthorityState({
      hooks: {
        tickCount: () => this.hookTickCount,
        uiSet: (key, value) => this.captureUiSet(key, value),
        sendMes: (id) => this.captureMessage(id),
        sendMesAt: (id, x, y) => this.captureMessageAt(id, x, y),
      },
    });
    this.simState = authorityState.simState;
    this.simContext = authorityState.simContext;
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
      this.onEnvelope({
        kind: 'hello',
        roomId: envelope.roomId,
        clientId: envelope.clientId,
        protocolVersion: envelope.protocolVersion,
        coreVersion: envelope.coreVersion,
        accepted: true,
      });

      this.emitSnapshot(envelope.roomId, envelope.clientId);
      this.startInterval(envelope.roomId, envelope.clientId);
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

    if (isStage2CityLifecycleCommand(envelope.command)) {
      this.handleCityLifecycleCommand(envelope.roomId, envelope.clientId, envelope.commandId);
      return;
    }

    if (isStage2CityIoCommand(envelope.command)) {
      this.handleCityIoCommand(
        envelope.roomId,
        envelope.clientId,
        envelope.commandId,
        envelope.command,
      );
      return;
    }

    if (isStage2ScenarioCommand(envelope.command)) {
      this.handleScenarioCommand(
        envelope.roomId,
        envelope.clientId,
        envelope.commandId,
        envelope.command,
      );
      return;
    }

    const reason = 'invalid-command';
    this.commandOutcomes.set(envelope.commandId, { kind: 'reject', reason });
    this.emitReject(envelope.roomId, envelope.clientId, envelope.commandId, reason);
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

    const payload: DemoPatchPayload = {
      hud: this.getHudHeadsPayload(),
    };

    if (placement.deltas.length > 0) {
      payload.map = {
        tileWordDeltas: placement.deltas,
      };
    }
    const hookMessages = this.drainPendingHookMessages();
    if (hookMessages.length > 0) {
      payload.messageDeltas = hookMessages;
    }

    this.emitPatch(envelope.roomId, envelope.clientId, payload);
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
    this.applySimControl(command);
    this.refreshHookDrivenHud();

    this.commandOutcomes.set(envelope.commandId, { kind: 'ack' });
    this.emitAck(envelope.roomId, envelope.clientId, envelope.commandId);
    const payload: DemoPatchPayload = {
      hud: this.getHudHeadsPayload(),
    };
    const hookMessages = this.drainPendingHookMessages();
    if (hookMessages.length > 0) {
      payload.messageDeltas = hookMessages;
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
    this.cityFileName = fileName;
    this.cityName = deriveCityNameFromPath(fileName);

    const cityBytes = this.encodeCurrentCityFile();

    this.commandOutcomes.set(commandId, { kind: 'ack' });
    this.emitAck(roomId, clientId, commandId);
    this.emitPatch(roomId, clientId, {
      cityIo: {
        save: {
          fileName,
          cityName: this.cityName,
          cityBytes,
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
    const loaded = tryDecodeImportedCity(command.cityBytes);
    if (loaded === null) {
      const reason = 'invalid-city-file';
      this.commandOutcomes.set(commandId, { kind: 'reject', reason });
      this.emitReject(roomId, clientId, commandId, reason);
      return;
    }

    const fileName = sanitizeCityFileName(command.fileName);
    this.cityFileName = fileName;
    this.cityName = deriveCityNameFromPath(fileName);
    this.currentScenarioId = 0;

    this.mapTiles.set(loaded.mapTiles);
    this.applyLoadedSimulationMeta(loaded);

    this.resetMessageLog(`Loaded ${this.cityName}.`);

    this.commandOutcomes.set(commandId, { kind: 'ack' });
    this.emitAck(roomId, clientId, commandId);
    this.emitSnapshot(roomId, clientId);
  }

  /**
   * Applies scenario start through host authority.
   * Mirrors `LoadScenario` constants in `ref/micropolis/src/sim/s_fileio.c`.
   * Difference: this Stage 2 demo uses deterministic synthetic map seeding
   * instead of loading `snro.*` map resources.
   */
  private handleScenarioCommand(
    roomId: string,
    clientId: string,
    commandId: string,
    command: Stage2LoadScenarioCommand,
  ): void {
    const scenario = getScenarioDefinition(command.scenarioId);
    this.currentScenarioId = scenario.id;
    this.cityName = scenario.name;
    this.cityFileName = `${scenario.fileName}.cty`;
    this.applyScenarioSimulationMeta(scenario.startCityTime, scenario.startFunds);

    const scenarioMap = buildScenarioDemoMapTiles(scenario.id, DEMO_WORLD_WIDTH, DEMO_WORLD_HEIGHT);
    this.mapTiles.set(scenarioMap);
    this.resetMessageLog(`Scenario: ${scenario.name} (${scenario.startYear})`);

    this.commandOutcomes.set(commandId, { kind: 'ack' });
    this.emitAck(roomId, clientId, commandId);
    this.emitSnapshot(roomId, clientId);
  }

  /**
   * Emits an authoritative snapshot baseline with map + HUD + message feed.
   * Mirrors full refresh intent in `ref/micropolis/src/sim/w_update.c`.
   */
  private emitSnapshot(roomId: string, clientId: string): void {
    if (this.onEnvelope === undefined) {
      return;
    }

    const snapshotServerSeq = this.serverSeq + 1;
    const pendingMessages = this.drainPendingHookMessages();
    if (pendingMessages.length > 0) {
      this.recordMessages(pendingMessages, this.tick, snapshotServerSeq);
    }
    this.ensureMessageLogReplayMetadata(this.tick, snapshotServerSeq);
    this.serverSeq = snapshotServerSeq;
    this.onEnvelope({
      kind: 'snapshot',
      roomId,
      clientId,
      tick: this.tick,
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
        realtime: {
          objects: [],
        },
        messages: this.messageLog,
      },
    });
  }

  /**
   * Emits a command `ack` envelope.
   * Mirrors successful command completion signaling in
   * `ref/micropolis/src/sim/w_sim.c`.
   */
  private emitAck(roomId: string, clientId: string, commandId: string): void {
    if (this.onEnvelope === undefined) {
      return;
    }

    this.serverSeq += 1;
    this.onEnvelope({
      kind: 'ack',
      roomId,
      clientId,
      tick: this.tick,
      serverSeq: this.serverSeq,
      commandId,
    });
  }

  /**
   * Emits a command `reject` envelope.
   * Mirrors expected-denial command results in `ref/micropolis/src/sim/w_sim.c`.
   */
  private emitReject(roomId: string, clientId: string, commandId: string, reason: string): void {
    if (this.onEnvelope === undefined) {
      return;
    }

    this.serverSeq += 1;
    this.onEnvelope({
      kind: 'reject',
      roomId,
      clientId,
      tick: this.tick,
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

    this.hookTickCount += 1;
    this.simContext.store.beginTick();
    try {
      this.simState.CityTime += 1;
      setValves(this.simState, this.simContext);
      sendMessages(this.simState, this.simContext);
      runUiUpdate(this.simState, this.simContext);
    } finally {
      this.simContext.store.commitTick();
    }

    this.tick += 1;

    const payload: DemoPatchPayload = {
      hud: this.getHudHeadsPayload(),
    };

    const hookMessages = this.drainPendingHookMessages();
    if (hookMessages.length > 0) {
      payload.messageDeltas = hookMessages;
    }

    this.emitPatch(roomId, clientId, payload);
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
   */
  private applySimControl(command: Stage2SimControlCommand): void {
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
   * Pause semantics for Stage 2 host sim controls.
   * Mirrors `Pause()` in `ref/micropolis/src/sim/w_util.c`.
   */
  private pauseSimulation(): void {
    if (this.simPaused) {
      return;
    }
    this.simPausedSpeed = normalizePlayableSpeed(this.simState.SimMetaSpeed);
    this.setSimulationSpeed(0);
    this.simPaused = true;
  }

  /**
   * Resume semantics for Stage 2 host sim controls.
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
   * Speed semantics for Stage 2 host sim controls.
   * Mirrors `setSpeed(short)` in `ref/micropolis/src/sim/w_util.c`.
   */
  private setSimulationSpeed(candidate: number): void {
    let speed = normalizePlayableSpeed(candidate);
    this.simState.SimMetaSpeed = speed;

    if (this.simPaused) {
      this.simPausedSpeed = this.simState.SimMetaSpeed;
      speed = 0;
    }

    this.simState.SimSpeed = speed;
  }

  /**
   * Applies decoded `.cty` scalar state into authoritative sim-core HUD controls.
   * Mirrors `loadFile` scalar restoration in `ref/micropolis/src/sim/s_fileio.c`,
   * then refreshes heads via the `DoUpdateHeads` pathway.
   * Parity note: map tile restoration still follows Stage 2 demo map ownership.
   */
  private applyLoadedSimulationMeta(loaded: DecodedDemoCity): void {
    this.simState.CityTime = loaded.cityTime;
    setFunds(this.simState, loaded.totalFunds);
    this.simState.CityTax = loaded.cityTax;
    this.simState.autoBudget = loaded.autoBudget;
    this.simState.autoGo = loaded.autoGo;
    this.simState.autoBulldoze = loaded.autoBulldoze;
    this.simState.userSoundOn = loaded.userSoundOn;
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
    this.setSimulationSpeed(loaded.simMetaSpeed);
    if (loaded.paused) {
      this.pauseSimulation();
    }

    this.pendingHookMessages = [];
    this.refreshHookDrivenHud();
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
    this.refreshHookDrivenHud();
  }

  /**
   * Resets Stage 2 host state to a new-city baseline.
   * Mirrors `DoNewCity` reset intent in `ref/micropolis/src/sim/s_init.c`.
   * Parity note: map regeneration remains deterministic/demo-scripted here.
   */
  private resetToNewCity(): void {
    this.currentScenarioId = 0;
    this.applyScenarioSimulationMeta(0, DEMO_INITIAL_FUNDS);
    this.cityFileName = DEMO_DEFAULT_CITY_FILE_NAME;
    this.cityName = DEMO_DEFAULT_CITY_NAME;
    this.mapTiles.set(buildInitialDemoMapTiles(DEMO_WORLD_WIDTH, DEMO_WORLD_HEIGHT));
    this.resetMessageLog('Started a new city.');
  }

  private encodeCurrentCityFile(): Uint8Array {
    const city = createCityFile({ width: DEMO_WORLD_WIDTH, height: DEMO_WORLD_HEIGHT });
    city.map.set(this.mapTiles);
    writeCityMeta(city.misc, {
      cityTime: Math.max(0, Math.trunc(this.simState.CityTime)),
      totalFunds: Math.max(0, Math.trunc(this.simState.TotalFunds)),
      autoBulldoze: this.simState.autoBulldoze,
      autoBudget: this.simState.autoBudget,
      autoGo: this.simState.autoGo,
      userSoundOn: this.simState.userSoundOn,
      cityTax: this.simState.CityTax,
      simSpeed: this.getVisibleSpeed(),
      policePercent: 1,
      firePercent: 1,
      roadPercent: 1,
    });
    return encodeCityFile(city);
  }
}

type DecodedDemoCity = {
  mapTiles: Uint16Array;
  cityTime: number;
  totalFunds: number;
  cityTax: number;
  paused: boolean;
  simMetaSpeed: Stage2SimSpeed;
  autoBudget: boolean;
  autoGo: boolean;
  autoBulldoze: boolean;
  userSoundOn: boolean;
};

function tryDecodeImportedCity(cityBytes: Uint8Array): DecodedDemoCity | null {
  try {
    const city = decodeCityFileForMap(cityBytes, {
      width: DEMO_WORLD_WIDTH,
      height: DEMO_WORLD_HEIGHT,
    });
    const normalized = applyLoadNormalization(readCityMeta(city.misc));
    const speed = normalized.simSpeed < 1 ? 3 : clampPlayableSpeed(normalized.simSpeed);

    return {
      mapTiles: city.map.slice(),
      cityTime: normalized.cityTime,
      totalFunds: normalized.totalFunds,
      cityTax: normalized.cityTax,
      paused: normalized.simSpeed <= 0,
      simMetaSpeed: speed,
      autoBudget: normalized.autoBudget,
      autoGo: normalized.autoGo,
      autoBulldoze: normalized.autoBulldoze,
      userSoundOn: normalized.userSoundOn,
    };
  } catch {
    return null;
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

function clampPlayableSpeed(value: number): Stage2SimSpeed {
  if (value <= 1) {
    return 1;
  }
  if (value >= 3) {
    return 3;
  }
  return 2;
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
 * Builds a deterministic per-scenario map seed for the Stage 2 demo host.
 * Mirrors `LoadScenario` city reset intent in `ref/micropolis/src/sim/s_fileio.c`.
 * Difference: map bytes are synthetic in this Stage 2 scripted host and do not
 * match Micropolis `snro.*` payloads 1:1.
 */
function buildScenarioDemoMapTiles(scenarioId: number, width: number, height: number): Uint16Array {
  const tiles = new Uint16Array(width * height);
  const salt = (scenarioId & 0xff) << 8;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const band = ((x + scenarioId * 5) >> 2) & 63;
      const stripe = ((y + scenarioId * 7) >> 1) & 63;
      tiles[index] = (salt | (band << 3) | stripe) & 0xffff;
    }
  }
  return tiles;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
