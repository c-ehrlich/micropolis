import {
  CoreBridgeV1SequenceAction,
  CoreBridgeV1SequenceReason,
  createCoreBridgeV1SequenceState,
  evaluateCoreBridgeV1SequenceDecision,
} from '../../../../../packages/core-bridge/src/sequencing.ts';
import {
  createInitialRuntimeHudState,
  projectRuntimeHudState,
  type RuntimeHudState,
} from './hud-state.ts';
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
  isStage2ToolCommand,
  type Stage2ClientCommand,
  type Stage2ToolCommand,
} from './protocol.ts';

/**
 * Lifecycle phases for the web host-client runtime.
 * Mirrors high-level command/update lifecycle sequencing in
 * `ref/micropolis/src/sim/w_sim.c`, adapted to bridge transport states.
 */
export type WebRuntimePhase =
  | 'disconnected'
  | 'connecting'
  | 'reconnecting'
  | 'negotiating'
  | 'ready'
  | 'resyncing'
  | 'failed';

/**
 * Visual-only pending tool marker tracked by `commandId`.
 * Mirrors the pending tool UX intent behind `DoPendTool` in
 * `ref/micropolis/src/sim/w_tool.c`.
 * Difference: Stage 2 stores pending markers in client runtime state instead
 * of driving Tcl callbacks directly.
 */
export interface PendingToolCommandVisual {
  commandId: string;
  command: Stage2ToolCommand;
}

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
  hudState: RuntimeHudState;
  pendingTools: readonly PendingToolCommandVisual[];
  lastRejectReason: string | null;
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
      reason: 'sequence-gap' | 'resync';
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
  | 'hello-rejected'
  | 'pending-enqueued';

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
    hudState: createInitialRuntimeHudState(),
    pendingTools: [],
    lastRejectReason: null,
  };
}

/**
 * Adds a visual-only pending marker for a newly sent Stage 2 tool command.
 * Mirrors `DoPendTool` pending command UI behavior in
 * `ref/micropolis/src/sim/w_tool.c`.
 * Difference: this only tracks a local marker and does not mutate authoritative
 * map state, which still arrives via host `patch`/`snapshot` envelopes.
 */
export function enqueuePendingToolCommandVisual(
  state: WebRuntimeState,
  commandId: string,
  command: Stage2ClientCommand,
): WebRuntimeState {
  if (!isStage2ToolCommand(command)) {
    return state;
  }

  const hasCommand = state.pendingTools.some((pending) => pending.commandId === commandId);
  if (hasCommand) {
    return state;
  }

  return {
    ...state,
    pendingTools: [...state.pendingTools, { commandId, command }],
    lastRejectReason: null,
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

  const sequenceDecision = evaluateCoreBridgeV1SequenceDecision(
    createCoreBridgeV1SequenceState({
      lastAppliedServerSeq: state.lastAppliedServerSeq,
      lastTick: state.lastAppliedTick,
    }),
    {
      serverSeq: envelope.serverSeq,
      tick: envelope.tick,
    },
  );

  if (sequenceDecision.action === CoreBridgeV1SequenceAction.DROP) {
    return {
      state,
      outcome: 'dropped-stale',
      effect: { kind: 'none' },
    };
  }

  if (sequenceDecision.action === CoreBridgeV1SequenceAction.RESYNC) {
    if (envelope.kind === 'resync') {
      return applyResyncDirective(state, envelope);
    }

    const canApplyResyncSnapshot =
      state.phase === 'resyncing' &&
      envelope.kind === 'snapshot' &&
      sequenceDecision.reason === CoreBridgeV1SequenceReason.SERVER_SEQ_GAP;
    if (canApplyResyncSnapshot) {
      return applySequencedEnvelope(state, envelope);
    }

    return {
      state: enterResyncingPhase(state),
      outcome: 'gap-detected',
      effect: {
        kind: 'request_snapshot',
        reason: 'sequence-gap',
        fromServerSeq: sequenceDecision.expectedServerSeq,
      },
    };
  }

  if (envelope.kind === 'resync') {
    return applyResyncDirective(state, envelope);
  }

  return applySequencedEnvelope(state, envelope);
}

function applySequencedEnvelope(
  state: WebRuntimeState,
  envelope: Exclude<HostEnvelope, { kind: 'hello' | 'resync' }>,
): WebRuntimeReducerResult {
  const phase = envelope.kind === 'snapshot' ? 'ready' : state.phase;
  const settledState = settlePendingToolCommand(state, envelope);
  const mapState = projectRuntimeMapState(settledState.mapState, envelope);
  const hudState = projectRuntimeHudState(settledState.hudState, envelope);

  return {
    state: {
      ...settledState,
      phase,
      lastAppliedServerSeq: envelope.serverSeq,
      lastAppliedTick: envelope.tick,
      mapState,
      hudState,
    },
    outcome: 'applied',
    effect: { kind: 'none' },
  };
}

function applyResyncDirective(
  state: WebRuntimeState,
  envelope: Extract<HostEnvelope, { kind: 'resync' }>,
): WebRuntimeReducerResult {
  const resyncState = enterResyncingPhase(state);
  const mapState = projectRuntimeMapState(resyncState.mapState, envelope);
  const hudState = projectRuntimeHudState(resyncState.hudState, envelope);

  return {
    state: {
      ...resyncState,
      lastAppliedServerSeq: envelope.serverSeq,
      lastAppliedTick: envelope.tick,
      mapState,
      hudState,
    },
    outcome: 'applied',
    effect: {
      kind: 'request_snapshot',
      reason: 'resync',
      fromServerSeq: envelope.serverSeq + 1,
    },
  };
}

function enterResyncingPhase(state: WebRuntimeState): WebRuntimeState {
  if (
    state.phase === 'resyncing' &&
    state.pendingTools.length === 0 &&
    state.lastRejectReason === null
  ) {
    return state;
  }

  return {
    ...state,
    phase: 'resyncing',
    pendingTools: [],
    lastRejectReason: null,
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
    return envelope.reason ?? envelope.message ?? 'host rejected hello';
  }

  if (envelope.roomId !== state.roomId) {
    return `room mismatch: expected ${state.roomId}, got ${envelope.roomId}`;
  }

  if (envelope.clientId !== state.clientId) {
    return `client mismatch: expected ${state.clientId}, got ${envelope.clientId}`;
  }

  return null;
}

/**
 * Settles client-side pending tool markers after host command outcomes.
 * Mirrors `DoTool` plus pending tool completion intent in
 * `ref/micropolis/src/sim/w_tool.c`.
 * Difference: Stage 2 rollback is purely visual (remove pending marker) while
 * authoritative map rollback remains host-owned through envelope streams.
 */
function settlePendingToolCommand(state: WebRuntimeState, envelope: HostEnvelope): WebRuntimeState {
  if (envelope.kind !== 'ack' && envelope.kind !== 'reject') {
    return state;
  }

  const pendingTools = state.pendingTools.filter(
    (pending) => pending.commandId !== envelope.commandId,
  );
  const nextRejectReason = envelope.kind === 'reject' ? envelope.reason : state.lastRejectReason;

  if (
    pendingTools.length === state.pendingTools.length &&
    nextRejectReason === state.lastRejectReason
  ) {
    return state;
  }

  return {
    ...state,
    pendingTools,
    lastRejectReason: nextRejectReason,
  };
}
