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
 */
export interface DeterministicCommandAuthorityOptions {
  readonly mode: HostMode;
}

/**
 * Deterministic command authority used by both `LocalHost` and `DoHost`.
 * Mirrors tool success/reject/idempotency intent from `ref/micropolis/src/sim/w_tool.c`
 * where failed tools do not mutate map state and successful tools apply exactly once.
 * Parity note: this class is a bridge-layer simulator for Stage 4 host parity tests,
 * not a 1:1 replacement for Micropolis global simulation state.
 */
export class DeterministicCommandAuthority {
  private serverSeq = 0;
  private tick = 0;
  private readonly occupiedTiles = new Set<string>();
  private readonly commandOutcomes = new Map<string, CommandOutcome>();
  private readonly sequencedEvents: SequencedEvent[] = [];
  private readonly patchEvents: CoreHostPatchEvent[] = [];

  public constructor(private readonly options: DeterministicCommandAuthorityOptions) {}

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

    const tileKey = toTileKey(command.x, command.y);
    if (this.occupiedTiles.has(tileKey)) {
      return this.recordReject(
        command.commandId,
        'TILE_OCCUPIED',
        'target tile is already occupied',
        tick,
      );
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
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0;
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
