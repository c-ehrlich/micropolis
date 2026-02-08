import {
  type CoreHost,
  type CoreHostConnection,
  DEFAULT_CORE_VERSION,
  DEFAULT_LOCAL_CLIENT_ID,
  DEFAULT_LOCAL_ROOM_ID,
  DEFAULT_PROTOCOL_VERSION,
  type HostEnvelope,
  type Stage2ClientCommand,
} from './protocol.ts';
import {
  createInitialWebRuntimeState,
  enqueuePendingToolCommandVisual,
  reduceHostEnvelope,
  type WebRuntimeReducerOutcome,
  type WebRuntimeState,
} from './reducer.ts';

/**
 * Listener payload for runtime state transitions and routed envelopes.
 * Mirrors deterministic command/update progression intent from
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_update.c`.
 */
export interface WebRuntimeEvent {
  state: WebRuntimeState;
  outcome: WebRuntimeReducerOutcome;
  envelope?: HostEnvelope;
}

/**
 * Config for creating the Stage 2 web host-client runtime.
 * Mirrors startup wiring intent in `ref/micropolis/src/sim/w_sim.c`; unlike C,
 * dependencies are injected explicitly through a host adapter.
 */
export interface CreateWebHostRuntimeOptions {
  host: CoreHost;
  roomId?: string;
  clientId?: string;
  protocolVersion?: string;
  coreVersion?: string;
}

/**
 * Runtime API consumed by web UI layers.
 * Mirrors command/update control surfaces in `ref/micropolis/src/sim/w_sim.c`
 * with explicit bridge-envelope methods instead of Tcl command strings.
 */
export interface WebHostRuntime {
  connect(): void;
  disconnect(): void;
  sendCommand(commandId: string, command: Stage2ClientCommand): void;
  requestSnapshot(reason?: 'manual' | 'resync'): void;
  getState(): WebRuntimeState;
  subscribe(listener: (event: WebRuntimeEvent) => void): () => void;
}

/**
 * Creates the Stage 2 web runtime that negotiates hello and routes envelopes.
 * Mirrors deterministic startup/update orchestration from
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_update.c`.
 * Difference from C: this is a pure TypeScript adapter around a `CoreHost`
 * abstraction instead of direct Tcl/Tk command dispatch.
 */
export function createWebHostRuntime(options: CreateWebHostRuntimeOptions): WebHostRuntime {
  const roomId = options.roomId ?? DEFAULT_LOCAL_ROOM_ID;
  const clientId = options.clientId ?? DEFAULT_LOCAL_CLIENT_ID;
  const protocolVersion = options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION;
  const coreVersion = options.coreVersion ?? DEFAULT_CORE_VERSION;

  let state = createInitialWebRuntimeState({ roomId, clientId });
  let connection: CoreHostConnection | undefined;
  const listeners = new Set<(event: WebRuntimeEvent) => void>();

  const emit = (event: WebRuntimeEvent): void => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  const setState = (nextState: WebRuntimeState, outcome: WebRuntimeReducerOutcome): void => {
    state = nextState;
    emit({ state, outcome });
  };

  const handleEnvelope = (envelope: HostEnvelope): void => {
    const result = reduceHostEnvelope(state, envelope);
    state = result.state;
    emit({
      state,
      outcome: result.outcome,
      envelope,
    });

    if (result.effect.kind === 'request_snapshot' && connection !== undefined) {
      connection.send({
        kind: 'request_snapshot',
        roomId: state.roomId,
        clientId: state.clientId,
        reason: result.effect.reason,
        fromServerSeq: result.effect.fromServerSeq,
      });
    }
  };

  return {
    connect() {
      if (connection !== undefined) {
        return;
      }

      setState(
        {
          ...state,
          phase: 'connecting',
        },
        'applied',
      );

      connection = options.host.connect(handleEnvelope);
      setState(
        {
          ...state,
          phase: 'negotiating',
        },
        'applied',
      );

      connection.send({
        kind: 'hello',
        roomId,
        clientId,
        protocolVersion,
        coreVersion,
      });
    },
    disconnect() {
      if (connection === undefined) {
        return;
      }

      connection.disconnect();
      connection = undefined;
      setState(
        {
          ...state,
          phase: 'disconnected',
          handshakeComplete: false,
          pendingTools: [],
        },
        'applied',
      );
    },
    sendCommand(commandId, command) {
      if (connection === undefined) {
        throw new Error('Cannot send command before connect()');
      }

      const nextState = enqueuePendingToolCommandVisual(state, commandId, command);
      if (nextState !== state) {
        setState(nextState, 'pending-enqueued');
      }

      connection.send({
        kind: 'command',
        roomId: state.roomId,
        clientId: state.clientId,
        commandId,
        command,
      });
    },
    requestSnapshot(reason = 'manual') {
      if (connection === undefined) {
        throw new Error('Cannot request snapshot before connect()');
      }

      connection.send({
        kind: 'request_snapshot',
        roomId: state.roomId,
        clientId: state.clientId,
        reason,
        fromServerSeq: state.lastAppliedServerSeq + 1,
      });
    },
    getState() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
