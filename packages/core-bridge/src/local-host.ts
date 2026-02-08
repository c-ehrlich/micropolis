import type { CoreHost, CoreHostEventListener, CoreHostUnsubscribe } from './core-host.ts';
import { MockAuthorityEngine, type MockAuthorityEngineOptions } from './mock-authority-engine.ts';
import type {
  BridgeEnvelopeIdentity,
  ClientCommandEnvelope,
  ClientHelloEnvelope,
  ClientRequestSnapshotEnvelope,
  HostHelloEnvelope,
} from './types.ts';

/**
 * Deterministic local-mode room identity default.
 * Mirrors single-process local runtime assumptions in
 * `ref/micropolis/src/sim/sim.c` (`sim_init` + one active simulation runtime).
 * Parity note: explicit room IDs are intentionally different from C globals.
 */
export const LOCAL_HOST_DEFAULT_ROOM_ID = 'local-room';

/**
 * Deterministic local-mode client identity default.
 * Mirrors local single-client startup intent in `ref/micropolis/src/sim/sim.c`.
 * Parity note: explicit client IDs are intentionally different from C globals.
 */
export const LOCAL_HOST_DEFAULT_CLIENT_ID = 'local-client';

/**
 * Default strict bridge protocol version expected by `LocalHost`.
 * Mirrors `SimCmdVersion` lockstep intent from `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: handshake strings are bridge-level contract metadata, not a
 * direct C enum/value.
 */
export const LOCAL_HOST_DEFAULT_PROTOCOL_VERSION = 'bridge-v1';

/**
 * Default strict sim core version expected by `LocalHost`.
 * Mirrors `MicropolisVersion` query behavior via `SimCmdVersion` in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this version string is a bridge contract value, not directly
 * read from C globals.
 */
export const LOCAL_HOST_DEFAULT_CORE_VERSION = 'core-v1';

/**
 * Tick callback used by `LocalHost` local scheduling hooks.
 * Mirrors timed simulation stepping from `sim_timeout_loop`/`sim_loop` in
 * `ref/micropolis/src/sim/sim.c`.
 * Parity note: callback hooks are intentionally adapter-based instead of C's
 * timeout/listener plumbing.
 */
export type LocalHostTickListener = (tick: number) => void;

/**
 * Injectable interval scheduler used by `LocalHost` tick hooks.
 * Mirrors periodic timeout scheduling around `sim_timeout_loop` in
 * `ref/micropolis/src/sim/sim.c`.
 * Parity note: this TypeScript adapter intentionally differs from Tcl/Tk
 * timer APIs while preserving deterministic control for tests.
 */
export interface LocalHostTickScheduler {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

/**
 * Construction options for `LocalHost`.
 * Mirrors command/tick runtime setup knobs spread across `sim_init`,
 * `sim_loop`, and `SimCmdVersion` in `ref/micropolis/src/sim/sim.c` and
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this is intentionally a typed options object rather than C
 * globals and command-line argument parsing.
 */
export interface LocalHostOptions extends MockAuthorityEngineOptions {
  protocolVersion?: string;
  coreVersion?: string;
  tickIntervalMs?: number;
  tickScheduler?: LocalHostTickScheduler;
  onTick?: LocalHostTickListener;
  /**
   * Snapshot baseline rebuild cadence forwarded to `MockAuthorityEngine`.
   * Mirrors reconnect checkpoint cadence intent from
   * `ref/micropolis/spec/integration/SPEC.md`.
   * Parity note: explicit cadence configuration is a bridge-host abstraction,
   * not a direct Micropolis C runtime field.
   */
  snapshotCadenceTicks?: number;
}

const DEFAULT_TICK_SCHEDULER: LocalHostTickScheduler = {
  setInterval(callback, intervalMs) {
    return globalThis.setInterval(callback, intervalMs);
  },
  clearInterval(handle) {
    globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>);
  },
};

/**
 * Deterministic in-process `CoreHost` implementation backed by `MockAuthorityEngine`.
 * Mirrors local command dispatch shape from `SimCmd` in
 * `ref/micropolis/src/sim/w_sim.c` and timed stepping hooks from
 * `sim_timeout_loop`/`sim_loop` in `ref/micropolis/src/sim/sim.c`.
 * Parity note: this is intentionally a typed event-stream bridge host instead
 * of direct Tcl command invocations.
 */
export class LocalHost implements CoreHost {
  private readonly identity: BridgeEnvelopeIdentity;
  private readonly protocolVersion: string;
  private readonly coreVersion: string;
  private readonly tickIntervalMs: number | undefined;
  private readonly tickScheduler: LocalHostTickScheduler;
  private readonly onTick: LocalHostTickListener | undefined;
  private readonly authority: MockAuthorityEngine;
  private readonly listeners = new Set<CoreHostEventListener>();

  private connected = false;
  private helloAccepted = false;
  private tickHandle: unknown;
  private scheduledTick = 0;

  constructor(options: LocalHostOptions = {}) {
    const roomId = options.roomId ?? LOCAL_HOST_DEFAULT_ROOM_ID;
    const clientId = options.clientId ?? LOCAL_HOST_DEFAULT_CLIENT_ID;

    this.identity = { roomId, clientId };
    this.protocolVersion = options.protocolVersion ?? LOCAL_HOST_DEFAULT_PROTOCOL_VERSION;
    this.coreVersion = options.coreVersion ?? LOCAL_HOST_DEFAULT_CORE_VERSION;
    this.tickIntervalMs = options.tickIntervalMs;
    this.tickScheduler = options.tickScheduler ?? DEFAULT_TICK_SCHEDULER;
    this.onTick = options.onTick;

    this.authority = new MockAuthorityEngine({
      roomId,
      clientId,
      initialTick: options.initialTick,
      initialServerSeq: options.initialServerSeq,
      rejectCommandTypes: options.rejectCommandTypes,
      snapshotCadenceTicks: options.snapshotCadenceTicks,
    });
  }

  connect(): void {
    if (this.connected) {
      return;
    }

    this.connected = true;
    this.helloAccepted = false;
    this.scheduledTick = 0;
    this.startTickLoop();
  }

  disconnect(): void {
    if (!this.connected) {
      return;
    }

    this.connected = false;
    this.helloAccepted = false;
    this.stopTickLoop();
  }

  hello(envelope: ClientHelloEnvelope): void {
    if (!this.requireConnected(undefined, 'hello()')) {
      return;
    }

    const mismatchReasons = this.collectHelloMismatchReasons(envelope);
    const accepted = mismatchReasons.length === 0;
    this.helloAccepted = accepted;

    const response: HostHelloEnvelope = {
      kind: 'hello',
      ...this.identity,
      protocolVersion: this.protocolVersion,
      coreVersion: this.coreVersion,
      accepted,
      ...(accepted
        ? {}
        : {
            message: `hello refused: ${mismatchReasons.join('; ')}`,
          }),
    };

    this.emit(response);
  }

  sendCommand(envelope: ClientCommandEnvelope): void {
    if (!this.requireReady(envelope.commandId, 'sendCommand()')) {
      return;
    }

    const result = this.authority.processCommand({
      ...envelope,
      ...this.identity,
    });

    result.events.forEach((event) => {
      this.emit(event);
    });
  }

  requestSnapshot(envelope: ClientRequestSnapshotEnvelope): void {
    if (!this.requireReady(undefined, 'requestSnapshot()')) {
      return;
    }

    const replay = this.authority.handleSnapshotRequest({
      kind: 'request_snapshot',
      ...this.identity,
      afterServerSeq: envelope.afterServerSeq,
    });

    replay.events.forEach((event) => {
      this.emit(event);
    });
  }

  subscribe(listener: CoreHostEventListener): CoreHostUnsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private startTickLoop(): void {
    if (this.tickIntervalMs === undefined || this.tickIntervalMs <= 0) {
      return;
    }
    if (this.tickHandle !== undefined) {
      return;
    }

    this.tickHandle = this.tickScheduler.setInterval(() => {
      this.scheduledTick += 1;
      this.onTick?.(this.scheduledTick);
    }, this.tickIntervalMs);
  }

  private stopTickLoop(): void {
    if (this.tickHandle === undefined) {
      return;
    }

    this.tickScheduler.clearInterval(this.tickHandle);
    this.tickHandle = undefined;
  }

  private collectHelloMismatchReasons(envelope: ClientHelloEnvelope): string[] {
    const mismatchReasons: string[] = [];

    if (envelope.protocolVersion !== this.protocolVersion) {
      mismatchReasons.push(
        `protocolVersion expected ${this.protocolVersion} but received ${envelope.protocolVersion}`,
      );
    }

    if (envelope.coreVersion !== this.coreVersion) {
      mismatchReasons.push(
        `coreVersion expected ${this.coreVersion} but received ${envelope.coreVersion}`,
      );
    }

    if (envelope.roomId !== this.identity.roomId) {
      mismatchReasons.push(
        `roomId expected ${this.identity.roomId} but received ${envelope.roomId}`,
      );
    }

    if (envelope.clientId !== this.identity.clientId) {
      mismatchReasons.push(
        `clientId expected ${this.identity.clientId} but received ${envelope.clientId}`,
      );
    }

    return mismatchReasons;
  }

  private requireReady(commandId: string | undefined, operation: string): boolean {
    if (!this.requireConnected(commandId, operation)) {
      return false;
    }

    if (this.helloAccepted) {
      return true;
    }

    this.emit(
      this.authority.reportError(
        'host/handshake-required',
        `hello must be accepted before ${operation}`,
        this.identity,
        commandId,
      ),
    );
    return false;
  }

  private requireConnected(commandId: string | undefined, operation: string): boolean {
    if (this.connected) {
      return true;
    }

    this.emit(
      this.authority.reportError(
        'host/not-connected',
        `connect() must be called before ${operation}`,
        this.identity,
        commandId,
      ),
    );
    return false;
  }

  private emit(event: Parameters<CoreHostEventListener>[0]): void {
    this.listeners.forEach((listener) => {
      listener(event);
    });
  }
}
