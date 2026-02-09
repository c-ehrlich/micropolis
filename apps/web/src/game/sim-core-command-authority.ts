import {
  applyToolAction,
  createClassicMapStore,
  createRng,
  createSimContext,
  createSimState,
  createToolContext,
  doSimInit,
  initMapArrays,
  initWillStuff,
  runSimLoop,
  type SimContext,
  type SimState,
  type ToolContext,
  World,
} from '../../../../packages/sim-core/src/index.ts';
import type {
  CoreHostAckEvent,
  CoreHostCommand,
  CoreHostEvent,
  CoreHostPatchEvent,
  CoreHostPlacement,
  CoreHostRejectCode,
  CoreHostRejectEvent,
  CoreHostSnapshotEvent,
  CoreHostSnapshotPlacement,
  CoreHostToolCommand,
  HostMode,
} from './core-host';
import { DeterministicCommandAuthority } from './deterministic-command-authority';

interface AcceptedOutcome {
  kind: 'ack';
  placement: CoreHostPlacement;
}

interface RejectedOutcome {
  kind: 'reject';
  code: CoreHostRejectCode;
  message: string;
}

type CommandOutcome = AcceptedOutcome | RejectedOutcome;
type SequencedEvent = CoreHostAckEvent | CoreHostRejectEvent | CoreHostPatchEvent;

const { WORLD_X, WORLD_Y } = World;
const DEFAULT_TICK_INTERVAL_MS = 100;
const DEFAULT_STARTING_FUNDS = 20_000;

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
  readonly tickIntervalMs?: number;
  readonly tickScheduler?: SimCoreAuthorityTickScheduler;
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
  private readonly occupiedTiles = new Set<string>();
  private readonly commandOutcomes = new Map<string, CommandOutcome>();
  private readonly sequencedEvents: SequencedEvent[] = [];
  private readonly patchEvents: CoreHostPatchEvent[] = [];
  private readonly simState: SimState;
  private readonly simContext: SimContext;
  private readonly toolContext: ToolContext;
  private readonly tickIntervalMs: number | undefined;
  private readonly tickScheduler: SimCoreAuthorityTickScheduler;
  private tickHandle: unknown;

  public constructor(private readonly options: SimCoreCommandAuthorityOptions) {
    const store = createClassicMapStore();
    const simState = createSimState();
    const simContext = createSimContext({
      store,
      rng: createRng(this.options.seed),
      hooks: {
        tickCount: () => simState.Fcycle,
      },
    });

    initMapArrays(store);
    initWillStuff(simContext, simState, { seed: this.options.seed });
    simState.InitSimLoad = 2;
    doSimInit(simContext, simState);
    simState.TotalFunds = DEFAULT_STARTING_FUNDS;
    simState.SimMetaSpeed = simState.SimSpeed;

    this.simState = simState;
    this.simContext = simContext;
    this.toolContext = createToolContext({
      store,
      rng: simContext.rng,
      funds: simState.TotalFunds,
      autoBulldoze: simState.autoBulldoze,
      doAnimation: simState.doAnimation,
    });
    this.tickIntervalMs = normalizeTickIntervalMs(this.options.tickIntervalMs);
    this.tickScheduler = this.options.tickScheduler ?? DEFAULT_TICK_SCHEDULER;
  }

  public connect(): void {
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

  public disconnect(): void {
    if (this.tickHandle === undefined) {
      return;
    }

    this.tickScheduler.clearInterval(this.tickHandle);
    this.tickHandle = undefined;
  }

  public processCommand(command: CoreHostCommand): CoreHostEvent[] {
    // Mirrors `SimCmd` routing in `ref/micropolis/src/sim/w_sim.c`:
    // one command ingress dispatches to command-specific handlers.
    switch (command.type) {
      case 'tool-command':
        return this.processToolCommand(command);
    }
  }

  private processToolCommand(command: CoreHostToolCommand): CoreHostEvent[] {
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

    const tileKey = toTileKey(command.x, command.y);
    if (this.occupiedTiles.has(tileKey)) {
      return this.recordReject(
        command.commandId,
        'TILE_OCCUPIED',
        'target tile is already occupied',
        currentTick,
      );
    }

    const toolReject = this.applyToolCommand(command);
    if (toolReject !== undefined) {
      return this.recordReject(command.commandId, toolReject.code, toolReject.message, currentTick);
    }

    this.occupiedTiles.add(tileKey);
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

  private applyToolCommand(command: CoreHostCommand): RejectedOutcome | undefined {
    if (!isWithinWorldBounds(command.x, command.y)) {
      return {
        kind: 'reject',
        code: 'OUT_OF_BOUNDS',
        message: 'tool coordinates are out of bounds',
      };
    }

    this.syncToolContextFromState();
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
      this.syncStateFromToolContext();

      if (toolResult.result === 'ok') {
        return undefined;
      }
      if (toolResult.result === 'out-of-bounds') {
        return {
          kind: 'reject',
          code: 'OUT_OF_BOUNDS',
          message: 'tool coordinates are out of bounds',
        };
      }
      if (toolResult.result === 'no-funds') {
        return {
          kind: 'reject',
          code: 'TILE_OCCUPIED',
          message: 'insufficient funds for tool placement',
        };
      }

      return {
        kind: 'reject',
        code: 'TILE_OCCUPIED',
        message: 'target tile is already occupied',
      };
    } finally {
      this.simContext.store.commitTick();
    }
  }

  private syncToolContextFromState(): void {
    this.toolContext.funds = this.simState.TotalFunds;
    this.toolContext.autoBulldoze = this.simState.autoBulldoze;
    this.toolContext.doAnimation = this.simState.doAnimation;
  }

  private syncStateFromToolContext(): void {
    this.simState.TotalFunds = this.toolContext.funds;
  }

  private currentTick(): number {
    return this.simState.Fcycle;
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
  options: SimCoreCommandAuthorityOptions & {
    authorityMode?: Stage4AuthorityMode;
  },
): Stage4CommandAuthority {
  if (options.authorityMode === 'deterministic') {
    return new DeterministicCommandAuthority({ mode: options.mode });
  }

  return new SimCoreCommandAuthority(options);
}

function isPlacementCoordinate(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0;
}

function isWithinWorldBounds(x: number, y: number): boolean {
  return x < WORLD_X && y < WORLD_Y;
}

function toTileKey(x: number, y: number): string {
  return `${x},${y}`;
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
