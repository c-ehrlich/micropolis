import {
  applyToolAction,
  runSimLoop,
  type SimContext,
  type SimState,
  type ToolContext,
  type ToolResult,
} from '../../../../packages/sim-core/src/index.ts';
import { setFunds } from '../../../../packages/sim-core/src/systems/funds.ts';
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
import { Stage4SimCoreAuthorityState } from './stage4-sim-core-authority-state';

interface AcceptedOutcome {
  kind: 'ack';
  placement?: CoreHostPlacement;
}

interface RejectedOutcome {
  kind: 'reject';
  code: CoreHostRejectCode;
  message: string;
}

type CommandOutcome = AcceptedOutcome | RejectedOutcome;
type SequencedEvent = CoreHostAckEvent | CoreHostRejectEvent | CoreHostPatchEvent;

const DEFAULT_TICK_INTERVAL_MS = 100;

/**
 * Authority engine selection for Stage 4 host wiring.
 * Mirrors Stage 1 authority-path convergence intent from
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: explicit mode selection is a TypeScript composition seam.
 */
export type Stage4AuthorityMode = 'sim-core' | 'deterministic';

/**
 * Shared authority contract consumed by `LocalHost` and `DoHost`.
 * Mirrors authoritative command/snapshot ownership intent in
 * `ref/micropolis/src/sim/w_sim.c` and simulation progression in
 * `ref/micropolis/src/sim/s_sim.c`.
 * Parity note: explicit `connect`/`disconnect` hooks are TypeScript lifecycle wiring.
 */
export interface Stage4CommandAuthority {
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
 * Mirrors Stage 1 authority-loop bootstrapping and speed/tick ownership from
 * `ref/micropolis/src/sim/s_init.c`, `ref/micropolis/src/sim/s_sim.c`, and
 * `ref/micropolis/src/sim/w_util.c`.
 * Parity note: explicit scheduler/interval injection is a TypeScript test seam.
 */
export interface SimCoreCommandAuthorityOptions {
  readonly mode: HostMode;
  readonly seed?: number;
  /**
   * Optional starting funds override for Stage 4 authority-owned `TotalFunds`.
   * Mirrors `TotalFunds` bootstrap ownership in `ref/micropolis/src/sim/w_stubs.c`
   * and init paths in `ref/micropolis/src/sim/s_init.c`.
   * Parity note: explicit injection is a TypeScript test seam.
   */
  readonly startingFunds?: number;
  readonly tickIntervalMs?: number;
  readonly tickScheduler?: SimCoreAuthorityTickScheduler;
}

/**
 * Factory options for Stage 4 authority selection.
 * Mirrors Stage 1 authority-loop ownership in `ref/micropolis/src/sim/w_sim.c`
 * and `ref/micropolis/src/sim/s_sim.c`.
 * Parity note: `allowDeterministicFallback` is a TypeScript-only guardrail to
 * keep deterministic authority isolated to tests/emergency fallback wiring.
 */
export interface CreateStage4CommandAuthorityOptions extends SimCoreCommandAuthorityOptions {
  readonly authorityMode?: Stage4AuthorityMode;
  readonly allowDeterministicFallback?: boolean;
}

/**
 * Stage 1 sim-core-backed authority loop for Stage 4 hosts.
 * Mirrors Micropolis runtime ownership where simulation state/context and tool
 * application live in one authoritative process (`w_sim.c`, `s_sim.c`, `s_init.c`).
 * Parity note: command outcomes intentionally keep existing Stage 4 event surface
 * (`ack`/`reject`/`patch` placements) until later protocol-expansion stages.
 */
export class SimCoreCommandAuthority implements Stage4CommandAuthority {
  private serverSeq = 0;
  private readonly commandOutcomes = new Map<string, CommandOutcome>();
  private readonly sequencedEvents: SequencedEvent[] = [];
  private readonly patchEvents: CoreHostPatchEvent[] = [];
  private readonly simState: SimState;
  private readonly simContext: SimContext;
  private readonly toolContext: ToolContext;
  private readonly tickIntervalMs: number | undefined;
  private readonly tickScheduler: SimCoreAuthorityTickScheduler;
  private tickHandle: unknown;
  private connected = false;
  private simPaused = false;
  private simPausedSpeed = 0;

  public constructor(private readonly options: SimCoreCommandAuthorityOptions) {
    const authorityState = new Stage4SimCoreAuthorityState({
      seed: this.options.seed,
      startingFunds: this.options.startingFunds,
    });
    this.simState = authorityState.simState;
    this.simContext = authorityState.simContext;
    this.toolContext = authorityState.toolContext;
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
        runSimLoop(this.simState, this.simContext);
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
      return this.recordReject(
        command.commandId,
        'OUT_OF_BOUNDS',
        'tool coordinates are out of bounds',
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
   * Parity note: this keeps existing Stage 4 placement-only replay shape for now.
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
   * Parity note: this emits existing Stage 4 ack events without new payload types.
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
      return toToolRejectedOutcome(toolResult.result);
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
   * Pause semantics for Stage 1 sim-core authority.
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
   * Resume semantics for Stage 1 sim-core authority.
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
   * Speed semantics for Stage 1 sim-core authority.
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
 * Factory for Stage 4 authority selection.
 * Mirrors Stage 1 migration requirement to make sim-core ownership the default
 * while keeping deterministic fallback for isolated tests.
 * Parity note: fallback mode is a TypeScript migration aid, not a C concept.
 */
export function createStage4CommandAuthority(
  options: CreateStage4CommandAuthorityOptions,
): Stage4CommandAuthority {
  if (options.authorityMode === 'deterministic') {
    if (!options.allowDeterministicFallback) {
      throw new Error(
        'Deterministic authority mode is restricted to isolated tests/fallback; set allowDeterministicFallback to true.',
      );
    }
    return new DeterministicCommandAuthority({ mode: options.mode });
  }

  return new SimCoreCommandAuthority(options);
}

function isPlacementCoordinate(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y);
}

/**
 * Maps one sim-core tool result into a stable Stage 4 host rejection shape.
 * Mirrors `DoTool` result handling in `ref/micropolis/src/sim/w_tool.c`:
 * - `-1` => out of bounds
 * - `-2` => no funds
 * - `0`/other non-success => invalid placement
 * Parity note: typed reject codes are a bridge-level TypeScript addition.
 */
function toToolRejectedOutcome(result: ToolResult): RejectedOutcome | undefined {
  if (result === 'ok') {
    return undefined;
  }

  if (result === 'out-of-bounds') {
    return {
      kind: 'reject',
      code: 'OUT_OF_BOUNDS',
      message: 'tool coordinates are out of bounds',
    };
  }

  if (result === 'no-funds') {
    return {
      kind: 'reject',
      code: 'NO_FUNDS',
      message: 'insufficient funds for tool placement',
    };
  }

  return {
    kind: 'reject',
    code: 'INVALID_PLACEMENT',
    message: 'tool placement was rejected by simulation rules',
  };
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
