import { getCoreBridgeV1SnapshotTileIndex } from '../../../../../packages/core-bridge/src/types.ts';
import {
  applyLoadNormalization,
  createCityFile,
  decodeCityFileForMap,
  encodeCityFile,
  readCityMeta,
  writeCityMeta,
} from '../../../../../packages/sim-core/src/io/cty.ts';
import { deriveCityNameFromPath } from '../../../../../packages/sim-io/src/load.ts';
import {
  getScenarioDefinition,
  SCENARIO_TABLE,
  type ScenarioDefinition,
} from '../../../../../packages/sim-io/src/scenarios.ts';
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
const DEMO_STARTING_YEAR = 1900;
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

const DATE_STRINGS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

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
 * Difference: this remains a scripted LocalHost demo and intentionally does not
 * run full `sim-core` ticking/parity systems yet.
 */
export class DemoMapHost implements CoreHost {
  private readonly enableAmbientTicks: boolean;
  private readonly patchIntervalMs: number;
  private onEnvelope: ((envelope: HostEnvelope) => void) | undefined;
  private intervalHandle: ReturnType<typeof setInterval> | undefined;
  private serverSeq = 0;
  private tick = 0;
  private cityTime = 0;
  private rngState = 0x12345678;
  private totalFunds = DEMO_INITIAL_FUNDS;
  private simMetaSpeed: Stage2SimSpeed = 3;
  private paused = false;
  private speedCycle = 0;
  private cityTax = 7;
  private autoBudget = DEMO_DEFAULT_AUTO_BUDGET;
  private autoGo = DEMO_DEFAULT_AUTO_GO;
  private autoBulldoze = DEMO_DEFAULT_AUTO_BULLDOZE;
  private userSoundOn = DEMO_DEFAULT_USER_SOUND_ON;
  private doAnimation = DEMO_DEFAULT_DO_ANIMATION;
  private doMessages = DEMO_DEFAULT_DO_MESSAGES;
  private doNotices = DEMO_DEFAULT_DO_NOTICES;
  private disasters = DEMO_DEFAULT_DISASTERS;
  private cityFileName: string | null = DEMO_DEFAULT_CITY_FILE_NAME;
  private cityName = DEMO_DEFAULT_CITY_NAME;
  private currentScenarioId = 0;
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
    if (this.totalFunds - toolCost < 0) {
      const reason = 'insufficient-funds';
      this.commandOutcomes.set(envelope.commandId, { kind: 'reject', reason });
      this.emitReject(envelope.roomId, envelope.clientId, envelope.commandId, reason);
      return;
    }

    this.totalFunds -= toolCost;
    this.commandOutcomes.set(envelope.commandId, { kind: 'ack' });
    this.emitAck(envelope.roomId, envelope.clientId, envelope.commandId);

    const payload: DemoPatchPayload = {
      hud: {
        funds: this.totalFunds,
        fundsLabel: formatFundsLabel(this.totalFunds),
        options: this.getHudOptionsHeads(),
      },
    };

    if (placement.deltas.length > 0) {
      payload.map = {
        tileWordDeltas: placement.deltas,
      };
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

    this.commandOutcomes.set(envelope.commandId, { kind: 'ack' });
    this.emitAck(envelope.roomId, envelope.clientId, envelope.commandId);
    this.emitPatch(envelope.roomId, envelope.clientId, {
      hud: {
        speed: this.getVisibleSpeed(),
        options: this.getHudOptionsHeads(),
      },
    });
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
    this.cityTime = loaded.cityTime;
    this.totalFunds = loaded.totalFunds;
    this.cityTax = loaded.cityTax;
    this.paused = loaded.paused;
    this.simMetaSpeed = loaded.simMetaSpeed;
    this.autoBudget = loaded.autoBudget;
    this.autoGo = loaded.autoGo;
    this.autoBulldoze = loaded.autoBulldoze;
    this.userSoundOn = loaded.userSoundOn;
    this.doAnimation = DEMO_DEFAULT_DO_ANIMATION;
    this.doMessages = DEMO_DEFAULT_DO_MESSAGES;
    this.doNotices = DEMO_DEFAULT_DO_NOTICES;
    this.disasters = DEMO_DEFAULT_DISASTERS;
    this.speedCycle = 0;

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
    this.cityTime = scenario.startCityTime;
    this.totalFunds = scenario.startFunds;
    this.simMetaSpeed = 3;
    this.paused = false;
    this.speedCycle = 0;
    this.cityTax = 7;
    this.autoBudget = DEMO_DEFAULT_AUTO_BUDGET;
    this.autoGo = DEMO_DEFAULT_AUTO_GO;
    this.autoBulldoze = DEMO_DEFAULT_AUTO_BULLDOZE;
    this.userSoundOn = DEMO_DEFAULT_USER_SOUND_ON;
    this.doAnimation = DEMO_DEFAULT_DO_ANIMATION;
    this.doMessages = DEMO_DEFAULT_DO_MESSAGES;
    this.doNotices = DEMO_DEFAULT_DO_NOTICES;
    this.disasters = DEMO_DEFAULT_DISASTERS;

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
          funds: this.totalFunds,
          fundsLabel: formatFundsLabel(this.totalFunds),
          date: computeDemoDateHeads(this.cityTime),
          demand: computeDemoDemandHeads(this.tick),
          speed: this.getVisibleSpeed(),
          options: this.getHudOptionsHeads(),
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
    if (!this.shouldAdvanceSimulation()) {
      return;
    }

    this.tick += 1;
    this.cityTime += 1;

    let fundsChanged = false;
    if ((this.cityTime & 15) === 0) {
      this.totalFunds += this.simMetaSpeed;
      fundsChanged = true;
    }

    const payload: DemoPatchPayload = {
      hud: {
        funds: this.totalFunds,
        date: computeDemoDateHeads(this.cityTime),
        demand: computeDemoDemandHeads(this.tick),
        speed: this.getVisibleSpeed(),
        options: this.getHudOptionsHeads(),
      },
    };

    if (fundsChanged) {
      if (payload.hud === undefined) {
        payload.hud = {};
      }
      payload.hud.fundsLabel = formatFundsLabel(this.totalFunds);
    }

    const ambientMessage = this.createAmbientMessage();
    if (ambientMessage !== null) {
      payload.messageDeltas = [ambientMessage];
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
   * Returns whether the next interval should advance simulation work.
   * Mirrors `SimFrame` speed gating in `ref/micropolis/src/sim/s_sim.c`:
   * speed 0 pauses, speed 1 runs every 5th cycle, speed 2 every 3rd cycle,
   * speed 3 runs each cycle.
   */
  private shouldAdvanceSimulation(): boolean {
    if (this.paused) {
      return false;
    }

    this.speedCycle = (this.speedCycle + 1) & 0xffff;
    if (this.simMetaSpeed === 1 && this.speedCycle % 5 !== 0) {
      return false;
    }

    if (this.simMetaSpeed === 2 && this.speedCycle % 3 !== 0) {
      return false;
    }

    return true;
  }

  /**
   * Creates an occasional deterministic message event for the Stage 2 feed/log.
   * Mirrors threshold-driven message feed behavior in
   * `ref/micropolis/src/sim/s_msg.c`.
   * Difference: this emits from a scripted cadence rather than full sim thresholds.
   */
  private createAmbientMessage(): DemoHudMessagePayload | null {
    if ((this.cityTime & 31) !== 0) {
      return null;
    }

    const candidates = [1, 2, 3, 4, 5, 6, 13, 14, 16, 17, 18, 19, -10, -11, -12];
    const index = this.nextRandom() % candidates.length;
    const id = candidates[index];
    if (id === undefined) {
      return null;
    }

    return {
      id,
      text: messageTextForId(id),
    };
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
   * Reads visible UI speed value.
   * Mirrors `UISetSpeed` behavior in `ref/micropolis/src/sim/w_util.c`, where
   * paused mode reports speed 0 while preserving remembered meta speed.
   */
  private getVisibleSpeed(): number {
    return this.paused ? 0 : this.simMetaSpeed;
  }

  /**
   * Returns current options heads payload for HUD projection.
   * Mirrors option booleans emitted by `updateOptions` / `UISetOptions` in
   * `ref/micropolis/src/sim/w_update.c`.
   */
  private getHudOptionsHeads(): HostHudOptionsPayload {
    return {
      autoBudget: this.autoBudget,
      autoGo: this.autoGo,
      autoBulldoze: this.autoBulldoze,
      disasters: this.disasters,
      userSoundOn: this.userSoundOn,
      doAnimation: this.doAnimation,
      doMessages: this.doMessages,
      doNotices: this.doNotices,
    };
  }

  /**
   * Sets paused state and remembered speed metadata.
   * Mirrors `Pause`/`Resume`/`setSpeed` interactions from
   * `ref/micropolis/src/sim/w_util.c`.
   */
  private applySimControl(command: Stage2SimControlCommand): void {
    if (command.control === 'pause') {
      this.paused = true;
      return;
    }

    if (command.control === 'play') {
      this.paused = false;
      return;
    }

    this.simMetaSpeed = command.speed;
    this.paused = false;
  }

  /**
   * Deterministic pseudo-random generator for host-side scripted updates.
   * Mirrors the fixed-seed deterministic run style used throughout Micropolis.
   */
  private nextRandom(): number {
    this.rngState = (Math.imul(this.rngState, 1103515245) + 12345) >>> 0;
    return this.rngState;
  }

  private resetToNewCity(): void {
    this.currentScenarioId = 0;
    this.cityTime = 0;
    this.totalFunds = DEMO_INITIAL_FUNDS;
    this.simMetaSpeed = 3;
    this.paused = false;
    this.speedCycle = 0;
    this.cityTax = 7;
    this.autoBudget = DEMO_DEFAULT_AUTO_BUDGET;
    this.autoGo = DEMO_DEFAULT_AUTO_GO;
    this.autoBulldoze = DEMO_DEFAULT_AUTO_BULLDOZE;
    this.userSoundOn = DEMO_DEFAULT_USER_SOUND_ON;
    this.doAnimation = DEMO_DEFAULT_DO_ANIMATION;
    this.doMessages = DEMO_DEFAULT_DO_MESSAGES;
    this.doNotices = DEMO_DEFAULT_DO_NOTICES;
    this.disasters = DEMO_DEFAULT_DISASTERS;
    this.cityFileName = DEMO_DEFAULT_CITY_FILE_NAME;
    this.cityName = DEMO_DEFAULT_CITY_NAME;
    this.mapTiles.set(buildInitialDemoMapTiles(DEMO_WORLD_WIDTH, DEMO_WORLD_HEIGHT));
    this.resetMessageLog('Started a new city.');
  }

  private encodeCurrentCityFile(): Uint8Array {
    const city = createCityFile({ width: DEMO_WORLD_WIDTH, height: DEMO_WORLD_HEIGHT });
    city.map.set(this.mapTiles);
    writeCityMeta(city.misc, {
      cityTime: Math.max(0, Math.trunc(this.cityTime)),
      totalFunds: Math.max(0, Math.trunc(this.totalFunds)),
      autoBulldoze: this.autoBulldoze,
      autoBudget: this.autoBudget,
      autoGo: this.autoGo,
      userSoundOn: this.userSoundOn,
      cityTax: this.cityTax,
      simSpeed: this.getVisibleSpeed(),
      policePercent: 1,
      firePercent: 1,
      roadPercent: 1,
    });
    return encodeCityFile(city);
  }
}

function tryDecodeImportedCity(cityBytes: Uint8Array): {
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
} | null {
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
 * Computes deterministic demand head values in the visible -15..15 range.
 * Mirrors `SetDemand` output range from `ref/micropolis/src/sim/w_update.c`
 * where demand is emitted as integer valve/100 values.
 */
function computeDemoDemandHeads(tick: number): { r: number; c: number; i: number } {
  return {
    r: ((tick * 5) % 31) - 15,
    c: ((tick * 3 + 7) % 31) - 15,
    i: ((tick * 2 + 11) % 31) - 15,
  };
}

/**
 * Computes date label/month/year from CityTime.
 * Mirrors `updateDate` calculations in `ref/micropolis/src/sim/w_update.c`:
 * `y = (CityTime / 48) + StartingYear` and `m = (CityTime % 48) >> 2`.
 */
function computeDemoDateHeads(cityTime: number): { label: string; month: number; year: number } {
  const year = Math.trunc(cityTime / 48) + DEMO_STARTING_YEAR;
  const month = Math.trunc((cityTime % 48) / 4);
  const monthName = DATE_STRINGS[month] ?? 'Jan';
  return {
    label: `${monthName} ${year}`,
    month,
    year,
  };
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
