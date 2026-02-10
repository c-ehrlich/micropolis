import type { CoreBridgeServerSeqV1, CoreBridgeTickV1 } from './types.ts';

/**
 * Stored ordering cursor for replay/apply decisions.
 * Mirrors monotonic simulation progression in `ref/micropolis/src/sim/s_sim.c`
 * (`CityTime` advance via `Simulate`) and frame-loop continuity in
 * `ref/micropolis/src/sim/sim.c` (`SimFrame` in `sim_loop`).
 * Parity note: intentionally different from Micropolis C globals by exposing an
 * explicit transport-level state object for `tick` and `serverSeq` checks.
 */
export interface CoreBridgeV1SequenceState {
  readonly lastAppliedServerSeq: CoreBridgeServerSeqV1 | null;
  readonly lastTick: CoreBridgeTickV1 | null;
}

/**
 * Valid construction inputs for sequence state.
 * Mirrors persisted runtime cursor intent for reconnect/replay baselines.
 * Parity note: intentionally different from C global initialization by allowing
 * explicit state seeding in TypeScript.
 */
export type CoreBridgeV1SequenceStateSeed =
  | Readonly<{
      readonly lastAppliedServerSeq: CoreBridgeServerSeqV1;
      readonly lastTick: CoreBridgeTickV1;
    }>
  | Readonly<{
      readonly lastAppliedServerSeq?: undefined;
      readonly lastTick?: undefined;
    }>;

/**
 * Minimal event ordering metadata required by sequencing helpers.
 * Mirrors Bridge V1 bridge ordering invariants for `tick` + `serverSeq`.
 * Parity note: intentionally different from Micropolis internal calls by
 * isolating wire-order fields from payload details.
 */
export interface CoreBridgeV1SequencedEvent {
  readonly serverSeq: CoreBridgeServerSeqV1;
  readonly tick: CoreBridgeTickV1;
}

/**
 * Caller action categories for ordered event handling.
 * Mirrors deterministic dispatch branching in `ref/micropolis/src/sim/sim.c`.
 * Parity note: intentionally different from C side-effect-only flow by exposing
 * explicit decision enums for bridge clients.
 */
export enum CoreBridgeV1SequenceAction {
  APPLY = 'apply',
  DROP = 'drop',
  RESYNC = 'resync',
}

/**
 * Deterministic reasons attached to sequence decisions.
 * Mirrors monotonic-step assumptions in `ref/micropolis/src/sim/s_sim.c`.
 * Parity note: intentionally different from implicit C control flow by freezing
 * machine-readable reason codes for tests and adapters.
 */
export enum CoreBridgeV1SequenceReason {
  INITIAL_EVENT = 'initial_event',
  IN_ORDER = 'in_order',
  STALE_SERVER_SEQ = 'stale_server_seq',
  SERVER_SEQ_GAP = 'server_seq_gap',
  TICK_REGRESSION = 'tick_regression',
}

/**
 * Sequencing helper result consumed by host/client runtime callers.
 * Mirrors deterministic loop state transitions in `ref/micropolis/src/sim/sim.c`.
 * Parity note: intentionally different from C mutation-only flow by returning
 * an explicit action, reason, and next-state tuple.
 */
export interface CoreBridgeV1SequenceDecision {
  readonly action: CoreBridgeV1SequenceAction;
  readonly reason: CoreBridgeV1SequenceReason;
  readonly expectedServerSeq: CoreBridgeServerSeqV1;
  readonly nextState: CoreBridgeV1SequenceState;
}

/**
 * Construct sequence state for ordered replay/apply decisions.
 * Mirrors startup/reset initialization patterns in `ref/micropolis/src/sim/sim.c`
 * and cycle baselining in `ref/micropolis/src/sim/s_sim.c`.
 * Parity note: intentionally different from C static/global initialization by
 * exposing a pure helper for deterministic state setup.
 */
export function createCoreBridgeV1SequenceState(
  seed: CoreBridgeV1SequenceStateSeed = {},
): CoreBridgeV1SequenceState {
  const lastAppliedServerSeq = seed.lastAppliedServerSeq;
  const lastTick = seed.lastTick;

  if (lastAppliedServerSeq !== undefined && lastTick !== undefined) {
    return {
      lastAppliedServerSeq,
      lastTick,
    };
  }

  return {
    lastAppliedServerSeq: null,
    lastTick: null,
  };
}

/**
 * Compute the next expected server sequence from current state.
 * Mirrors strict forward-only update progression expected by Bridge V1 contracts.
 * Parity note: intentionally different from Micropolis C networking hooks by
 * formalizing sequence continuity as an explicit helper.
 */
export function getCoreBridgeV1ExpectedServerSeq(
  state: CoreBridgeV1SequenceState,
  incomingServerSeq: CoreBridgeServerSeqV1,
): CoreBridgeServerSeqV1 {
  if (state.lastAppliedServerSeq === null) {
    return incomingServerSeq;
  }

  return state.lastAppliedServerSeq + 1;
}

/**
 * Advance sequence state after a successful apply decision.
 * Mirrors the monotonic simulation progression model in
 * `ref/micropolis/src/sim/s_sim.c` (`CityTime` never decreases).
 * Parity note: intentionally different from implicit C global mutation by
 * returning a new immutable state object.
 */
export function advanceCoreBridgeV1SequenceState(
  _state: CoreBridgeV1SequenceState,
  event: CoreBridgeV1SequencedEvent,
): CoreBridgeV1SequenceState {
  return {
    lastAppliedServerSeq: event.serverSeq,
    lastTick: event.tick,
  };
}

/**
 * Evaluate one sequenced event against monotonic ordering invariants.
 * Mirrors `s_sim.c` / `sim.c` forward-only simulation loop assumptions:
 * no backward time movement and deterministic event ordering.
 * Parity note: intentionally different from Micropolis C transport, which has
 * no explicit `serverSeq`, by enforcing frozen Bridge V1 bridge invariants:
 * strict monotonic `serverSeq`, non-decreasing `tick`, stale drop, and gap resync.
 */
export function evaluateCoreBridgeV1SequenceDecision(
  state: CoreBridgeV1SequenceState,
  event: CoreBridgeV1SequencedEvent,
): CoreBridgeV1SequenceDecision {
  const expectedServerSeq = getCoreBridgeV1ExpectedServerSeq(state, event.serverSeq);

  if (state.lastAppliedServerSeq === null || state.lastTick === null) {
    return {
      action: CoreBridgeV1SequenceAction.APPLY,
      reason: CoreBridgeV1SequenceReason.INITIAL_EVENT,
      expectedServerSeq,
      nextState: advanceCoreBridgeV1SequenceState(state, event),
    };
  }

  if (event.serverSeq <= state.lastAppliedServerSeq) {
    return {
      action: CoreBridgeV1SequenceAction.DROP,
      reason: CoreBridgeV1SequenceReason.STALE_SERVER_SEQ,
      expectedServerSeq,
      nextState: state,
    };
  }

  if (event.serverSeq > expectedServerSeq) {
    return {
      action: CoreBridgeV1SequenceAction.RESYNC,
      reason: CoreBridgeV1SequenceReason.SERVER_SEQ_GAP,
      expectedServerSeq,
      nextState: state,
    };
  }

  if (event.tick < state.lastTick) {
    return {
      action: CoreBridgeV1SequenceAction.RESYNC,
      reason: CoreBridgeV1SequenceReason.TICK_REGRESSION,
      expectedServerSeq,
      nextState: state,
    };
  }

  return {
    action: CoreBridgeV1SequenceAction.APPLY,
    reason: CoreBridgeV1SequenceReason.IN_ORDER,
    expectedServerSeq,
    nextState: advanceCoreBridgeV1SequenceState(state, event),
  };
}
