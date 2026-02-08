import type {
  BridgeEnvelopeIdentity,
  ClientCommandEnvelope,
  ClientRequestSnapshotEnvelope,
  CorePatchPayload,
  CoreSnapshotPayload,
  HostAckEnvelope,
  HostErrorEnvelope,
  HostPatchEnvelope,
  HostRejectEnvelope,
  HostResyncEnvelope,
  HostSnapshotEnvelope,
} from './types.ts';

const DEFAULT_ROOM_ID = 'local-room';
const DEFAULT_CLIENT_ID = 'local-client';

interface MockAuthoritySnapshotState {
  appliedCommandCount: number;
  lastAppliedCommandId: string | undefined;
}

interface AppliedCommandRecord {
  kind: 'applied';
}

interface RejectedCommandRecord {
  kind: 'rejected';
  code: string;
  message: string;
}

type CommandRecord = AppliedCommandRecord | RejectedCommandRecord;

/**
 * Deterministic configuration for `MockAuthorityEngine`.
 * Mirrors tool outcome signaling in `ref/micropolis/src/sim/w_tool.c` and
 * tick-ordered simulation progression in `ref/micropolis/src/sim/s_sim.c`.
 * Parity note: explicit sequence/tick envelope metadata is intentionally
 * different from C's in-process Tcl return flow.
 */
export interface MockAuthorityEngineOptions {
  roomId?: string;
  clientId?: string;
  initialTick?: number;
  initialServerSeq?: number;
  rejectCommandTypes?: ReadonlyArray<string>;
}

/**
 * Deterministic command processing result emitted by the mock authority.
 * Mirrors command acceptance/rejection branching from
 * `ref/micropolis/src/sim/w_tool.c` with typed bridge events.
 */
export interface MockAuthorityCommandResult {
  duplicate: boolean;
  events: ReadonlyArray<HostAckEnvelope | HostRejectEnvelope | HostPatchEnvelope>;
}

/**
 * In-memory deterministic authority simulator for Stage 1 host workflows.
 * Mirrors command outcome semantics from `ref/micropolis/src/sim/w_tool.c`
 * and authoritative tick sequencing mindset from `ref/micropolis/src/sim/s_sim.c`.
 * Parity note: this is intentionally not a 1:1 Tcl command interpreter; it
 * emits canonical `@city/core-bridge` envelopes (`ack/reject/patch/snapshot/resync/error`).
 */
export class MockAuthorityEngine {
  private readonly identity: BridgeEnvelopeIdentity;
  private readonly rejectCommandTypes: ReadonlySet<string>;
  private readonly commandRecords = new Map<string, CommandRecord>();
  private tick: number;
  private nextServerSeq: number;
  private appliedCommandCount = 0;
  private lastAppliedCommandId: string | undefined;

  constructor(options: MockAuthorityEngineOptions = {}) {
    this.identity = {
      roomId: options.roomId ?? DEFAULT_ROOM_ID,
      clientId: options.clientId ?? DEFAULT_CLIENT_ID,
    };
    this.tick = options.initialTick ?? 0;
    this.nextServerSeq = options.initialServerSeq ?? 0;
    this.rejectCommandTypes = new Set(options.rejectCommandTypes ?? []);
  }

  /**
   * Process one client command deterministically into host events.
   * Mirrors `DoTool`-style success/failure outcome handling from
   * `ref/micropolis/src/sim/w_tool.c` and applies one authoritative tick
   * advance per accepted command (intent aligned with `Simulate` cadence in
   * `ref/micropolis/src/sim/s_sim.c`).
   */
  processCommand(envelope: ClientCommandEnvelope): MockAuthorityCommandResult {
    const existing = this.commandRecords.get(envelope.commandId);
    if (existing !== undefined) {
      if (existing.kind === 'applied') {
        return {
          duplicate: true,
          events: [this.createAck(envelope.commandId, this.tick)],
        };
      }

      return {
        duplicate: true,
        events: [this.createReject(envelope.commandId, existing.code, existing.message, this.tick)],
      };
    }

    const rejection = this.decideRejection(envelope);
    if (rejection !== undefined) {
      this.commandRecords.set(envelope.commandId, {
        kind: 'rejected',
        code: rejection.code,
        message: rejection.message,
      });
      return {
        duplicate: false,
        events: [
          this.createReject(
            envelope.commandId,
            rejection.code,
            rejection.message,
            this.tick,
            envelope,
          ),
        ],
      };
    }

    this.tick += 1;
    this.appliedCommandCount += 1;
    this.lastAppliedCommandId = envelope.commandId;
    this.commandRecords.set(envelope.commandId, { kind: 'applied' });

    const ack = this.createAck(envelope.commandId, this.tick, envelope);
    const patch = this.createPatch(this.tick, envelope);
    return {
      duplicate: false,
      events: [ack, patch],
    };
  }

  /**
   * Emit a deterministic snapshot response for reconnect/bootstrap flows.
   * Mirrors authoritative state checkpoint intent from integration spec notes
   * (`ref/micropolis/spec/integration/SPEC.md`) and simulation tick ownership
   * in `ref/micropolis/src/sim/s_sim.c`.
   */
  createSnapshot(envelope: ClientRequestSnapshotEnvelope): HostSnapshotEnvelope {
    return {
      kind: 'snapshot',
      ...this.resolveIdentity(envelope),
      tick: this.tick,
      serverSeq: this.claimServerSeq(),
      snapshot: this.buildSnapshotPayload(),
    };
  }

  /**
   * Emit a deterministic resync directive.
   * Mirrors bridge-level resync intent documented in
   * `ref/micropolis/spec/integration/SPEC.md`.
   * Parity note: explicit `resync` envelopes are intentionally new compared to
   * the original C transport.
   */
  requestResync(reason: string, identity?: BridgeEnvelopeIdentity): HostResyncEnvelope {
    return {
      kind: 'resync',
      ...this.resolveIdentity(identity),
      tick: this.tick,
      serverSeq: this.claimServerSeq(),
      reason,
    };
  }

  /**
   * Emit a deterministic unexpected fault envelope.
   * Mirrors unexpected-error channels around command/network boundaries in
   * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_net.c`.
   */
  reportError(
    code: string,
    message: string,
    identity?: BridgeEnvelopeIdentity,
    commandId?: string,
  ): HostErrorEnvelope {
    return {
      kind: 'error',
      ...this.resolveIdentity(identity),
      tick: this.tick,
      serverSeq: this.claimServerSeq(),
      code,
      message,
      commandId,
    };
  }

  private decideRejection(
    envelope: ClientCommandEnvelope,
  ): { code: string; message: string } | undefined {
    if (this.rejectCommandTypes.has(envelope.command.type)) {
      return {
        code: 'mock/rejected-command-type',
        message: `command type "${envelope.command.type}" is configured to reject`,
      };
    }

    const toolResultCode = readMockToolResultCode(envelope.command.payload);
    if (toolResultCode === undefined || toolResultCode === 1) {
      return undefined;
    }

    if (toolResultCode === -1) {
      return {
        code: 'tool/out-of-bounds',
        message: 'tool placement out of bounds',
      };
    }
    if (toolResultCode === -2) {
      return {
        code: 'tool/no-funds',
        message: 'tool placement rejected due to insufficient funds',
      };
    }
    return {
      code: 'tool/reject',
      message: 'tool placement rejected by authority',
    };
  }

  private createAck(
    commandId: string,
    tick: number,
    identity?: BridgeEnvelopeIdentity,
  ): HostAckEnvelope {
    return {
      kind: 'ack',
      ...this.resolveIdentity(identity),
      tick,
      serverSeq: this.claimServerSeq(),
      commandId,
    };
  }

  private createReject(
    commandId: string,
    code: string,
    message: string,
    tick: number,
    identity?: BridgeEnvelopeIdentity,
  ): HostRejectEnvelope {
    return {
      kind: 'reject',
      ...this.resolveIdentity(identity),
      tick,
      serverSeq: this.claimServerSeq(),
      commandId,
      code,
      message,
    };
  }

  private createPatch(tick: number, envelope: ClientCommandEnvelope): HostPatchEnvelope {
    return {
      kind: 'patch',
      ...this.resolveIdentity(envelope),
      tick,
      serverSeq: this.claimServerSeq(),
      patch: this.buildPatchPayload(envelope),
    };
  }

  private buildPatchPayload(envelope: ClientCommandEnvelope): CorePatchPayload {
    return {
      type: 'mock.command.applied',
      payload: {
        commandId: envelope.commandId,
        commandType: envelope.command.type,
        appliedCommandCount: this.appliedCommandCount,
      },
    };
  }

  private buildSnapshotPayload(): CoreSnapshotPayload {
    const state: MockAuthoritySnapshotState = {
      appliedCommandCount: this.appliedCommandCount,
      lastAppliedCommandId: this.lastAppliedCommandId,
    };
    return {
      type: 'mock.snapshot',
      payload: state,
    };
  }

  private resolveIdentity(identity?: BridgeEnvelopeIdentity): BridgeEnvelopeIdentity {
    const source = identity ?? this.identity;
    return {
      roomId: source.roomId,
      clientId: source.clientId,
    };
  }

  private claimServerSeq(): number {
    const serverSeq = this.nextServerSeq;
    this.nextServerSeq += 1;
    return serverSeq;
  }
}

const readMockToolResultCode = (payload: unknown): number | undefined => {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }

  const value = (payload as { mockToolResultCode?: unknown }).mockToolResultCode;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return undefined;
  }

  return value;
};
