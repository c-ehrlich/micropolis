/**
 * Host mode selector for web authority transport.
 * Maps to Micropolis NET gating in `ref/micropolis/src/sim/w_sim.c`
 * (`SimCmdListenTo`/`SimCmdHearFrom`): local in-process authority vs networked authority.
 * Parity note: this is an intentional TypeScript composition switch, not a 1:1 C enum.
 */
export type HostMode = 'local' | 'do';

/**
 * Lifecycle event emitted by `CoreHost` implementations.
 * Mirrors the authoritative runtime connect/disconnect boundary implied by the
 * `sim` command transport entry points in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: event envelopes are a TypeScript runtime helper and do not exist in C.
 */
export interface CoreHostLifecycleEvent {
  type: 'connected' | 'disconnected';
  mode: HostMode;
}

/**
 * Listener callback for `CoreHost` lifecycle events.
 * Mirrors transport lifecycle observer needs around Micropolis runtime command routing
 * in `ref/micropolis/src/sim/w_sim.c`.
 */
export type CoreHostLifecycleListener = (event: CoreHostLifecycleEvent) => void;

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
  subscribe(listener: CoreHostLifecycleListener): () => void;
}
