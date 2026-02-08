import type {
  CoreHostEnvelope,
  HostAckEnvelope,
  HostRejectEnvelope,
  HostRejectReason,
} from './types.ts';

/**
 * Host events that resolve one command's pending lifecycle.
 * Mirrors `DoTool` success/failure completion branches in
 * `ref/micropolis/src/sim/w_tool.c` while projecting them into bridge events.
 * Parity note: event typing is intentionally different from C integer return
 * codes so UIs can correlate command outcomes transport-independently.
 */
export type HostCommandOutcomeEnvelope = HostAckEnvelope | HostRejectEnvelope;

/**
 * Normalized command lifecycle resolution for pending-visual UX.
 * Mirrors `w_tool.c` success vs denial completion semantics and aligns with
 * bridge-level rollback handling for rejected commands.
 */
export type HostCommandOutcome =
  | {
      status: 'acked';
      commandId: string;
      rollbackPendingVisual: false;
      envelope: HostAckEnvelope;
    }
  | {
      status: 'rejected';
      commandId: string;
      rollbackPendingVisual: true;
      rejectReason: HostRejectReason;
      envelope: HostRejectEnvelope;
    };

/**
 * Returns whether an outbound host event is an `ack` or `reject`.
 * Mirrors tool command completion branches in `ref/micropolis/src/sim/w_tool.c`.
 * Parity note: this helper is intentionally bridge-specific and does not
 * represent C's direct callback/message side effects.
 */
export function isHostCommandOutcomeEnvelope(
  event: CoreHostEnvelope,
): event is HostCommandOutcomeEnvelope {
  return event.kind === 'ack' || event.kind === 'reject';
}

/**
 * Correlate one host event to a target `commandId` and normalize outcome shape.
 * Mirrors command identity correlation intent (`commandId`) from bridge v1 and
 * expected deny/success branches in `ref/micropolis/src/sim/w_tool.c`.
 * Parity note: this is intentionally different from C, where the UI callback is
 * invoked directly without a typed command outcome object.
 */
export function getHostCommandOutcome(
  event: CoreHostEnvelope,
  commandId: string,
): HostCommandOutcome | undefined {
  if (!isHostCommandOutcomeEnvelope(event) || event.commandId !== commandId) {
    return undefined;
  }

  if (event.kind === 'ack') {
    return {
      status: 'acked',
      commandId: event.commandId,
      rollbackPendingVisual: false,
      envelope: event,
    };
  }

  return {
    status: 'rejected',
    commandId: event.commandId,
    rollbackPendingVisual: true,
    rejectReason: event.reject.reason,
    envelope: event,
  };
}
