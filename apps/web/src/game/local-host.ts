import type { CoreHost, CoreHostEvent, CoreHostEventListener } from './core-host';
import { createHelloPayload, type HelloPayload, type HelloVersions } from './handshake';

/**
 * Configuration for local host bootstrap identity and version payload.
 * Mirrors deterministic local defaults used by Stage bridge startup mapping to
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: constructor options are an intentional TypeScript test seam.
 */
export interface LocalHostOptions {
  readonly roomId?: string;
  readonly clientId?: string;
  readonly helloVersions?: Partial<HelloVersions>;
}

/**
 * Local in-process host for the web runtime.
 * Mirrors single-process command dispatch behavior in `ref/micropolis/src/sim/w_sim.c`
 * where simulation commands are handled without NET transport.
 * Parity note: lifecycle + hello events are an intentional TypeScript abstraction.
 */
export class LocalHost implements CoreHost {
  public readonly mode = 'local' as const;
  private readonly listeners = new Set<CoreHostEventListener>();
  private readonly helloPayload: HelloPayload;

  public constructor(private readonly options: LocalHostOptions = {}) {
    this.helloPayload = createHelloPayload(
      {
        roomId: this.options.roomId ?? 'local-room',
        clientId: this.options.clientId ?? 'local-client',
      },
      this.options.helloVersions,
    );
  }

  public connect(): void {
    this.emitEvent({ type: 'connected', mode: this.mode });
    this.emitEvent({ type: 'hello', mode: this.mode, payload: this.helloPayload });
  }

  public disconnect(): void {
    this.emitEvent({ type: 'disconnected', mode: this.mode });
  }

  public subscribe(listener: CoreHostEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitEvent(event: CoreHostEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
