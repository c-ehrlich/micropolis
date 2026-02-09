import {
  applyToolAction,
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
  CoreHostSnapshotEvent,
  CoreHostSnapshotPlacement,
  HostMode,
} from './core-host';
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

/**
 * Construction options for the deterministic Stage 4 command authority shim.
 * Mirrors transport-specific host identity branching around shared command logic in
 * `ref/micropolis/src/sim/w_tool.c`.
 * Parity note: `seed`/`startingFunds` mirror bootstrap seams from
 * `ref/micropolis/src/sim/s_init.c` and funds ownership in
 * `ref/micropolis/src/sim/w_stubs.c`.
 */
export interface DeterministicCommandAuthorityOptions {
  readonly mode: HostMode;
  readonly seed?: number;
  readonly startingFunds?: number;
}

/**
 * Deterministic command authority used by both `LocalHost` and `DoHost`.
 * Mirrors tool success/reject/idempotency intent from `ref/micropolis/src/sim/w_tool.c`
 * by delegating tool execution to sim-core `applyToolAction` return codes.
 * Parity note: this remains a deterministic fallback harness for isolated tests,
 * not a full timer-driven authority loop from `ref/micropolis/src/sim/s_sim.c`.
 */
export class DeterministicCommandAuthority {
  private serverSeq = 0;
  private tick = 0;
  private readonly commandOutcomes = new Map<string, CommandOutcome>();
  private readonly sequencedEvents: SequencedEvent[] = [];
  private readonly patchEvents: CoreHostPatchEvent[] = [];
  private readonly simState: SimState;
  private readonly toolContext: ToolContext;

  public constructor(private readonly options: DeterministicCommandAuthorityOptions) {
    const authorityState = new Stage4SimCoreAuthorityState({
      seed: this.options.seed,
      startingFunds: this.options.startingFunds,
    });
    this.simState = authorityState.simState;
    this.toolContext = authorityState.toolContext;
  }

  public processCommand(command: CoreHostCommand): CoreHostEvent[] {
    if (command.type === 'sim-control-command') {
      return this.processSimControlCommand(command.commandId);
    }

    const tick = this.nextTick();
    const previousOutcome = this.commandOutcomes.get(command.commandId);
    if (previousOutcome) {
      if (previousOutcome.kind === 'ack') {
        return [this.recordSequenced(this.createAck(command.commandId, tick))];
      }
      return [
        this.recordSequenced(
          this.createReject(command.commandId, previousOutcome.code, previousOutcome.message, tick),
        ),
      ];
    }

    if (!isPlacementCoordinate(command.x, command.y)) {
      return this.recordReject(
        command.commandId,
        'OUT_OF_BOUNDS',
        'tool coordinates are out of bounds',
        tick,
      );
    }

    this.syncToolContextFromState();
    const toolReject = this.applyToolCommand(command, tick);
    if (toolReject !== undefined) {
      return this.recordReject(command.commandId, toolReject.code, toolReject.message, tick);
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
      this.recordSequenced(this.createAck(command.commandId, tick)),
      this.recordSequenced(this.createPatch(command.commandId, placement, tick)),
    ];
  }

  /**
   * Deterministic fallback handling for sim control commands.
   * Mirrors Stage 0/1 command-ingress acceptance intent from
   * `ref/micropolis/src/sim/w_sim.c` pause/resume/speed handlers.
   * Parity note: this shim acknowledges controls without sim-core speed state.
   */
  private processSimControlCommand(commandId: string): CoreHostEvent[] {
    const tick = this.nextTick();
    const previousOutcome = this.commandOutcomes.get(commandId);
    if (previousOutcome) {
      if (previousOutcome.kind === 'ack') {
        return [this.recordSequenced(this.createAck(commandId, tick))];
      }
      return [
        this.recordSequenced(
          this.createReject(commandId, previousOutcome.code, previousOutcome.message, tick),
        ),
      ];
    }

    this.commandOutcomes.set(commandId, { kind: 'ack' });
    return [this.recordSequenced(this.createAck(commandId, tick))];
  }

  private applyToolCommand(
    command: Extract<CoreHostCommand, { type: 'tool-command' }>,
    tick: number,
  ): RejectedOutcome | undefined {
    this.toolContext.store.beginTick();

    try {
      const toolResult = applyToolAction(this.toolContext, {
        tool: command.tool,
        x: command.x,
        y: command.y,
        simStep: this.simState.Scycle,
        order: 0,
        tickId: tick,
        seq: this.serverSeq,
      });
      return toToolRejectedOutcome(toolResult.result);
    } finally {
      this.syncStateFromToolContext();
      this.toolContext.store.commitTick();
    }
  }

  private syncToolContextFromState(): void {
    this.toolContext.funds = this.simState.TotalFunds;
    this.toolContext.autoBulldoze = this.simState.autoBulldoze;
    this.toolContext.doAnimation = this.simState.doAnimation;
  }

  private syncStateFromToolContext(): void {
    setFunds(this.simState, this.toolContext.funds);
  }

  /**
   * Build one recovery stream as snapshot baseline plus sequenced tail replay.
   * Mirrors Stage reconnect/resync recovery expectations mapped from
   * `ref/micropolis/spec/integration/SPEC.md`.
   * Parity note: this is a deterministic TypeScript fixture helper, not 1:1 C code.
   */
  public createSnapshotReplay(lastAppliedServerSeq = 0): CoreHostEvent[] {
    const baseServerSeq = normalizeServerSeq(lastAppliedServerSeq, this.serverSeq);
    const snapshot = this.createSnapshot(baseServerSeq);
    const tail = this.sequencedEvents.filter((event) => event.serverSeq > baseServerSeq);
    return [snapshot, ...tail];
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

  private nextTick(): number {
    this.tick += 1;
    return this.tick;
  }
}

function isPlacementCoordinate(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y);
}

/**
 * Maps one sim-core tool result into the deterministic fallback reject shape.
 * Mirrors `DoTool` return handling in `ref/micropolis/src/sim/w_tool.c`
 * (`-1` out-of-bounds, `-2` no-funds, other non-success invalid placement).
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
