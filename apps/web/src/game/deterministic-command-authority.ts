import {
  applyToolAction,
  type SimState,
  type ToolContext,
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
interface SnapshotReplayBaseline {
  baseServerSeq: number;
  tick: number;
  placements: CoreHostSnapshotPlacement[];
}
const COMMAND_OUTCOME_HISTORY_LIMIT = 512;
const SEQUENCED_TAIL_HISTORY_LIMIT = 256;
const SNAPSHOT_BASELINE_CADENCE_SERVER_SEQS = 64;

/**
 * Construction options for the deterministic Authoritative Runtime command authority shim.
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
  private readonly commandOutcomeOrder: string[] = [];
  private readonly sequencedEvents: SequencedEvent[] = [];
  private readonly patchEvents: CoreHostPatchEvent[] = [];
  private snapshotReplayBaseline: SnapshotReplayBaseline = {
    baseServerSeq: 0,
    tick: 0,
    placements: [],
  };
  private readonly simState: SimState;
  private readonly toolContext: ToolContext;

  public constructor(private readonly options: DeterministicCommandAuthorityOptions) {
    const authorityState = new SimCoreRuntimeState({
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
      const outOfBoundsReject = createOutOfBoundsHostRejectOutcome();
      return this.recordReject(
        command.commandId,
        outOfBoundsReject.code,
        outOfBoundsReject.message,
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
    this.recordCommandOutcome(command.commandId, {
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
   * Mirrors Bridge V1/1 command-ingress acceptance intent from
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

    this.recordCommandOutcome(commandId, { kind: 'ack' });
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
      const hostOutcome = translateToolResultToHostOutcome(toolResult.result);
      if (hostOutcome.kind === 'ack') {
        return undefined;
      }
      return hostOutcome;
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
    const replayBaseServerSeq = Math.max(baseServerSeq, this.snapshotReplayBaseline.baseServerSeq);
    const snapshot = this.createSnapshot(replayBaseServerSeq);
    const tail = this.sequencedEvents.filter((event) => event.serverSeq > replayBaseServerSeq);
    return [snapshot, ...tail];
  }

  private recordReject(
    commandId: string,
    code: CoreHostRejectCode,
    message: string,
    tick: number,
  ): CoreHostEvent[] {
    this.recordCommandOutcome(commandId, {
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
    this.compactSnapshotReplayBaselineOnCadence(event.serverSeq);
    this.pruneSequencedHistoryAtOrBeforeReplayBaseline();
    this.enforceSequencedTailHistoryLimit();
    return event;
  }

  /**
   * Records one command outcome in a bounded idempotency cache.
   * Mirrors bounded historical-buffer intent in Micropolis C (`HISTLEN` /
   * `MISCHISTLEN` in `ref/micropolis/src/sim/headers/sim.h`) while adapting
   * to bridge command outcome dedupe retention.
   */
  private recordCommandOutcome(commandId: string, outcome: CommandOutcome): void {
    const hasExisting = this.commandOutcomes.has(commandId);
    this.commandOutcomes.set(commandId, outcome);
    if (!hasExisting) {
      this.commandOutcomeOrder.push(commandId);
    }
    this.pruneCommandOutcomes();
  }

  /**
   * Prunes command outcome cache to one bounded replay/idempotency window.
   * Mirrors Micropolis C fixed-size history retention in
   * `ref/micropolis/src/sim/s_alloc.c`, applied to deterministic fallback
   * command outcomes.
   */
  private pruneCommandOutcomes(): void {
    if (this.commandOutcomeOrder.length <= COMMAND_OUTCOME_HISTORY_LIMIT) {
      return;
    }
    const overflowCount = this.commandOutcomeOrder.length - COMMAND_OUTCOME_HISTORY_LIMIT;
    const prunedCommandIds = this.commandOutcomeOrder.splice(0, overflowCount);
    for (const commandId of prunedCommandIds) {
      this.commandOutcomes.delete(commandId);
    }
  }

  /**
   * Advances replay snapshot baseline on cadence boundaries.
   * Mirrors bridge snapshot-cadence ownership from
   * `packages/core-bridge/src/types.ts` (`CORE_BRIDGE_V1_DEFAULT_SNAPSHOT_CADENCE_TICKS`)
   * for deterministic fallback replay retention.
   */
  private compactSnapshotReplayBaselineOnCadence(serverSeq: number): void {
    if (
      serverSeq <= 0 ||
      serverSeq % SNAPSHOT_BASELINE_CADENCE_SERVER_SEQS !== 0 ||
      serverSeq <= SEQUENCED_TAIL_HISTORY_LIMIT
    ) {
      return;
    }
    this.advanceSnapshotReplayBaselineTo(serverSeq - SEQUENCED_TAIL_HISTORY_LIMIT);
  }

  /**
   * Enforces one strict sequenced-tail retention cap with baseline rollover.
   * Mirrors bounded replay retention policy needed in browser memory-constrained
   * environments while preserving deterministic replay construction.
   */
  private enforceSequencedTailHistoryLimit(): void {
    if (this.sequencedEvents.length <= SEQUENCED_TAIL_HISTORY_LIMIT) {
      return;
    }
    const overflowCount = this.sequencedEvents.length - SEQUENCED_TAIL_HISTORY_LIMIT;
    const cutoffEvent = this.sequencedEvents[overflowCount - 1];
    if (cutoffEvent !== undefined) {
      this.advanceSnapshotReplayBaselineTo(cutoffEvent.serverSeq);
    }
    this.pruneSequencedHistoryAtOrBeforeReplayBaseline();
  }

  /**
   * Advances replay baseline snapshot to one target server sequence.
   * Mirrors snapshot baseline + tail recovery from
   * `ref/micropolis/spec/integration/SPEC.md`, with bounded retention behavior
   * added for TypeScript fallback runtime safety.
   */
  private advanceSnapshotReplayBaselineTo(targetServerSeq: number): void {
    const normalizedTarget = normalizeServerSeq(targetServerSeq, this.serverSeq);
    if (normalizedTarget <= this.snapshotReplayBaseline.baseServerSeq) {
      return;
    }
    this.snapshotReplayBaseline = {
      baseServerSeq: normalizedTarget,
      tick: this.tickAtOrBefore(normalizedTarget),
      placements: this.placementsAtOrBefore(normalizedTarget),
    };
  }

  /**
   * Drops retained sequenced and patch events at or before replay baseline.
   * Mirrors rolling history-window behavior from Micropolis C census/history
   * maintenance in `ref/micropolis/src/sim/s_sim.c`, adapted to replay queues.
   */
  private pruneSequencedHistoryAtOrBeforeReplayBaseline(): void {
    const baselineServerSeq = this.snapshotReplayBaseline.baseServerSeq;
    while (
      this.sequencedEvents[0] !== undefined &&
      this.sequencedEvents[0].serverSeq <= baselineServerSeq
    ) {
      this.sequencedEvents.shift();
    }
    while (
      this.patchEvents[0] !== undefined &&
      this.patchEvents[0].serverSeq <= baselineServerSeq
    ) {
      this.patchEvents.shift();
    }
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
    const placements = this.snapshotReplayBaseline.placements.map((placement) => ({
      ...placement,
    }));
    for (const patchEvent of this.patchEvents) {
      if (patchEvent.serverSeq > baseServerSeq) {
        break;
      }
      if (patchEvent.serverSeq <= this.snapshotReplayBaseline.baseServerSeq) {
        continue;
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
    if (baseServerSeq <= this.snapshotReplayBaseline.baseServerSeq) {
      return this.snapshotReplayBaseline.tick;
    }

    for (let index = this.sequencedEvents.length - 1; index >= 0; index -= 1) {
      const event = this.sequencedEvents[index];
      if (event && event.serverSeq <= baseServerSeq) {
        return event.tick;
      }
    }

    return this.snapshotReplayBaseline.tick;
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
