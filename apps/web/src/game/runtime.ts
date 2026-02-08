import type { CoreHost, CoreHostEvent, CoreHostEventListener } from './core-host';
import { HELLO_VERSION_MISMATCH_CODE, validateHelloCompatibility } from './handshake';

/**
 * Startup status for the web runtime bootstrap state machine.
 * Mirrors startup/connection gating intent mapped from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: explicit UI-facing startup states are a TypeScript runtime addition.
 */
export type RuntimeBootstrapStatus =
  | 'idle'
  | 'bootstrapping'
  | 'ready'
  | 'handshake-error'
  | 'runtime-error'
  | 'stopped';

/**
 * Runtime diagnostic details surfaced to UI for startup/runtime failures.
 * Mirrors deterministic integration diagnostics mapped from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: code + detail structure is intentionally explicit for browser UX.
 */
export interface RuntimeDiagnostic {
  readonly code: string;
  readonly message: string;
}

/**
 * External runtime state snapshot consumed by route components.
 * Mirrors deterministic startup sequencing mapped from
 * `ref/micropolis/spec/integration/SPEC.md`.
 */
export interface GameRuntimeState {
  readonly mode: CoreHost['mode'];
  readonly status: RuntimeBootstrapStatus;
  readonly diagnostic?: RuntimeDiagnostic;
}

/**
 * UI-friendly bootstrapping/error copy derived from runtime state.
 * Mirrors integration startup/fault visibility intent mapped from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: explicit text formatting is a web UX concern, not a C behavior.
 */
export interface RuntimeStatusViewModel {
  readonly headline: string;
  readonly detail: string;
  readonly isError: boolean;
}

/**
 * Runtime wrapper consumed by `apps/web` to manage host lifecycle wiring and
 * bootstrap state transitions.
 * Mirrors Micropolis simulation start/stop orchestration boundaries in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this wrapper centralizes bridge handshake UX uniformly across hosts.
 */
export interface GameRuntime {
  readonly host: CoreHost;
  readonly mode: CoreHost['mode'];
  start(): void;
  stop(): void;
  subscribe(listener: CoreHostEventListener): () => void;
  subscribeState(listener: (state: GameRuntimeState) => void): () => void;
  getState(): GameRuntimeState;
}

/**
 * Convert runtime bootstrap state into user-facing text.
 * Mirrors Stage startup diagnostics mapping from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: C integration mostly logs/prints; web presents explicit UI copy.
 */
export function describeRuntimeStatus(state: GameRuntimeState): RuntimeStatusViewModel {
  if (state.status === 'ready') {
    return {
      headline: `Connected (${state.mode})`,
      detail: 'Handshake complete. Authoritative events can now drive the UI.',
      isError: false,
    };
  }

  if (state.status === 'bootstrapping') {
    return {
      headline: `Connecting (${state.mode})`,
      detail: 'Opening host connection and waiting for hello handshake.',
      isError: false,
    };
  }

  if (state.status === 'handshake-error') {
    const diagnostic = state.diagnostic;
    return {
      headline: 'Handshake failed',
      detail: diagnostic
        ? `${diagnostic.code}: ${diagnostic.message}`
        : `${HELLO_VERSION_MISMATCH_CODE}: incompatible hello versions.`,
      isError: true,
    };
  }

  if (state.status === 'runtime-error') {
    const diagnostic = state.diagnostic;
    return {
      headline: 'Runtime error',
      detail: diagnostic
        ? `${diagnostic.code}: ${diagnostic.message}`
        : 'Unexpected host/runtime fault.',
      isError: true,
    };
  }

  if (state.status === 'stopped') {
    return {
      headline: 'Disconnected',
      detail: 'Runtime stopped and host connection closed.',
      isError: false,
    };
  }

  return {
    headline: 'Idle',
    detail: 'Runtime has not started yet.',
    isError: false,
  };
}

/**
 * Create a host-agnostic runtime that binds only to `CoreHost` and enforces
 * shared bootstrap/handshake behavior in local and DO modes.
 * Mirrors transport-independent command dispatch intent in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: unlike C globals, this runtime is created via dependency injection.
 */
export function createGameRuntime(host: CoreHost): GameRuntime {
  const eventListeners = new Set<CoreHostEventListener>();
  const stateListeners = new Set<(state: GameRuntimeState) => void>();
  let state: GameRuntimeState = {
    mode: host.mode,
    status: 'idle',
  };
  let started = false;

  const emitState = (): void => {
    for (const listener of stateListeners) {
      listener(state);
    }
  };

  const setState = (nextState: GameRuntimeState): void => {
    state = nextState;
    emitState();
  };

  host.subscribe((event: CoreHostEvent) => {
    for (const listener of eventListeners) {
      listener(event);
    }

    if (event.type === 'hello') {
      const result = validateHelloCompatibility(event.payload);
      if (result.ok) {
        setState({
          mode: host.mode,
          status: 'ready',
        });
        return;
      }

      setState({
        mode: host.mode,
        status: 'handshake-error',
        diagnostic: {
          code: result.mismatch.code,
          message: result.mismatch.message,
        },
      });
      started = false;
      host.disconnect();
      return;
    }

    if (event.type === 'error') {
      setState({
        mode: host.mode,
        status: 'runtime-error',
        diagnostic: {
          code: event.code,
          message: event.message,
        },
      });
      started = false;
      return;
    }

    if (event.type === 'disconnected' && !started && state.status !== 'handshake-error') {
      setState({
        mode: host.mode,
        status: 'stopped',
      });
    }
  });

  return {
    host,
    mode: host.mode,
    start() {
      if (started) {
        return;
      }

      started = true;
      setState({
        mode: host.mode,
        status: 'bootstrapping',
      });
      host.connect();
    },
    stop() {
      if (!started) {
        return;
      }

      started = false;
      host.disconnect();
      if (state.status !== 'handshake-error') {
        setState({
          mode: host.mode,
          status: 'stopped',
        });
      }
    },
    subscribe(listener: CoreHostEventListener): () => void {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    subscribeState(listener: (snapshot: GameRuntimeState) => void): () => void {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },
    getState(): GameRuntimeState {
      return state;
    },
  };
}
