import type { BridgeClientEnvelope } from '@city/core-bridge';
import type {
  IntegrationBroadcaster,
  IntegrationClientId,
  IntegrationMultiplayerRuntime,
  IntegrationRoomId,
  IntegrationServerEnvelope,
} from '@city/sim-integration';

const textDecoder = new TextDecoder();

/**
 * WebSocket message payload accepted by the DO adapter bridge.
 * Mirrors byte/string packet intake intent from `udp_hear` in
 * `ref/micropolis/src/sim/w_net.c`.
 * Parity note: this is intentionally WebSocket-oriented (`string`/binary),
 * while Micropolis NET transport used UDP sockets.
 */
export type DoWebSocketMessage = string | ArrayBuffer | Uint8Array;

/**
 * WebSocket payload sent by the DO adapter bridge.
 * Mirrors outbound packet fanout intent from `HandlePacket` evaluation in
 * `ref/micropolis/src/sim/w_net.c`.
 * Parity note: this is intentionally envelope-serialization output rather than
 * Tcl command strings.
 */
export type DoWebSocketOutboundMessage = string | ArrayBuffer | Uint8Array;

/**
 * Minimal socket contract consumed by the DO room adapter.
 * Mirrors transport write intent in `ref/micropolis/src/sim/w_net.c`.
 * Parity note: this is an adapter seam and not a 1:1 C socket descriptor API.
 */
export interface DoWebSocketLike {
  send(message: DoWebSocketOutboundMessage): void;
}

/**
 * Deterministic room-to-authority binding used for Durable Object lookup.
 * Mirrors the "single authority endpoint per simulation instance" intent of
 * Micropolis NET globals (`net_listen_socket`) in `ref/micropolis/src/sim/w_net.c`.
 * Parity note: Micropolis does not have room IDs; this mapping is an
 * intentional bridge-v1 multiplayer addition.
 */
export interface DoRoomAuthorityBinding {
  roomId: IntegrationRoomId;
  durableObjectName: string;
}

/**
 * Factory used by the adapter to create one authoritative runtime per room DO.
 * Mirrors one-authority command/tick ownership expected by `sim` command
 * routing in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this is intentionally dependency-injected for testability.
 */
export type DoRoomRuntimeFactory<
  TCommandPayload,
  TPatchPayload,
  TSnapshotPayload,
  TPresencePayload,
> = (
  broadcaster: IntegrationBroadcaster<TPatchPayload, TSnapshotPayload, TPresencePayload>,
) => IntegrationMultiplayerRuntime<
  TCommandPayload,
  TPatchPayload,
  TSnapshotPayload,
  TPresencePayload
>;

/**
 * WebSocket and alarm wiring options for one DO-backed room authority.
 * Mirrors transport-event entry points from Micropolis NET command flow in
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_net.c`.
 * Parity note: this adapter is intentionally room-scoped and transport-agnostic
 * with pluggable encoding/decoding.
 */
export interface DoRoomAdapterOptions<
  TCommandPayload,
  TPatchPayload,
  TSnapshotPayload,
  TPresencePayload,
> {
  roomId: IntegrationRoomId;
  createRuntime: DoRoomRuntimeFactory<
    TCommandPayload,
    TPatchPayload,
    TSnapshotPayload,
    TPresencePayload
  >;
  decodeClientEnvelope?: (message: DoWebSocketMessage) => BridgeClientEnvelope<TCommandPayload>;
  encodeServerEnvelope?: (
    event: IntegrationServerEnvelope<TPatchPayload, TSnapshotPayload, TPresencePayload>,
  ) => DoWebSocketOutboundMessage;
  nowMs?: () => number;
}

/**
 * Map one room/city ID to one deterministic Durable Object name.
 * Mirrors single-endpoint authority ownership intent in
 * `ref/micropolis/src/sim/w_net.c` (`net_listen_socket` lifecycle).
 * Parity note: this is intentionally different from C by introducing explicit
 * per-room authority naming for DO routing.
 */
export function mapRoomToDurableObjectName(roomId: IntegrationRoomId): string {
  return `room:${roomId}`;
}

/**
 * Build the room-to-authority mapping object consumed by DO host wiring.
 * Mirrors one authoritative transport endpoint intent from
 * `ref/micropolis/src/sim/w_net.c`.
 * Parity note: this is additive metadata for bridge-v1 routing.
 */
export function createDoRoomAuthorityBinding(roomId: IntegrationRoomId): DoRoomAuthorityBinding {
  return {
    roomId,
    durableObjectName: mapRoomToDurableObjectName(roomId),
  };
}

/**
 * Durable Object adapter for one authoritative room runtime.
 * Mirrors transport entrypoints around socket open/message/close and polling
 * updates in `ref/micropolis/src/sim/w_net.c` and command dispatch in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this is intentionally WebSocket + alarm based (not UDP/Tk),
 * while preserving single-authority room ownership and deterministic routing.
 */
export class RoomDoAdapter<
  TCommandPayload = unknown,
  TPatchPayload = unknown,
  TSnapshotPayload = unknown,
  TPresencePayload = unknown,
> {
  private readonly socketsByClientId = new Map<IntegrationClientId, DoWebSocketLike>();
  private readonly runtime: IntegrationMultiplayerRuntime<
    TCommandPayload,
    TPatchPayload,
    TSnapshotPayload,
    TPresencePayload
  >;
  private readonly decodeClientEnvelope: (
    message: DoWebSocketMessage,
  ) => BridgeClientEnvelope<TCommandPayload>;
  private readonly encodeServerEnvelope: (
    event: IntegrationServerEnvelope<TPatchPayload, TSnapshotPayload, TPresencePayload>,
  ) => DoWebSocketOutboundMessage;
  private readonly nowMs: () => number;

  /**
   * Create one room-scoped DO adapter and its authoritative runtime binding.
   * Mirrors authority setup intent from `udp_listen` startup in
   * `ref/micropolis/src/sim/w_net.c`.
   * Parity note: runtime and codec wiring are intentionally injected.
   */
  constructor(
    private readonly options: DoRoomAdapterOptions<
      TCommandPayload,
      TPatchPayload,
      TSnapshotPayload,
      TPresencePayload
    >,
  ) {
    this.decodeClientEnvelope = options.decodeClientEnvelope ?? decodeClientEnvelopeFromJson;
    this.encodeServerEnvelope = options.encodeServerEnvelope ?? encodeServerEnvelopeAsJson;
    this.nowMs = options.nowMs ?? Date.now;
    this.runtime = options.createRuntime(this.createBroadcaster());
  }

  /**
   * Expose the room authority mapping for this adapter instance.
   * Mirrors one-authority endpoint ownership in `ref/micropolis/src/sim/w_net.c`.
   * Parity note: explicit mapping object is additive in TypeScript.
   */
  get authorityBinding(): DoRoomAuthorityBinding {
    return createDoRoomAuthorityBinding(this.options.roomId);
  }

  /**
   * Connect a websocket client to this room authority.
   * Mirrors transport peer registration intent from NET command plumbing in
   * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_net.c`.
   * Parity note: this is client-id keyed instead of file descriptor keyed.
   */
  async handleWebSocketOpen(clientId: IntegrationClientId, socket: DoWebSocketLike): Promise<void> {
    this.socketsByClientId.set(clientId, socket);
    await this.runtime.connectClient(this.options.roomId, clientId);
  }

  /**
   * Route one websocket message into authoritative runtime APIs.
   * Mirrors command intake dispatch intent from `SimCmd` in
   * `ref/micropolis/src/sim/w_sim.c`.
   * Parity note: `hello`/`ping` are accepted as no-op scaffolding in this task;
   * strict handshake behavior is handled in later stage tasks.
   */
  async handleWebSocketMessage(
    clientId: IntegrationClientId,
    message: DoWebSocketMessage,
  ): Promise<void> {
    const envelope = this.decodeClientEnvelope(message);
    assertSameRoomAuthority(this.options.roomId, envelope.roomId);
    assertSameClientAuthority(clientId, envelope.clientId);

    if (envelope.kind === 'command') {
      await this.runtime.receiveCommand(envelope);
      return;
    }

    if (envelope.kind === 'request_snapshot') {
      const snapshot = await this.runtime.getSnapshot(this.options.roomId);
      this.sendToClient(clientId, snapshot);
      return;
    }

    if (envelope.kind === 'hello' || envelope.kind === 'ping') {
      return;
    }

    assertNeverEnvelopeKind(envelope);
  }

  /**
   * Disconnect a websocket client from this room authority.
   * Mirrors transport teardown intent from socket lifecycle paths in
   * `ref/micropolis/src/sim/w_net.c`.
   * Parity note: disconnect is idempotent and keyed by `clientId`.
   */
  async handleWebSocketClose(clientId: IntegrationClientId): Promise<void> {
    this.socketsByClientId.delete(clientId);
    await this.runtime.disconnectClient(this.options.roomId, clientId);
  }

  /**
   * Bridge a Durable Object alarm/timer callback to authoritative ticking.
   * Mirrors polling progression intent from `udp_hear` loops and simulation
   * frame progression conventions in `ref/micropolis/src/sim/w_net.c`.
   * Parity note: explicit timer callback injection is additive for DO runtime.
   */
  async handleAlarm(nowMs: number = this.nowMs()): Promise<void> {
    await this.runtime.tick(nowMs);
  }

  /**
   * Expose the underlying room runtime for host composition tests.
   * Mirrors authority ownership boundaries from `ref/micropolis/src/sim/w_sim.c`.
   * Parity note: this is a TypeScript testing/composition helper.
   */
  getRuntime(): IntegrationMultiplayerRuntime<
    TCommandPayload,
    TPatchPayload,
    TSnapshotPayload,
    TPresencePayload
  > {
    return this.runtime;
  }

  /**
   * Build runtime broadcaster wiring that fans events to mapped sockets.
   * Mirrors outbound packet fanout intent from `HandlePacket` evaluation in
   * `ref/micropolis/src/sim/w_net.c`.
   * Parity note: room and envelope authority checks are explicit hardening.
   */
  private createBroadcaster(): IntegrationBroadcaster<
    TPatchPayload,
    TSnapshotPayload,
    TPresencePayload
  > {
    return {
      sendToClient: (clientId, event) => {
        assertSameRoomAuthority(this.options.roomId, event.roomId);
        this.sendToClient(clientId, event);
      },
      sendToRoom: (roomId, event) => {
        assertSameRoomAuthority(this.options.roomId, roomId);
        assertSameRoomAuthority(this.options.roomId, event.roomId);
        this.sendToRoom(event);
      },
    };
  }

  /**
   * Send one serialized event envelope to a single mapped client socket.
   * Mirrors targeted packet send intent from Micropolis transport plumbing in
   * `ref/micropolis/src/sim/w_net.c`.
   * Parity note: silently drops when client socket is absent.
   */
  private sendToClient(
    clientId: IntegrationClientId,
    event: IntegrationServerEnvelope<TPatchPayload, TSnapshotPayload, TPresencePayload>,
  ): void {
    const socket = this.socketsByClientId.get(clientId);
    if (socket === undefined) {
      return;
    }
    socket.send(this.encodeServerEnvelope(event));
  }

  /**
   * Fan out one serialized event envelope to every mapped room client socket.
   * Mirrors looped packet fanout intent from Micropolis NET pathways in
   * `ref/micropolis/src/sim/w_net.c`.
   * Parity note: this room-scoped fanout is explicit vs C global descriptors.
   */
  private sendToRoom(
    event: IntegrationServerEnvelope<TPatchPayload, TSnapshotPayload, TPresencePayload>,
  ): void {
    const encoded = this.encodeServerEnvelope(event);
    for (const socket of this.socketsByClientId.values()) {
      socket.send(encoded);
    }
  }
}

/**
 * Decode bridge client envelopes from JSON websocket payloads.
 * Mirrors textual command decoding intent in `SimCmd` from
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this is intentionally JSON envelope parsing for bridge-v1.
 */
export function decodeClientEnvelopeFromJson<TCommandPayload>(
  message: DoWebSocketMessage,
): BridgeClientEnvelope<TCommandPayload> {
  return JSON.parse(normalizeSocketMessageToText(message)) as BridgeClientEnvelope<TCommandPayload>;
}

/**
 * Encode bridge server envelopes to JSON websocket payloads.
 * Mirrors outbound command-string generation intent in `udp_hear` from
 * `ref/micropolis/src/sim/w_net.c`.
 * Parity note: JSON envelope serialization is intentionally different from
 * Tcl command string transport.
 */
export function encodeServerEnvelopeAsJson<TPatchPayload, TSnapshotPayload, TPresencePayload>(
  event: IntegrationServerEnvelope<TPatchPayload, TSnapshotPayload, TPresencePayload>,
): DoWebSocketOutboundMessage {
  return JSON.stringify(event);
}

/**
 * Convert inbound websocket payloads to UTF-8 text before JSON parse.
 * Mirrors byte-buffer to text conversion intent from packet handling in
 * `ref/micropolis/src/sim/w_net.c`.
 * Parity note: this helper is specific to bridge JSON payloads.
 */
function normalizeSocketMessageToText(message: DoWebSocketMessage): string {
  if (typeof message === 'string') {
    return message;
  }
  if (message instanceof Uint8Array) {
    return textDecoder.decode(message);
  }
  return textDecoder.decode(new Uint8Array(message));
}

/**
 * Enforce that inbound/outbound envelopes stay inside this room authority.
 * Mirrors single-endpoint authority discipline from `net_listen_socket` in
 * `ref/micropolis/src/sim/w_net.c`.
 * Parity note: explicit room assertions are additive for bridge-v1.
 */
function assertSameRoomAuthority(expectedRoomId: IntegrationRoomId, receivedRoomId: string): void {
  if (receivedRoomId !== expectedRoomId) {
    throw new Error(
      `room authority mismatch: expected ${expectedRoomId}, received ${receivedRoomId}`,
    );
  }
}

/**
 * Enforce that message client identity matches the connected websocket owner.
 * Mirrors transport peer identity assumptions in `ref/micropolis/src/sim/w_net.c`.
 * Parity note: explicit client-id assertion is additive for bridge-v1.
 */
function assertSameClientAuthority(
  expectedClientId: IntegrationClientId,
  receivedClientId: string,
): void {
  if (receivedClientId !== expectedClientId) {
    throw new Error(
      `client authority mismatch: expected ${expectedClientId}, received ${receivedClientId}`,
    );
  }
}

/**
 * Compile-time exhaustiveness guard for bridge client envelope kinds.
 * Mirrors strict command-dispatch branch coverage intent from `SimCmd` in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this is a TypeScript-only safety helper.
 */
function assertNeverEnvelopeKind(envelope: never): never {
  throw new Error(`unsupported client envelope: ${JSON.stringify(envelope)}`);
}
