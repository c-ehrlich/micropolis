import type { CoreHost, CoreHostCommand, CoreHostEvent, CoreHostEventListener } from './core-host';
import { DeterministicCommandAuthority } from './deterministic-command-authority';
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
  private readonly commandAuthority = new DeterministicCommandAuthority({ mode: this.mode });
  private connected = false;

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
    this.connected = true;
    this.emitEvent({ type: 'connected', mode: this.mode });
    this.emitEvent({ type: 'hello', mode: this.mode, payload: this.helloPayload });
  }

  public disconnect(): void {
    this.connected = false;
    this.emitEvent({ type: 'disconnected', mode: this.mode });
  }

  public sendCommand(command: CoreHostCommand): void {
    if (!this.connected) {
      this.emitEvent({
        type: 'error',
        mode: this.mode,
        code: 'HOST_NOT_CONNECTED',
        message: 'cannot send command before connect',
      });
      return;
    }

    queueMicrotask(() => {
      if (!this.connected) {
        return;
      }
      const events = this.commandAuthority.processCommand(command);
      for (const event of events) {
        this.emitEvent(event);
      }
    });
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
