import type { CoreHost, CoreHostLifecycleEvent, CoreHostLifecycleListener } from './core-host';

/**
 * Runtime wrapper consumed by `apps/web` to manage host lifecycle wiring.
 * Mirrors Micropolis simulation start/stop orchestration boundaries in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this wrapper is intentionally minimal and host-agnostic.
 */
export interface GameRuntime {
  readonly host: CoreHost;
  readonly mode: CoreHost['mode'];
  start(): void;
  stop(): void;
  subscribe(listener: CoreHostLifecycleListener): () => void;
}

/**
 * Create a host-agnostic runtime that binds only to `CoreHost`.
 * Mirrors transport-independent command dispatch intent in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: unlike C globals, this runtime is created via dependency injection.
 */
export function createGameRuntime(host: CoreHost): GameRuntime {
  const listeners = new Set<CoreHostLifecycleListener>();
  host.subscribe((event: CoreHostLifecycleEvent) => {
    for (const listener of listeners) {
      listener(event);
    }
  });

  let started = false;

  return {
    host,
    mode: host.mode,
    start() {
      if (started) {
        return;
      }

      started = true;
      host.connect();
    },
    stop() {
      if (!started) {
        return;
      }

      started = false;
      host.disconnect();
    },
    subscribe(listener: CoreHostLifecycleListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
