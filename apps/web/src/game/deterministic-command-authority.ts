import type {
  CoreHostAckEvent,
  CoreHostCommand,
  CoreHostEvent,
  CoreHostPatchEvent,
  CoreHostPlacement,
  CoreHostRejectCode,
  CoreHostRejectEvent,
  HostMode,
} from './core-host';

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
  private readonly occupiedTiles = new Set<string>();
  private readonly commandOutcomes = new Map<string, CommandOutcome>();

  public constructor(private readonly options: DeterministicCommandAuthorityOptions) {}

  public processCommand(command: CoreHostCommand): CoreHostEvent[] {
    const previousOutcome = this.commandOutcomes.get(command.commandId);
    if (previousOutcome) {
      if (previousOutcome.kind === 'ack') {
        return [this.createAck(command.commandId)];
      }
      return [this.createReject(command.commandId, previousOutcome.code, previousOutcome.message)];
    }

    if (!isPlacementCoordinate(command.x, command.y)) {
      return this.recordReject(
        command.commandId,
        'OUT_OF_BOUNDS',
        'tool coordinates are out of bounds',
      );
    }

    const tileKey = toTileKey(command.x, command.y);
    if (this.occupiedTiles.has(tileKey)) {
      return this.recordReject(
        command.commandId,
        'TILE_OCCUPIED',
        'target tile is already occupied',
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

    return [this.createAck(command.commandId), this.createPatch(command.commandId, placement)];
  }

  private recordReject(
    commandId: string,
    code: CoreHostRejectCode,
    message: string,
  ): CoreHostEvent[] {
    this.commandOutcomes.set(commandId, {
      kind: 'reject',
      code,
      message,
    });
    return [this.createReject(commandId, code, message)];
  }

  private createAck(commandId: string): CoreHostAckEvent {
    return {
      type: 'ack',
      mode: this.options.mode,
      commandId,
      serverSeq: this.nextServerSeq(),
    };
  }

  private createReject(
    commandId: string,
    code: CoreHostRejectCode,
    message: string,
  ): CoreHostRejectEvent {
    return {
      type: 'reject',
      mode: this.options.mode,
      commandId,
      code,
      message,
      serverSeq: this.nextServerSeq(),
    };
  }

  private createPatch(commandId: string, placement: CoreHostPlacement): CoreHostPatchEvent {
    return {
      type: 'patch',
      mode: this.options.mode,
      commandId,
      placements: [placement],
      serverSeq: this.nextServerSeq(),
    };
  }

  private nextServerSeq(): number {
    this.serverSeq += 1;
    return this.serverSeq;
  }
}

function isPlacementCoordinate(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0;
}

function toTileKey(x: number, y: number): string {
  return `${x},${y}`;
}
