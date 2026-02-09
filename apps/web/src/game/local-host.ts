import type { CoreHost, CoreHostCommand, CoreHostEvent, CoreHostEventListener } from './core-host';
import { createHelloPayload, type HelloPayload, type HelloVersions } from './handshake';
import {
  createStage4CommandAuthority,
  type SimCoreAuthorityTickScheduler,
  type Stage4AuthorityMode,
  type Stage4CommandAuthority,
} from './sim-core-command-authority';

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
  readonly authorityMode?: Stage4AuthorityMode;
  readonly authorityTickIntervalMs?: number;
  readonly authorityTickScheduler?: SimCoreAuthorityTickScheduler;
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
  private readonly commandAuthority: Stage4CommandAuthority;
  private connected = false;

  public constructor(private readonly options: LocalHostOptions = {}) {
    this.helloPayload = createHelloPayload(
      {
        roomId: this.options.roomId ?? 'local-room',
        clientId: this.options.clientId ?? 'local-client',
      },
      this.options.helloVersions,
    );
    this.commandAuthority = createStage4CommandAuthority({
      mode: this.mode,
      authorityMode: this.options.authorityMode,
      tickIntervalMs: this.options.authorityTickIntervalMs,
      tickScheduler: this.options.authorityTickScheduler,
    });
  }

  public connect(): void {
    if (this.connected) {
      return;
    }

    this.connected = true;
    this.commandAuthority.connect?.();
    this.emitEvent({ type: 'connected', mode: this.mode });
    this.emitEvent({ type: 'hello', mode: this.mode, payload: this.helloPayload });
  }

  public disconnect(): void {
    if (!this.connected) {
      return;
    }

    this.connected = false;
    this.commandAuthority.disconnect?.();
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

  public requestSnapshot(lastAppliedServerSeq = 0): void {
    if (!this.connected) {
      this.emitEvent({
        type: 'error',
        mode: this.mode,
        code: 'HOST_NOT_CONNECTED',
        message: 'cannot request snapshot before connect',
      });
      return;
    }

    queueMicrotask(() => {
      if (!this.connected) {
        return;
      }
      const events = this.commandAuthority.createSnapshotReplay(lastAppliedServerSeq);
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
