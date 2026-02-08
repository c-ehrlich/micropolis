import type { CoreHost, CoreHostCommand, CoreHostEvent, CoreHostEventListener } from './core-host';
import { DeterministicCommandAuthority } from './deterministic-command-authority';
import { createHelloPayload, type HelloPayload, type HelloVersions } from './handshake';

/**
 * Configuration for Durable Object host bootstrap identity and version payload.
 * Mirrors Stage hosted startup semantics mapped from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: constructor options are an intentional TypeScript test seam.
 */
export interface DoHostOptions {
  readonly roomId?: string;
  readonly clientId?: string;
  readonly helloVersions?: Partial<HelloVersions>;
}

/**
 * Durable Object-backed host placeholder for the web runtime.
 * Mirrors Micropolis NET-enabled runtime command transport intent in
 * `ref/micropolis/src/sim/w_sim.c` (`SimCmdListenTo`/`SimCmdHearFrom`).
 * Parity note: this class emits the same lifecycle + hello sequence as `LocalHost`
 * so bootstrap UX stays host-agnostic in Stage 4 glue.
 */
export class DoHost implements CoreHost {
  public readonly mode = 'do' as const;
  private readonly listeners = new Set<CoreHostEventListener>();
  private readonly helloPayload: HelloPayload;
  private readonly commandAuthority = new DeterministicCommandAuthority({ mode: this.mode });
  private connected = false;

  public constructor(private readonly options: DoHostOptions = {}) {
    this.helloPayload = createHelloPayload(
      {
        roomId: this.options.roomId ?? 'do-room',
        clientId: this.options.clientId ?? 'do-client',
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
