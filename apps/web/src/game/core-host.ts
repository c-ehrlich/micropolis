import type { HelloPayload } from './handshake';

/**
 * Host mode selector for web authority transport.
 * Maps to Micropolis NET gating in `ref/micropolis/src/sim/w_sim.c`
 * (`SimCmdListenTo`/`SimCmdHearFrom`): local in-process authority vs networked authority.
 * Parity note: this is an intentional TypeScript composition switch, not a 1:1 C enum.
 */
export type HostMode = 'local' | 'do';

/**
 * Connection event emitted by `CoreHost` implementations.
 * Mirrors the authoritative runtime connect boundary implied by
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: typed event envelopes are a TypeScript bridge helper.
 */
export interface CoreHostConnectedEvent {
  type: 'connected';
  mode: HostMode;
}

/**
 * Disconnect event emitted by `CoreHost` implementations.
 * Mirrors the authoritative runtime disconnect boundary implied by
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: typed event envelopes are a TypeScript bridge helper.
 */
export interface CoreHostDisconnectedEvent {
  type: 'disconnected';
  mode: HostMode;
}

/**
 * Host handshake payload event emitted during startup.
 * Mirrors startup handoff expectations mapped from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: the bridge `hello` envelope is intentionally higher-level than C glue.
 */
export interface CoreHostHelloEvent {
  type: 'hello';
  mode: HostMode;
  payload: HelloPayload;
}

/**
 * Non-protocol host fault event emitted for unexpected failures.
 * Mirrors runtime-fault reporting intent mapped from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: explicit code/message fields are a TypeScript UX hardening seam.
 */
export interface CoreHostErrorEvent {
  type: 'error';
  mode: HostMode;
  code: string;
  message: string;
}

/**
 * Event emitted by `CoreHost` implementations.
 * Mirrors transport + startup lifecycle expectations mapped from
 * `ref/micropolis/spec/integration/SPEC.md`.
 */
export type CoreHostEvent =
  | CoreHostConnectedEvent
  | CoreHostDisconnectedEvent
  | CoreHostHelloEvent
  | CoreHostErrorEvent;

/**
 * Listener callback for `CoreHost` events.
 * Mirrors transport lifecycle observer needs around Micropolis runtime command routing
 * in `ref/micropolis/src/sim/w_sim.c`.
 */
export type CoreHostEventListener = (event: CoreHostEvent) => void;

/**
 * Host contract consumed by the web runtime.
 * Mirrors Micropolis' separation between simulation command routing and transport hooks
 * in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this is intentionally adapter-based for React/web composition.
 */
export interface CoreHost {
  readonly mode: HostMode;
  connect(): void;
  disconnect(): void;
  subscribe(listener: CoreHostEventListener): () => void;
}
