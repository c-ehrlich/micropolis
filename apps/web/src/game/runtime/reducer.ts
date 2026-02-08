import {
  createInitialRuntimeMapState,
  projectRuntimeMapState,
  type RuntimeMapState,
} from './map-state.ts';
import {
  DEFAULT_LOCAL_CLIENT_ID,
  DEFAULT_LOCAL_ROOM_ID,
  type HostEnvelope,
  isSequencedHostEnvelope,
} from './protocol.ts';

/**
 * Lifecycle phases for the web host-client runtime.
 * Mirrors high-level command/update lifecycle sequencing in
 * `ref/micropolis/src/sim/w_sim.c`, adapted to bridge transport states.
 */
export type WebRuntimePhase =
  | 'disconnected'
  | 'connecting'
  | 'negotiating'
  | 'ready'
  | 'resyncing'
  | 'failed';

/**
 * Mutable state projection for Stage 2 host-client runtime behavior.
 * Mirrors authoritative update tracking intent from
 * `ref/micropolis/src/sim/w_update.c`; this is intentionally a bridge-client
 * state snapshot rather than Micropolis global variables.
 */
export interface WebRuntimeState {
  phase: WebRuntimePhase;
  roomId: string;
  clientId: string;
  handshakeComplete: boolean;
  handshakeError: string | null;
  lastAppliedServerSeq: number;
  lastAppliedTick: number;
  mapState: RuntimeMapState;
}

/**
 * Side-effect emitted by the envelope reducer.
 * Mirrors refresh/resync intent from Micropolis update entry points in
 * `ref/micropolis/src/sim/w_update.c`, adapted to bridge snapshot requests.
 */
export type WebRuntimeReducerEffect =
  | {
      kind: 'none';
    }
  | {
      kind: 'request_snapshot';
      reason: 'sequence-gap';
      fromServerSeq: number;
    };

/**
 * Outcome emitted by one envelope reduction step.
 * Mirrors command/update routing outcomes from `ref/micropolis/src/sim/w_sim.c`,
 * adapted into explicit client runtime categories.
 */
export type WebRuntimeReducerOutcome =
  | 'applied'
  | 'dropped-stale'
  | 'gap-detected'
  | 'ignored-until-hello'
  | 'hello-rejected';

/**
 * Result object returned by envelope reduction.
 * Mirrors deterministic command/update processing intent in
 * `ref/micropolis/src/sim/w_sim.c`, with explicit reducer metadata for tests.
 */
export interface WebRuntimeReducerResult {
  state: WebRuntimeState;
  outcome: WebRuntimeReducerOutcome;
  effect: WebRuntimeReducerEffect;
}

/**
 * Creates the baseline Stage 2 web runtime state.
 * Mirrors deterministic local identity defaults and startup ordering from
 * `ref/micropolis/src/sim/w_sim.c`; this intentionally stores reducer state in
 * one immutable object instead of C globals.
 */
export function createInitialWebRuntimeState(
  overrides: Partial<Pick<WebRuntimeState, 'roomId' | 'clientId'>> = {},
): WebRuntimeState {
  return {
    phase: 'disconnected',
    roomId: overrides.roomId ?? DEFAULT_LOCAL_ROOM_ID,
    clientId: overrides.clientId ?? DEFAULT_LOCAL_CLIENT_ID,
    handshakeComplete: false,
    handshakeError: null,
    lastAppliedServerSeq: 0,
    lastAppliedTick: 0,
    mapState: createInitialRuntimeMapState(),
  };
}

/**
 * Applies one host envelope to runtime state with stale/gap handling.
 * Mirrors ordered update handling intent from `ref/micropolis/src/sim/w_update.c`
 * and command/event gatekeeping from `ref/micropolis/src/sim/w_sim.c`.
 */
export function reduceHostEnvelope(
  state: WebRuntimeState,
  envelope: HostEnvelope,
): WebRuntimeReducerResult {
  if (envelope.kind === 'hello') {
    return reduceHelloEnvelope(state, envelope);
  }

  if (!state.handshakeComplete) {
    return {
      state,
      outcome: 'ignored-until-hello',
      effect: { kind: 'none' },
    };
  }

  if (!isSequencedHostEnvelope(envelope)) {
    return {
      state,
      outcome: 'ignored-until-hello',
      effect: { kind: 'none' },
    };
  }

  if (envelope.serverSeq <= state.lastAppliedServerSeq || envelope.tick < state.lastAppliedTick) {
    return {
      state,
      outcome: 'dropped-stale',
      effect: { kind: 'none' },
    };
  }

  const expectedServerSeq = state.lastAppliedServerSeq + 1;
  if (envelope.serverSeq > expectedServerSeq) {
    return {
      state: {
        ...state,
        phase: 'resyncing',
      },
      outcome: 'gap-detected',
      effect: {
        kind: 'request_snapshot',
        reason: 'sequence-gap',
        fromServerSeq: expectedServerSeq,
      },
    };
  }

  const phase =
    envelope.kind === 'snapshot' ? 'ready' : envelope.kind === 'resync' ? 'resyncing' : state.phase;
  const mapState = projectRuntimeMapState(state.mapState, envelope);

  return {
    state: {
      ...state,
      phase,
      lastAppliedServerSeq: envelope.serverSeq,
      lastAppliedTick: envelope.tick,
      mapState,
    },
    outcome: 'applied',
    effect: { kind: 'none' },
  };
}

/**
 * Applies one hello envelope and validates room/client identity and version lock.
 * Mirrors startup validation gatekeeping intent from
 * `ref/micropolis/src/sim/w_sim.c`; this intentionally models explicit
 * accept/reject envelope semantics instead of Tcl command return codes.
 */
function reduceHelloEnvelope(
  state: WebRuntimeState,
  envelope: Extract<HostEnvelope, { kind: 'hello' }>,
): WebRuntimeReducerResult {
  const rejectionReason = getHelloRejectionReason(state, envelope);
  if (rejectionReason !== null) {
    return {
      state: {
        ...state,
        phase: 'failed',
        handshakeComplete: false,
        handshakeError: rejectionReason,
      },
      outcome: 'hello-rejected',
      effect: { kind: 'none' },
    };
  }

  return {
    state: {
      ...state,
      phase: 'ready',
      roomId: envelope.roomId,
      clientId: envelope.clientId,
      handshakeComplete: true,
      handshakeError: null,
    },
    outcome: 'applied',
    effect: { kind: 'none' },
  };
}

/**
 * Computes a deterministic hello rejection reason when negotiation mismatches.
 * Mirrors strict command argument validation style in
 * `ref/micropolis/src/sim/w_sim.c`, adapted to typed bridge hello envelopes.
 */
function getHelloRejectionReason(
  state: WebRuntimeState,
  envelope: Extract<HostEnvelope, { kind: 'hello' }>,
): string | null {
  if (!envelope.accepted) {
    return envelope.reason ?? 'host rejected hello';
  }

  if (envelope.roomId !== state.roomId) {
    return `room mismatch: expected ${state.roomId}, got ${envelope.roomId}`;
  }

  if (envelope.clientId !== state.clientId) {
    return `client mismatch: expected ${state.clientId}, got ${envelope.clientId}`;
  }

  return null;
}
