import type { CoreHost, CoreHostLifecycleEvent, CoreHostLifecycleListener } from './core-host';

/**
 * Durable Object-backed host placeholder for the web runtime.
 * Mirrors Micropolis NET-enabled runtime command transport intent in
 * `ref/micropolis/src/sim/w_sim.c` (`SimCmdListenTo`/`SimCmdHearFrom`).
 * Parity note: this class keeps the same lifecycle API as `LocalHost` while
 * Stage 4 glue centralizes host switching in composition.
 */
export class DoHost implements CoreHost {
  public readonly mode = 'do' as const;
  private readonly listeners = new Set<CoreHostLifecycleListener>();

  public connect(): void {
    this.emitLifecycle({ type: 'connected', mode: this.mode });
  }

  public disconnect(): void {
    this.emitLifecycle({ type: 'disconnected', mode: this.mode });
  }

  public subscribe(listener: CoreHostLifecycleListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitLifecycle(event: CoreHostLifecycleEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
