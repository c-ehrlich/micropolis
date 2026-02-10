import type { readFile as nodeReadFile } from 'node:fs/promises';

import {
  applyToolAction,
  resetForNewCityFromSeed,
  type ToolResult,
} from '../../../../../packages/sim-core/src/index.ts';
import { setFunds } from '../../../../../packages/sim-core/src/systems/funds.ts';
import { loadCityLikeC, loadScenarioLikeC } from '../../../../../packages/sim-io/src/load.ts';
import { saveCityAsLikeC } from '../../../../../packages/sim-io/src/save.ts';
import {
  getScenarioDefinition,
  SCENARIO_TABLE,
} from '../../../../../packages/sim-io/src/scenarios.ts';
import { SimCoreRuntimeState } from '../sim-core-runtime-state.ts';
import type { PlayableRuntimeHostOptions } from './playable-runtime-host-options.ts';
import type {
  ClientEnvelope,
  CoreHost,
  CoreHostConnection,
  HostEnvelope,
  HostPatchPayload,
  HostSnapshotPayload,
  PlayableClientCommand,
} from './protocol.ts';

type PlayableToolCommand = Extract<PlayableClientCommand, { kind: 'tool' }>;
type PlayableSimControlCommand = Extract<PlayableClientCommand, { kind: 'sim-control' }>;
type PlayableCityLifecycleCommand = Extract<PlayableClientCommand, { kind: 'city-lifecycle' }>;
type PlayableCityIoCommand = Extract<PlayableClientCommand, { kind: 'city-io' }>;
type PlayableScenarioCommand = Extract<PlayableClientCommand, { kind: 'scenario' }>;
type PlayableSaveCityCommand = Extract<PlayableCityIoCommand, { action: 'save-city' }>;
type PlayableLoadCityCommand = Extract<PlayableCityIoCommand, { action: 'load-city' }>;
type SequencedHostEnvelope = Exclude<HostEnvelope, { kind: 'hello' }>;
type DistributiveOmit<TValue, TKey extends PropertyKey> = TValue extends unknown
  ? Omit<TValue, TKey>
  : never;
type SequencedHostEnvelopeWithoutServerSeq = DistributiveOmit<SequencedHostEnvelope, 'serverSeq'>;

const DEFAULT_CITY_FILE_NAME = 'newcity.cty';
const DEFAULT_CITY_NAME = 'New City';
const NEW_CITY_STARTING_FUNDS = 20_000;
const NEW_CITY_TREE_LEVEL = -1;
const NEW_CITY_LAKE_LEVEL = -1;
const NEW_CITY_CURVE_LEVEL = -1;
const NEW_CITY_CREATE_ISLAND = -1;
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
 * subsequent checklist tasks. It also accepts `createPlayableRuntimeHost(...)`
 * compatibility options so route call sites/tests can migrate without option-surface churn.
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
  private simPaused = false;
  private simPausedSpeed = 3;
  private cityFileName = DEFAULT_CITY_FILE_NAME;
  private cityName = DEFAULT_CITY_NAME;
  private readonly scenarioResourceBytesCache = new Map<string, Promise<Uint8Array>>();
  private readonly scenarioResourceLoader: (fileName: string) => Promise<Uint8Array>;

  public constructor(options: PlayableRuntimeHostOptions = {}) {
    this.authorityState = new SimCoreRuntimeState();
    const mapLayerInfo = this.authorityState.store.layerInfo('map');
    this.mapWidth = mapLayerInfo.width;
    this.mapHeight = mapLayerInfo.height;
    this.simPausedSpeed = normalizePlayableSpeed(this.authorityState.simState.SimMetaSpeed);
    const scenarioResourceLoader = options.scenarioResourceLoader;
    this.scenarioResourceLoader =
      scenarioResourceLoader === undefined
        ? (fileName) => this.loadScenarioResourceBytes(fileName)
        : (fileName) => Promise.resolve(scenarioResourceLoader(fileName));
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

    this.handleCommandEnvelope(sessionId, envelope);
  }

  private beginSession(onEnvelope: (envelope: HostEnvelope) => void): number {
    this.nextSessionId += 1;
    const sessionId = this.nextSessionId;
    this.onEnvelope = onEnvelope;
    this.lifecycle = {
      phase: 'awaiting-hello',
      sessionId,
    };
    return sessionId;
  }

  private routeDisconnect(sessionId: number): void {
    if (!this.isSessionActive(sessionId)) {
      return;
    }

    this.onEnvelope = undefined;
    this.lifecycle = { phase: 'disconnected' };
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
    this.emitSnapshot(envelope.roomId, envelope.clientId);
  }

  private handleSnapshotRequestEnvelope(
    sessionId: number,
    envelope: Extract<ClientEnvelope, { kind: 'request_snapshot' }>,
  ): void {
    if (!this.isReadySessionEnvelope(sessionId, envelope.roomId, envelope.clientId)) {
      return;
    }

    this.emitSnapshot(envelope.roomId, envelope.clientId);
  }

  private handleCommandEnvelope(
    sessionId: number,
    envelope: Extract<ClientEnvelope, { kind: 'command' }>,
  ): void {
    if (!this.isReadySessionEnvelope(sessionId, envelope.roomId, envelope.clientId)) {
      return;
    }

    if (this.onEnvelope === undefined) {
      return;
    }

    this.tick += 1;
    if (envelope.command.kind === 'tool') {
      const rejectReason = this.applyToolCommand(envelope.command);
      if (rejectReason !== undefined) {
        this.emitReject(envelope.roomId, envelope.clientId, envelope.commandId, rejectReason);
        return;
      }

      this.emitAck(envelope.roomId, envelope.clientId, envelope.commandId);
      this.emitPatch(envelope.roomId, envelope.clientId, this.buildNoOpPatchPayload());
      return;
    }

    if (envelope.command.kind === 'sim-control') {
      this.applySimControlCommand(envelope.command);
      this.emitAck(envelope.roomId, envelope.clientId, envelope.commandId);
      this.emitPatch(envelope.roomId, envelope.clientId, this.buildNoOpPatchPayload());
      return;
    }

    if (envelope.command.kind === 'city-lifecycle') {
      this.applyCityLifecycleCommand(envelope.command);
      this.emitAck(envelope.roomId, envelope.clientId, envelope.commandId);
      this.emitSnapshot(envelope.roomId, envelope.clientId);
      return;
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
        return;
      }

      this.emitAck(envelope.roomId, envelope.clientId, envelope.commandId);
      if (cityIoOutcome.kind === 'save') {
        this.emitPatch(envelope.roomId, envelope.clientId, cityIoOutcome.patchPayload);
        return;
      }

      this.emitSnapshot(envelope.roomId, envelope.clientId);
      return;
    }

    if (envelope.command.kind === 'scenario') {
      const commandTick = this.tick;
      void this.applyScenarioCommandAsync(
        sessionId,
        envelope.roomId,
        envelope.clientId,
        envelope.commandId,
        envelope.command,
        commandTick,
      );
      return;
    }

    this.emitReject(envelope.roomId, envelope.clientId, envelope.commandId, 'invalid-command');
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
  ): void {
    this.emitSequencedEnvelope({
      kind: 'ack',
      roomId,
      clientId,
      tick: tickOverride,
      commandId,
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
  ): void {
    this.emitSequencedEnvelope({
      kind: 'reject',
      roomId,
      clientId,
      tick: tickOverride,
      commandId,
      reason,
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
   * Builds the temporary patch payload emitted for acknowledged tool commands.
   * Mirrors command/update settlement ordering from `ref/micropolis/src/sim/w_sim.c`
   * and `ref/micropolis/src/sim/w_update.c`.
   * Parity note: Phase 2 keeps map patch payload empty while Phase 3 ports
   * authoritative map tile deltas/redraw plans.
   */
  private buildNoOpPatchPayload(): HostPatchPayload {
    return {};
  }

  /**
   * Applies one tool command using sim-core tool semantics.
   * Mirrors `DoTool` dispatch and return-code behavior in
   * `ref/micropolis/src/sim/w_tool.c` by routing through sim-core
   * `applyToolAction` and translating outcome classes into host reject reasons.
   * Parity note: this stage intentionally leaves patch payload map deltas empty;
   * Phase 3 ports authoritative map delta/redraw payload emission.
   */
  private applyToolCommand(command: PlayableToolCommand): string | undefined {
    if (!isPlacementCoordinate(command.x, command.y)) {
      return 'out-of-bounds';
    }

    this.syncToolContextFromState();
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
      return rejectReasonFromToolResult(toolResult.result);
    } finally {
      this.syncStateFundsFromToolContext();
      this.authorityState.toolContext.store.commitTick();
    }
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
    let speed = normalizePlayableSpeed(candidate);
    this.authorityState.simState.SimMetaSpeed = speed;

    if (this.simPaused) {
      this.simPausedSpeed = this.authorityState.simState.SimMetaSpeed;
      speed = 0;
    }

    this.authorityState.simState.SimSpeed = speed;
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
  private emitSnapshot(roomId: string, clientId: string, tickOverride = this.tick): void {
    this.emitSequencedEnvelope({
      kind: 'snapshot',
      roomId,
      clientId,
      tick: tickOverride,
      payload: this.buildSnapshotPayload(),
    });
  }

  /**
   * Emits one sequenced host envelope with a strictly increasing server sequence.
   * Mirrors ordered host update sequencing intent from `w_sim.c`/`w_update.c`
   * while adapting to typed bridge envelopes.
   */
  private emitSequencedEnvelope(envelope: SequencedHostEnvelopeWithoutServerSeq): void {
    if (this.onEnvelope === undefined) {
      return;
    }

    const sequencedEnvelope: SequencedHostEnvelope = {
      ...envelope,
      serverSeq: this.nextServerSeq(),
    };
    this.onEnvelope(sequencedEnvelope);
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

    const tileWords = Uint16Array.from(mapLayer);
    return {
      map: {
        width: this.mapWidth,
        height: this.mapHeight,
        tileWords,
      },
    };
  }
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
