import type {
  BridgeEnvelopeIdentity,
  ClientCommandEnvelope,
  ClientRequestSnapshotEnvelope,
  CorePatchPayload,
  CoreSnapshotPayload,
  HostAckEnvelope,
  HostErrorEnvelope,
  HostPatchEnvelope,
  HostRejectCode,
  HostRejectEnvelope,
  HostRejectReason,
  HostResyncEnvelope,
  HostSnapshotEnvelope,
} from './types.ts';
import { HOST_REJECT_CODE, HOST_REJECT_REASON } from './types.ts';

const DEFAULT_ROOM_ID = 'local-room';
const DEFAULT_CLIENT_ID = 'local-client';
const DEFAULT_SNAPSHOT_CADENCE_TICKS = 64;

interface MockAuthoritySnapshotState {
  appliedCommandCount: number;
  lastAppliedCommandId: string | undefined;
}

interface MockAuthoritySnapshotBaseline {
  stateServerSeq: number;
}

interface AppliedCommandRecord {
  kind: 'applied';
}

interface RejectedCommandRecord {
  kind: 'rejected';
  code: HostRejectCode;
  reason: HostRejectReason;
  message: string;
}

type CommandRecord = AppliedCommandRecord | RejectedCommandRecord;

interface CommandRejectionDecision {
  code: HostRejectCode;
  reason: HostRejectReason;
  message: string;
}

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
  /**
   * Snapshot baseline rebuild cadence in authoritative ticks.
   * Mirrors periodic checkpoint intent used for reconnect recovery in
   * `ref/micropolis/spec/integration/SPEC.md`.
   * Parity note: this explicit bridge cadence is intentionally different from
   * C's in-process runtime state ownership.
   */
  snapshotCadenceTicks?: number;
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
 * Deterministic result for `request_snapshot` handling.
 * Mirrors reconnect recovery intent from `ref/micropolis/spec/integration/SPEC.md`,
 * where clients either bootstrap from snapshot, replay a patch tail, or are
 * instructed to resync when sequence gaps are detected.
 */
export interface MockAuthoritySnapshotRequestResult {
  mode: 'snapshot' | 'patch-tail' | 'resync';
  events: ReadonlyArray<HostSnapshotEnvelope | HostPatchEnvelope | HostResyncEnvelope>;
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
  private readonly snapshotCadenceTicks: number;
  private readonly patchTail: HostPatchEnvelope[] = [];
  private tick: number;
  private nextServerSeq: number;
  private latestServerSeq: number;
  private appliedCommandCount = 0;
  private lastAppliedCommandId: string | undefined;
  private snapshotBaseline: MockAuthoritySnapshotBaseline;

  constructor(options: MockAuthorityEngineOptions = {}) {
    this.identity = {
      roomId: options.roomId ?? DEFAULT_ROOM_ID,
      clientId: options.clientId ?? DEFAULT_CLIENT_ID,
    };
    this.tick = options.initialTick ?? 0;
    this.nextServerSeq = options.initialServerSeq ?? 0;
    this.latestServerSeq = this.nextServerSeq - 1;
    this.rejectCommandTypes = new Set(options.rejectCommandTypes ?? []);
    this.snapshotCadenceTicks = normalizeSnapshotCadenceTicks(options.snapshotCadenceTicks);
    this.snapshotBaseline = {
      stateServerSeq: this.latestServerSeq,
    };
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
        events: [
          this.createReject(
            envelope.commandId,
            existing.code,
            existing.reason,
            existing.message,
            this.tick,
          ),
        ],
      };
    }

    const rejection = this.decideRejection(envelope);
    if (rejection !== undefined) {
      this.commandRecords.set(envelope.commandId, {
        kind: 'rejected',
        code: rejection.code,
        reason: rejection.reason,
        message: rejection.message,
      });
      return {
        duplicate: false,
        events: [
          this.createReject(
            envelope.commandId,
            rejection.code,
            rejection.reason,
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
    this.patchTail.push(patch);
    this.maybeRebuildSnapshotBaseline(patch.serverSeq);
    return {
      duplicate: false,
      events: [ack, patch],
    };
  }

  /**
   * Resolve one snapshot request into bootstrap snapshot, patch-tail replay,
   * or resync when the requested replay window is no longer available.
   * Mirrors recovery sequencing intent from
   * `ref/micropolis/spec/integration/SPEC.md`.
   */
  handleSnapshotRequest(
    envelope: ClientRequestSnapshotEnvelope,
  ): MockAuthoritySnapshotRequestResult {
    const afterServerSeq = envelope.afterServerSeq;
    if (afterServerSeq === undefined) {
      return {
        mode: 'snapshot',
        events: [this.createSnapshot(envelope)],
      };
    }

    if (afterServerSeq > this.latestServerSeq) {
      return {
        mode: 'resync',
        events: [this.requestResync('server-seq-ahead', envelope)],
      };
    }

    if (afterServerSeq < this.snapshotBaseline.stateServerSeq) {
      return {
        mode: 'resync',
        events: [this.requestResync('server-seq-gap', envelope)],
      };
    }

    const replayEvents = this.patchTail
      .filter((patch) => patch.serverSeq > afterServerSeq)
      .map((patch) => this.retargetPatchIdentity(patch, envelope))
      .sort((left, right) => left.serverSeq - right.serverSeq);
    return {
      mode: 'patch-tail',
      events: replayEvents,
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

  private decideRejection(envelope: ClientCommandEnvelope): CommandRejectionDecision | undefined {
    if (this.rejectCommandTypes.has(envelope.command.type)) {
      return {
        code: HOST_REJECT_CODE.MOCK_REJECTED_COMMAND_TYPE,
        reason: HOST_REJECT_REASON.COMMAND_TYPE_REJECTED,
        message: `command type "${envelope.command.type}" is configured to reject`,
      };
    }

    const toolResultCode = readMockToolResultCode(envelope.command.payload);
    if (toolResultCode === undefined || toolResultCode === 1) {
      return undefined;
    }

    if (toolResultCode === -1) {
      return {
        code: HOST_REJECT_CODE.TOOL_OUT_OF_BOUNDS,
        reason: HOST_REJECT_REASON.OUT_OF_BOUNDS,
        message: 'tool placement out of bounds',
      };
    }
    if (toolResultCode === -2) {
      return {
        code: HOST_REJECT_CODE.TOOL_NO_FUNDS,
        reason: HOST_REJECT_REASON.INSUFFICIENT_FUNDS,
        message: 'tool placement rejected due to insufficient funds',
      };
    }
    if (toolResultCode === -3) {
      return {
        code: HOST_REJECT_CODE.TOOL_PENDING_APPROVAL,
        reason: HOST_REJECT_REASON.PENDING_APPROVAL,
        message: 'tool placement requires multiplayer approval',
      };
    }
    return {
      code: HOST_REJECT_CODE.TOOL_RULE_REJECT,
      reason: HOST_REJECT_REASON.RULES,
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
    code: HostRejectCode,
    reason: HostRejectReason,
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
      reject: {
        reason,
        pendingVisual: {
          action: 'rollback',
          commandId,
        },
      },
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

  private retargetPatchIdentity(
    patch: HostPatchEnvelope,
    identity?: BridgeEnvelopeIdentity,
  ): HostPatchEnvelope {
    return {
      ...patch,
      ...this.resolveIdentity(identity),
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

  private maybeRebuildSnapshotBaseline(stateServerSeq: number): void {
    if (this.tick <= 0 || this.tick % this.snapshotCadenceTicks !== 0) {
      return;
    }

    this.snapshotBaseline = {
      stateServerSeq,
    };
    this.trimPatchTail();
  }

  private trimPatchTail(): void {
    const oldestRetainedServerSeq = this.snapshotBaseline.stateServerSeq + 1;
    while (
      this.patchTail[0] !== undefined &&
      this.patchTail[0].serverSeq < oldestRetainedServerSeq
    ) {
      this.patchTail.shift();
    }
  }

  private claimServerSeq(): number {
    const serverSeq = this.nextServerSeq;
    this.nextServerSeq += 1;
    this.latestServerSeq = serverSeq;
    return serverSeq;
  }
}

const normalizeSnapshotCadenceTicks = (value: number | undefined): number => {
  if (value === undefined || !Number.isInteger(value) || value <= 0) {
    return DEFAULT_SNAPSHOT_CADENCE_TICKS;
  }
  return value;
};

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
