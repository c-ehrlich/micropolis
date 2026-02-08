import type { CoreHost, CoreHostLifecycleEvent, CoreHostLifecycleListener } from './core-host';

/**
 * Local in-process host for the web runtime.
 * Mirrors single-process command dispatch behavior in `ref/micropolis/src/sim/w_sim.c`
 * where simulation commands are handled without NET transport.
 * Parity note: lifecycle events are an intentional TypeScript abstraction.
 */
export class LocalHost implements CoreHost {
  public readonly mode = 'local' as const;
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
