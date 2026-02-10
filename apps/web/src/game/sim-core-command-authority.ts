import {
  applyToolAction,
  cityEvaluation,
  clearCensus,
  collectTax,
  createBridgeHandler,
  createFireHandler,
  createFloodHandler,
  createRadHandler,
  createRailHandler,
  createRoadHandler,
  createZoneHandler,
  crimeScan,
  decROGMem,
  decTrafficMem,
  doDisasters,
  fireAnalysis,
  MAP_FLAGS,
  type MapScanHandlers,
  popDenScan,
  ptlScan,
  runMapScanPhase,
  runSimLoop,
  sendMessages,
  setValves,
  type SimContext,
  type SimMapFlag,
  type SimPhaseSystems,
  type SimState,
  take2Census,
  takeCensus,
  type ToolContext,
} from '../../../../packages/sim-core/src/index.ts';
import { setFunds } from '../../../../packages/sim-core/src/systems/funds.ts';
import { doPowerScan } from '../../../../packages/sim-core/src/systems/power.ts';
import type {
  CoreHostAckEvent,
  CoreHostCommand,
  CoreHostEvent,
  CoreHostPatchEvent,
  CoreHostPlacement,
  CoreHostRejectCode,
  CoreHostRejectEvent,
  CoreHostSimControlCommand,
  CoreHostSnapshotEvent,
  CoreHostSnapshotPlacement,
  CoreHostToolCommand,
  HostMode,
} from './core-host';
import { DeterministicCommandAuthority } from './deterministic-command-authority';
import { SimCoreRuntimeState } from './sim-core-runtime-state';
import {
  createOutOfBoundsHostRejectOutcome,
  type HostToolRejectOutcome,
  translateToolResultToHostOutcome,
} from './tool-outcome-host-translation';

interface AcceptedOutcome {
  kind: 'ack';
  placement?: CoreHostPlacement;
}

type RejectedOutcome = HostToolRejectOutcome;

type CommandOutcome = AcceptedOutcome | RejectedOutcome;
type SequencedEvent = CoreHostAckEvent | CoreHostRejectEvent | CoreHostPatchEvent;

const DEFAULT_TICK_INTERVAL_MS = 100;

/**
 * Authority engine selection for Authoritative Runtime host wiring.
 * Mirrors Sim-Core Authority authority-path convergence intent from
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: explicit mode selection is a TypeScript composition seam.
 */
export type AuthorityMode = 'sim-core' | 'deterministic';

/**
 * Shared authority contract consumed by `LocalHost` and `DoHost`.
 * Mirrors authoritative command/snapshot ownership intent in
 * `ref/micropolis/src/sim/w_sim.c` and simulation progression in
 * `ref/micropolis/src/sim/s_sim.c`.
 * Parity note: explicit `connect`/`disconnect` hooks are TypeScript lifecycle wiring.
 */
export interface CommandAuthority {
  connect?(): void;
  disconnect?(): void;
  processCommand(command: CoreHostCommand): CoreHostEvent[];
  createSnapshotReplay(lastAppliedServerSeq?: number): CoreHostEvent[];
}

/**
 * Injectable scheduler for sim-core tick driving.
 * Mirrors periodic simulation stepping from `sim_timeout_loop`/`sim_loop` in
 * `ref/micropolis/src/sim/sim.c`.
 * Parity note: this preserves deterministic test control in TypeScript.
 */
export interface SimCoreAuthorityTickScheduler {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

const DEFAULT_TICK_SCHEDULER: SimCoreAuthorityTickScheduler = {
  setInterval(callback, intervalMs) {
    return globalThis.setInterval(callback, intervalMs);
  },
  clearInterval(handle) {
    globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>);
  },
};

/**
 * Construction options for `SimCoreCommandAuthority`.
 * Mirrors Sim-Core Authority authority-loop bootstrapping and speed/tick ownership from
 * `ref/micropolis/src/sim/s_init.c`, `ref/micropolis/src/sim/s_sim.c`, and
 * `ref/micropolis/src/sim/w_util.c`.
 * Parity note: explicit scheduler/interval injection is a TypeScript test seam.
 */
export interface SimCoreCommandAuthorityOptions {
  readonly mode: HostMode;
  readonly seed?: number;
  /**
   * Optional starting funds override for Authoritative Runtime authority-owned `TotalFunds`.
   * Mirrors `TotalFunds` bootstrap ownership in `ref/micropolis/src/sim/w_stubs.c`
   * and init paths in `ref/micropolis/src/sim/s_init.c`.
   * Parity note: explicit injection is a TypeScript test seam.
   */
  readonly startingFunds?: number;
  readonly tickIntervalMs?: number;
  readonly tickScheduler?: SimCoreAuthorityTickScheduler;
}

/**
 * Factory options for Authoritative Runtime authority selection.
 * Mirrors Sim-Core Authority authority-loop ownership in `ref/micropolis/src/sim/w_sim.c`
 * and `ref/micropolis/src/sim/s_sim.c`.
 * Parity note: `allowDeterministicFallback` is a TypeScript-only guardrail to
 * keep deterministic authority isolated to tests/emergency fallback wiring.
 */
export interface CreateCommandAuthorityOptions extends SimCoreCommandAuthorityOptions {
  readonly authorityMode?: AuthorityMode;
  readonly allowDeterministicFallback?: boolean;
}

/**
 * Sim-Core Authority sim-core-backed authority loop for Authoritative Runtime hosts.
 * Mirrors Micropolis runtime ownership where simulation state/context and tool
 * application live in one authoritative process (`w_sim.c`, `s_sim.c`, `s_init.c`).
 * Parity note: command outcomes intentionally keep existing Authoritative Runtime event surface
 * (`ack`/`reject`/`patch` placements) until later protocol-expansion stages.
 */
export class SimCoreCommandAuthority implements CommandAuthority {
  private serverSeq = 0;
  private readonly commandOutcomes = new Map<string, CommandOutcome>();
  private readonly sequencedEvents: SequencedEvent[] = [];
  private readonly patchEvents: CoreHostPatchEvent[] = [];
  private readonly simState: SimState;
  private readonly simContext: SimContext;
  private readonly toolContext: ToolContext;
  private readonly simPhaseSystems: SimPhaseSystems;
  private readonly tickIntervalMs: number | undefined;
  private readonly tickScheduler: SimCoreAuthorityTickScheduler;
  private tickHandle: unknown;
  private connected = false;
  private simPaused = false;
  private simPausedSpeed = 0;

  public constructor(private readonly options: SimCoreCommandAuthorityOptions) {
    const authorityState = new SimCoreRuntimeState({
      seed: this.options.seed,
      startingFunds: this.options.startingFunds,
    });
    this.simState = authorityState.simState;
    this.simContext = authorityState.simContext;
    this.toolContext = authorityState.toolContext;
    this.simPhaseSystems = createAuthoritySimPhaseSystems(this.simState, this.simContext);
    this.tickIntervalMs = normalizeTickIntervalMs(this.options.tickIntervalMs);
    this.tickScheduler = this.options.tickScheduler ?? DEFAULT_TICK_SCHEDULER;
    this.simPausedSpeed = this.simState.SimMetaSpeed;
  }

  public connect(): void {
    if (this.connected) {
      return;
    }

    this.connected = true;
    this.refreshTickLoop();
  }

  public disconnect(): void {
    if (!this.connected && this.tickHandle === undefined) {
      return;
    }

    this.connected = false;
    this.stopTickLoop();
  }

  /**
   * Starts the periodic authority loop when simulation speed is active.
   * Mirrors `StartMicropolisTimer()` call sites in `ref/micropolis/src/sim/w_util.c`.
   * Parity note: this is a TypeScript scheduler adapter around the same start intent.
   */
  private startTickLoop(): void {
    if (this.tickIntervalMs === undefined || this.tickHandle !== undefined) {
      return;
    }

    this.tickHandle = this.tickScheduler.setInterval(() => {
      this.simContext.store.beginTick();
      try {
        runSimLoop(this.simState, this.simContext, this.simPhaseSystems);
        this.syncToolContextFromState();
      } finally {
        this.simContext.store.commitTick();
      }
    }, this.tickIntervalMs);
  }

  /**
   * Stops the periodic authority loop when paused/stopped.
   * Mirrors `StopMicropolisTimer()` call sites in `ref/micropolis/src/sim/w_util.c`.
   * Parity note: this is a TypeScript scheduler adapter around the same stop intent.
   */
  private stopTickLoop(): void {
    if (this.tickHandle === undefined) {
      return;
    }

    this.tickScheduler.clearInterval(this.tickHandle);
    this.tickHandle = undefined;
  }

  /**
   * Applies C-like timer gating based on host connection and effective sim speed.
   * Mirrors timer gating in `setSpeed(short)` from `ref/micropolis/src/sim/w_util.c`.
   * Parity note: this keeps start/stop decisions in one authority-side helper.
   */
  private refreshTickLoop(): void {
    if (!this.connected || this.tickIntervalMs === undefined || this.simState.SimSpeed === 0) {
      this.stopTickLoop();
      return;
    }

    this.startTickLoop();
  }

  public processCommand(command: CoreHostCommand): CoreHostEvent[] {
    // Mirrors `SimCmd` routing in `ref/micropolis/src/sim/w_sim.c`:
    // one command ingress dispatches to command-specific handlers.
    switch (command.type) {
      case 'tool-command':
        return this.processToolCommand(command);
      case 'sim-control-command':
        return this.processSimControlCommand(command);
    }
  }

  private processToolCommand(command: CoreHostToolCommand): CoreHostEvent[] {
    // Keep tool mirror state aligned with authoritative funds/options before all
    // command outcomes (accept/reject), including preflight rejects.
    this.syncToolContextFromState();
    const currentTick = this.currentTick();
    const previousOutcome = this.commandOutcomes.get(command.commandId);
    if (previousOutcome) {
      if (previousOutcome.kind === 'ack') {
        return [this.recordSequenced(this.createAck(command.commandId, currentTick))];
      }
      return [
        this.recordSequenced(
          this.createReject(
            command.commandId,
            previousOutcome.code,
            previousOutcome.message,
            currentTick,
          ),
        ),
      ];
    }

    if (!isPlacementCoordinate(command.x, command.y)) {
      const outOfBoundsReject = createOutOfBoundsHostRejectOutcome();
      return this.recordReject(
        command.commandId,
        outOfBoundsReject.code,
        outOfBoundsReject.message,
        currentTick,
      );
    }

    const toolReject = this.applyToolCommand(command);
    if (toolReject !== undefined) {
      return this.recordReject(command.commandId, toolReject.code, toolReject.message, currentTick);
    }

    const placement: CoreHostPlacement = {
      tool: command.tool,
      x: command.x,
      y: command.y,
    };
    this.commandOutcomes.set(command.commandId, {
      kind: 'ack',
      placement,
    });

    return [
      this.recordSequenced(this.createAck(command.commandId, currentTick)),
      this.recordSequenced(this.createPatch(command.commandId, placement, currentTick)),
    ];
  }

  /**
   * Build one recovery stream as snapshot baseline plus sequenced tail replay.
   * Mirrors reconnect/resync snapshot intent from
   * `ref/micropolis/spec/integration/SPEC.md`.
   * Parity note: this keeps existing Authoritative Runtime placement-only replay shape for now.
   */
  public createSnapshotReplay(lastAppliedServerSeq = 0): CoreHostEvent[] {
    const baseServerSeq = normalizeServerSeq(lastAppliedServerSeq, this.serverSeq);
    const snapshot = this.createSnapshot(baseServerSeq);
    const tail = this.sequencedEvents.filter((event) => event.serverSeq > baseServerSeq);
    return [snapshot, ...tail];
  }

  /**
   * Processes host pause/resume/set-speed commands through authoritative state.
   * Mirrors `SimCmdPause`, `SimCmdResume`, and `SimCmdSpeed` in
   * `ref/micropolis/src/sim/w_sim.c`.
   * Parity note: this emits existing Authoritative Runtime ack events without new payload types.
   */
  private processSimControlCommand(command: CoreHostSimControlCommand): CoreHostEvent[] {
    const currentTick = this.currentTick();
    const previousOutcome = this.commandOutcomes.get(command.commandId);
    if (previousOutcome) {
      if (previousOutcome.kind === 'ack') {
        return [this.recordSequenced(this.createAck(command.commandId, currentTick))];
      }
      return [
        this.recordSequenced(
          this.createReject(
            command.commandId,
            previousOutcome.code,
            previousOutcome.message,
            currentTick,
          ),
        ),
      ];
    }

    if (command.control === 'pause') {
      this.pauseSimulation();
    } else if (command.control === 'resume') {
      this.resumeSimulation();
    } else {
      this.setSimulationSpeed(command.speed);
    }

    this.commandOutcomes.set(command.commandId, { kind: 'ack' });
    return [this.recordSequenced(this.createAck(command.commandId, currentTick))];
  }

  private applyToolCommand(command: CoreHostToolCommand): RejectedOutcome | undefined {
    this.simContext.store.beginTick();

    try {
      const toolResult = applyToolAction(this.toolContext, {
        tool: command.tool,
        x: command.x,
        y: command.y,
        simStep: this.simState.Scycle,
        order: 0,
        tickId: this.currentTick(),
        seq: this.serverSeq,
      });
      const hostOutcome = translateToolResultToHostOutcome(toolResult.result);
      if (hostOutcome.kind === 'ack') {
        return undefined;
      }
      return hostOutcome;
    } finally {
      // Always re-sync canonical funds, even on rejected tool outcomes.
      this.syncStateFromToolContext();
      this.simContext.store.commitTick();
    }
  }

  private syncToolContextFromState(): void {
    this.toolContext.funds = this.simState.TotalFunds;
    this.toolContext.autoBulldoze = this.simState.autoBulldoze;
    this.toolContext.doAnimation = this.simState.doAnimation;
  }

  private syncStateFromToolContext(): void {
    // Mirrors `Spend` -> `SetFunds` in `ref/micropolis/src/sim/w_stubs.c`.
    // `setFunds` marks funds dirty, matching C `SetFunds` calling `UpdateFunds`.
    setFunds(this.simState, this.toolContext.funds);
  }

  private currentTick(): number {
    return this.simState.Fcycle;
  }

  /**
   * Pause semantics for Sim-Core Authority sim-core authority.
   * Mirrors `Pause()` in `ref/micropolis/src/sim/w_util.c`.
   * Parity note: this is a 1:1 ordering port of pause state transitions.
   */
  private pauseSimulation(): void {
    if (this.simPaused) {
      return;
    }

    this.simPausedSpeed = this.simState.SimMetaSpeed;
    this.setSimulationSpeed(0);
    this.simPaused = true;
  }

  /**
   * Resume semantics for Sim-Core Authority sim-core authority.
   * Mirrors `Resume()` in `ref/micropolis/src/sim/w_util.c`.
   * Parity note: this is a 1:1 ordering port of resume state transitions.
   */
  private resumeSimulation(): void {
    if (!this.simPaused) {
      return;
    }

    this.simPaused = false;
    this.setSimulationSpeed(this.simPausedSpeed);
  }

  /**
   * Speed semantics for Sim-Core Authority sim-core authority.
   * Mirrors `setSpeed(short)` in `ref/micropolis/src/sim/w_util.c`.
   * Parity note: values are explicitly truncated/clamped to `0..3` to preserve
   * C integer and clamp behavior in TypeScript.
   */
  private setSimulationSpeed(candidate: number): void {
    let speed = normalizePlayableSpeed(candidate);

    this.simState.SimMetaSpeed = speed;

    if (this.simPaused) {
      this.simPausedSpeed = this.simState.SimMetaSpeed;
      speed = 0;
    }

    this.simState.SimSpeed = speed;
    this.refreshTickLoop();
  }

  private recordReject(
    commandId: string,
    code: CoreHostRejectCode,
    message: string,
    tick: number,
  ): CoreHostEvent[] {
    this.commandOutcomes.set(commandId, {
      kind: 'reject',
      code,
      message,
    });
    return [this.recordSequenced(this.createReject(commandId, code, message, tick))];
  }

  private recordSequenced(event: SequencedEvent): SequencedEvent {
    this.sequencedEvents.push(event);
    if (event.type === 'patch') {
      this.patchEvents.push(event);
    }
    return event;
  }

  private createAck(commandId: string, tick: number): CoreHostAckEvent {
    return {
      type: 'ack',
      mode: this.options.mode,
      commandId,
      tick,
      serverSeq: this.nextServerSeq(),
    };
  }

  private createReject(
    commandId: string,
    code: CoreHostRejectCode,
    message: string,
    tick: number,
  ): CoreHostRejectEvent {
    return {
      type: 'reject',
      mode: this.options.mode,
      commandId,
      code,
      message,
      tick,
      serverSeq: this.nextServerSeq(),
    };
  }

  private createPatch(
    commandId: string,
    placement: CoreHostPlacement,
    tick: number,
  ): CoreHostPatchEvent {
    return {
      type: 'patch',
      mode: this.options.mode,
      commandId,
      placements: [placement],
      tick,
      serverSeq: this.nextServerSeq(),
    };
  }

  private createSnapshot(baseServerSeq: number): CoreHostSnapshotEvent {
    const placements = this.placementsAtOrBefore(baseServerSeq);
    return {
      type: 'snapshot',
      mode: this.options.mode,
      tick: this.tickAtOrBefore(baseServerSeq),
      baseServerSeq,
      placements,
    };
  }

  private placementsAtOrBefore(baseServerSeq: number): CoreHostSnapshotPlacement[] {
    const placements: CoreHostSnapshotPlacement[] = [];
    for (const patchEvent of this.patchEvents) {
      if (patchEvent.serverSeq > baseServerSeq) {
        break;
      }

      for (const placement of patchEvent.placements) {
        placements.push({
          commandId: patchEvent.commandId,
          tool: placement.tool,
          x: placement.x,
          y: placement.y,
        });
      }
    }

    return placements;
  }

  private tickAtOrBefore(baseServerSeq: number): number {
    if (baseServerSeq <= 0) {
      return 0;
    }

    for (let index = this.sequencedEvents.length - 1; index >= 0; index -= 1) {
      const event = this.sequencedEvents[index];
      if (event && event.serverSeq <= baseServerSeq) {
        return event.tick;
      }
    }

    return 0;
  }

  private nextServerSeq(): number {
    this.serverSeq += 1;
    return this.serverSeq;
  }
}

/**
 * Update map invalidation flags produced by simulation phases.
 * Mirrors `NewMapFlags[...] = 1` writes in `Simulate` from
 * `ref/micropolis/src/sim/s_sim.c`.
 */
function markMapFlagsForAuthority(state: SimState, flags: ReadonlyArray<SimMapFlag>): void {
  for (const flag of flags) {
    state.NewMapFlags[MAP_FLAGS[flag]] = 1;
  }
}

/**
 * Build the full simulation phase wiring used by the Authoritative Runtime authority loop.
 * Mirrors `Simulate` + `MapScan` dispatch in `ref/micropolis/src/sim/s_sim.c`
 * and map-scan handlers in `ref/micropolis/src/sim/s_zone.c`, `s_disast.c`,
 * `s_sim.c`, and `s_scan.c`.
 */
function createAuthoritySimPhaseSystems(_state: SimState, _context: SimContext): SimPhaseSystems {
  let mapScanHandlers: MapScanHandlers | undefined;

  return {
    mapScan: (phase, scanState, scanContext) => {
      if (!mapScanHandlers) {
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
      markMapFlagsForAuthority(dirtyState, flags);
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

/**
 * Factory for Authoritative Runtime authority selection.
 * Mirrors Sim-Core Authority migration requirement to make sim-core ownership the default
 * while keeping deterministic fallback for isolated tests.
 * Parity note: fallback mode is a TypeScript migration aid, not a C concept.
 */
export function createCommandAuthority(options: CreateCommandAuthorityOptions): CommandAuthority {
  if (options.authorityMode === 'deterministic') {
    if (!options.allowDeterministicFallback) {
      throw new Error(
        'Deterministic authority mode is restricted to isolated tests/fallback; set allowDeterministicFallback to true.',
      );
    }
    return new DeterministicCommandAuthority({
      mode: options.mode,
      seed: options.seed,
      startingFunds: options.startingFunds,
    });
  }

  return new SimCoreCommandAuthority(options);
}

function isPlacementCoordinate(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y);
}

function normalizeServerSeq(candidate: number, highestKnown: number): number {
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

function normalizeTickIntervalMs(candidate: number | undefined): number | undefined {
  if (candidate === undefined) {
    return DEFAULT_TICK_INTERVAL_MS;
  }
  if (!Number.isFinite(candidate) || candidate <= 0) {
    return undefined;
  }

  return Math.trunc(candidate);
}

/**
 * Converts host speed requests into Micropolis playable speed domain.
 * Mirrors clamping in `setSpeed(short)` from `ref/micropolis/src/sim/w_util.c`.
 * Parity note: explicit truncation preserves C integer behavior in TypeScript.
 */
function normalizePlayableSpeed(candidate: number): number {
  if (!Number.isFinite(candidate)) {
    return 0;
  }

  const speed = Math.trunc(candidate);
  if (speed < 0) {
    return 0;
  }
  if (speed > 3) {
    return 3;
  }

  return speed;
}
