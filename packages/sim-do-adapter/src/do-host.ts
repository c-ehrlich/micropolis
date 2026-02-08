import type {
  BridgeClientEnvelope,
  BridgeClientId,
  BridgeCommandId,
  BridgeHelloPayload,
  BridgeRoomId,
  BridgeServerEnvelope,
  CoreHost,
} from '@city/core-bridge';

import {
  DEFAULT_DO_HELLO_PAYLOAD,
  type DoWebSocketMessage,
  type DoWebSocketOutboundMessage,
} from './room-do-adapter.ts';

const textDecoder = new TextDecoder();

/**
 * Transport seam consumed by `DoHost` to speak to a DO room authority.
 * Mirrors the transport boundary intent from `ref/micropolis/src/sim/w_net.c`
 * where command intake and outbound packet fanout are decoupled from callers.
 * Parity note: this is intentionally async and message-based instead of using
 * raw UDP file descriptors.
 */
export interface DoHostTransport {
  connect(onMessage: (message: DoWebSocketOutboundMessage) => void): Promise<void> | void;
  send(message: DoWebSocketMessage): Promise<void> | void;
  disconnect(): Promise<void> | void;
}

/**
 * Construction options for `DoHost`.
 * Mirrors host identity + transport wiring intent from `SimCmd` dispatch paths
 * in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: room/client identity is explicit in bridge-v1 envelopes and
 * is not a 1:1 C global/process identity mapping.
 */
export interface DoHostOptions<
  TCommandPayload = unknown,
  TPatchPayload = unknown,
  TSnapshotPayload = unknown,
  TPresencePayload = unknown,
> {
  roomId: BridgeRoomId;
  clientId: BridgeClientId;
  transport: DoHostTransport;
  nowMs?: () => number;
  defaultHelloPayload?: BridgeHelloPayload;
  encodeClientEnvelope?: (envelope: BridgeClientEnvelope<TCommandPayload>) => DoWebSocketMessage;
  decodeServerEnvelope?: (
    message: DoWebSocketOutboundMessage,
  ) => BridgeServerEnvelope<TPatchPayload, TSnapshotPayload, TPresencePayload>;
}

/**
 * Encode one bridge client envelope as JSON transport payload.
 * Mirrors outbound command serialization intent in Micropolis command routing
 * from `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: JSON envelopes are an intentional bridge-v1 transport format.
 */
export function encodeClientEnvelopeAsJson<TCommandPayload>(
  envelope: BridgeClientEnvelope<TCommandPayload>,
): DoWebSocketMessage {
  return JSON.stringify(envelope);
}

/**
 * Decode one bridge server envelope from JSON transport payload.
 * Mirrors inbound packet decoding intent in `ref/micropolis/src/sim/w_net.c`.
 * Parity note: this validates bridge envelope scaffolding and leaves payload
 * specifics to downstream consumers.
 */
export function decodeServerEnvelopeFromJson<
  TPatchPayload = unknown,
  TSnapshotPayload = unknown,
  TPresencePayload = unknown,
>(
  message: DoWebSocketOutboundMessage,
): BridgeServerEnvelope<TPatchPayload, TSnapshotPayload, TPresencePayload> {
  const raw: unknown = JSON.parse(normalizeSocketMessageToText(message));
  const envelope = requireObjectRecord(raw, 'server envelope');
  const kind = requireStringField(envelope, 'kind', 'server envelope');
  const roomId = requireStringField(envelope, 'roomId', 'server envelope');
  const tick = requireFiniteNumberField(envelope, 'tick', 'server envelope');
  const serverSeq = requireFiniteNumberField(envelope, 'serverSeq', 'server envelope');

  if (!hasOwnProperty(envelope, 'payload')) {
    throw new Error('server envelope is missing payload');
  }

  if (kind === 'hello') {
    const helloPayload = requireObjectRecord(envelope.payload, 'server hello payload');
    return {
      kind,
      roomId,
      clientId: requireStringField(envelope, 'clientId', 'server hello envelope'),
      tick,
      serverSeq,
      payload: {
        protocolVersion: requireStringField(
          helloPayload,
          'protocolVersion',
          'server hello payload',
        ),
        coreVersion: requireStringField(helloPayload, 'coreVersion', 'server hello payload'),
      },
    };
  }

  if (kind === 'ack') {
    const ackPayload = requireObjectRecord(envelope.payload, 'server ack payload');
    return {
      kind,
      roomId,
      tick,
      serverSeq,
      payload: {
        commandId: requireStringField(ackPayload, 'commandId', 'server ack payload'),
      },
    };
  }

  if (kind === 'reject') {
    const rejectPayload = requireObjectRecord(envelope.payload, 'server reject payload');
    return {
      kind,
      roomId,
      tick,
      serverSeq,
      payload: {
        commandId: requireStringField(rejectPayload, 'commandId', 'server reject payload'),
        reason: requireStringField(rejectPayload, 'reason', 'server reject payload'),
        code: requireOptionalStringField(rejectPayload, 'code', 'server reject payload'),
      },
    };
  }

  if (kind === 'patch') {
    return {
      kind,
      roomId,
      tick,
      serverSeq,
      payload: envelope.payload as TPatchPayload,
    };
  }

  if (kind === 'snapshot') {
    return {
      kind,
      roomId,
      tick,
      serverSeq,
      payload: envelope.payload as TSnapshotPayload,
    };
  }

  if (kind === 'resync') {
    const resyncPayload = requireObjectRecord(envelope.payload, 'server resync payload');
    return {
      kind,
      roomId,
      tick,
      serverSeq,
      payload: {
        reason: requireStringField(resyncPayload, 'reason', 'server resync payload'),
      },
    };
  }

  if (kind === 'presence') {
    return {
      kind,
      roomId,
      tick,
      serverSeq,
      payload: envelope.payload as TPresencePayload,
    };
  }

  if (kind === 'error') {
    const errorPayload = requireObjectRecord(envelope.payload, 'server error payload');
    return {
      kind,
      roomId,
      tick,
      serverSeq,
      payload: {
        message: requireStringField(errorPayload, 'message', 'server error payload'),
        code: requireOptionalStringField(errorPayload, 'code', 'server error payload'),
        commandId: requireOptionalStringField(errorPayload, 'commandId', 'server error payload'),
      },
    };
  }

  throw new Error(`unsupported server envelope kind: ${kind}`);
}

/**
 * Durable-Object-backed host implementation of `CoreHost`.
 * Mirrors command intake + outbound event fanout intent from Micropolis
 * integration command/transport pathways (`ref/micropolis/src/sim/w_sim.c`,
 * `ref/micropolis/src/sim/w_net.c`).
 * Parity note: this is intentionally transport-agnostic over a message
 * adapter, and handshake envelopes are additive bridge-v1 behavior.
 */
export class DoHost<
  TCommandPayload = unknown,
  TPatchPayload = unknown,
  TSnapshotPayload = unknown,
  TPresencePayload = unknown,
> implements CoreHost<TCommandPayload, TPatchPayload, TSnapshotPayload, TPresencePayload> {
  readonly roomId: BridgeRoomId;
  readonly clientId: BridgeClientId;

  private readonly listeners = new Set<
    (event: BridgeServerEnvelope<TPatchPayload, TSnapshotPayload, TPresencePayload>) => void
  >();
  private readonly nowMs: () => number;
  private readonly defaultHelloPayload: BridgeHelloPayload;
  private readonly encodeClientEnvelope: (
    envelope: BridgeClientEnvelope<TCommandPayload>,
  ) => DoWebSocketMessage;
  private readonly decodeServerEnvelope: (
    message: DoWebSocketOutboundMessage,
  ) => BridgeServerEnvelope<TPatchPayload, TSnapshotPayload, TPresencePayload>;
  private isConnected = false;

  /**
   * Create one `DoHost` bound to a room/client identity and transport.
   * Mirrors transport attachment intent from Micropolis NET setup in
   * `ref/micropolis/src/sim/w_net.c`.
   * Parity note: explicit room/client identity is bridge-v1 metadata.
   */
  constructor(
    private readonly options: DoHostOptions<
      TCommandPayload,
      TPatchPayload,
      TSnapshotPayload,
      TPresencePayload
    >,
  ) {
    this.roomId = options.roomId;
    this.clientId = options.clientId;
    this.nowMs = options.nowMs ?? Date.now;
    this.defaultHelloPayload = options.defaultHelloPayload ?? DEFAULT_DO_HELLO_PAYLOAD;
    this.encodeClientEnvelope = options.encodeClientEnvelope ?? encodeClientEnvelopeAsJson;
    this.decodeServerEnvelope = options.decodeServerEnvelope ?? decodeServerEnvelopeFromJson;
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    await this.options.transport.connect((message) => {
      const envelope = this.decodeServerEnvelope(message);
      this.dispatchEnvelope(envelope);
    });
    this.isConnected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) {
      return;
    }
    await this.options.transport.disconnect();
    this.isConnected = false;
  }

  async sendHello(payload: BridgeHelloPayload = this.defaultHelloPayload): Promise<void> {
    await this.sendEnvelope({
      kind: 'hello',
      roomId: this.roomId,
      clientId: this.clientId,
      payload,
    });
  }

  async sendCommand(command: {
    commandId: BridgeCommandId;
    payload: TCommandPayload;
    sentAtMs?: number;
  }): Promise<void> {
    await this.sendEnvelope({
      kind: 'command',
      roomId: this.roomId,
      clientId: this.clientId,
      commandId: command.commandId,
      sentAtMs: command.sentAtMs ?? this.nowMs(),
      payload: command.payload,
    });
  }

  async requestSnapshot(): Promise<void> {
    await this.sendEnvelope({
      kind: 'request_snapshot',
      roomId: this.roomId,
      clientId: this.clientId,
    });
  }

  async ping(sentAtMs: number = this.nowMs()): Promise<void> {
    await this.sendEnvelope({
      kind: 'ping',
      roomId: this.roomId,
      clientId: this.clientId,
      sentAtMs,
    });
  }

  subscribe(
    listener: (
      event: BridgeServerEnvelope<TPatchPayload, TSnapshotPayload, TPresencePayload>,
    ) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async sendEnvelope(envelope: BridgeClientEnvelope<TCommandPayload>): Promise<void> {
    this.assertConnected();
    await this.options.transport.send(this.encodeClientEnvelope(envelope));
  }

  private dispatchEnvelope(
    envelope: BridgeServerEnvelope<TPatchPayload, TSnapshotPayload, TPresencePayload>,
  ): void {
    for (const listener of this.listeners) {
      listener(envelope);
    }
  }

  private assertConnected(): void {
    if (!this.isConnected) {
      throw new Error('host is not connected');
    }
  }
}

function hasOwnProperty(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function requireObjectRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireStringField(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new Error(`${label}.${key} must be a string`);
  }
  return value;
}

function requireOptionalStringField(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string | undefined {
  if (!hasOwnProperty(record, key)) {
    return undefined;
  }
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`${label}.${key} must be a string when defined`);
  }
  return value;
}

function requireFiniteNumberField(
  record: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label}.${key} must be a finite number`);
  }
  return value;
}

function normalizeSocketMessageToText(message: DoWebSocketOutboundMessage): string {
  if (typeof message === 'string') {
    return message;
  }
  if (message instanceof Uint8Array) {
    return textDecoder.decode(message);
  }
  return textDecoder.decode(new Uint8Array(message));
}
