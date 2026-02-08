import type { BridgeClientEnvelope, BridgeHelloPayload } from '@city/core-bridge';
import type {
  IntegrationBroadcaster,
  IntegrationClientId,
  IntegrationMultiplayerRuntime,
  IntegrationPatchTailEvent,
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
 * Presence event kind emitted by the DO adapter for room membership churn.
 * Mirrors buddy join/leave intent from Sugar presence callbacks in
 * `ref/micropolis/micropolisactivity.py`.
 * Parity note: this is intentionally bridge-v1 room/client metadata and not a
 * 1:1 Sugar buddy payload.
 */
export type DoPresenceEventKind = 'join' | 'leave';

/**
 * Default presence payload emitted by `RoomDoAdapter` when no custom payload
 * mapper is provided.
 * Mirrors presence lifecycle intent from Sugar buddy appeared/disappeared
 * callbacks in `ref/micropolis/micropolisactivity.py`.
 * Parity note: this is a bridge-v1 room-membership payload and intentionally
 * different from Sugar's key/nick/color/address buddy schema.
 */
export interface DoPresencePayload {
  kind: DoPresenceEventKind;
  clientId: IntegrationClientId;
  connectedClientIds: ReadonlyArray<IntegrationClientId>;
}

/**
 * Payload factory used to map adapter presence context into bridge `presence`
 * envelope payloads.
 * Mirrors presence callback payload adaptation intent from Sugar integration in
 * `ref/micropolis/micropolisactivity.py`.
 * Parity note: this mapper is intentionally adapter-configurable and not a
 * direct C/Python struct.
 */
export type DoPresencePayloadFactory<TPresencePayload> = (
  payload: DoPresencePayload,
) => TPresencePayload;

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
  expectedHelloPayload?: BridgeHelloPayload;
  presenceEnabled?: boolean;
  createPresencePayload?: DoPresencePayloadFactory<TPresencePayload>;
  nowMs?: () => number;
}

/**
 * Default bridge-v1 handshake payload enforced by the DO websocket adapter.
 * Mirrors strict startup compatibility intent from bridge contract planning
 * around `ref/micropolis/src/sim/w_sim.c` + `ref/micropolis/src/sim/w_net.c`.
 * Parity note: Micropolis C did not use structured hello payloads; this is an
 * intentional bridge-v1 lockstep requirement.
 */
export const DEFAULT_DO_HELLO_PAYLOAD: BridgeHelloPayload = {
  protocolVersion: 'bridge-v1',
  coreVersion: '0.0.0',
};

/**
 * Default setting for DO adapter room presence fanout.
 * Mirrors opt-in presence wiring intent from Sugar buddy hooks in
 * `ref/micropolis/micropolisactivity.py`.
 * Parity note: room presence events are additive bridge-v1 behavior and can be
 * disabled to match legacy single-client/non-presence flows.
 */
export const DEFAULT_DO_PRESENCE_ENABLED = false;

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
  private readonly handshakenClientIds = new Set<IntegrationClientId>();
  private readonly knownClientIds = new Set<IntegrationClientId>();
  private readonly resyncRequiredClientIds = new Set<IntegrationClientId>();
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
  private readonly expectedHelloPayload: BridgeHelloPayload;
  private readonly presenceEnabled: boolean;
  private readonly createPresencePayload: DoPresencePayloadFactory<TPresencePayload>;
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
    this.expectedHelloPayload = options.expectedHelloPayload ?? DEFAULT_DO_HELLO_PAYLOAD;
    this.presenceEnabled = options.presenceEnabled ?? DEFAULT_DO_PRESENCE_ENABLED;
    this.createPresencePayload = options.createPresencePayload ?? createDefaultPresencePayload;
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
    if (this.knownClientIds.has(clientId)) {
      this.resyncRequiredClientIds.add(clientId);
    }
    this.socketsByClientId.set(clientId, socket);
    this.handshakenClientIds.delete(clientId);
    await this.runtime.connectClient(this.options.roomId, clientId);
  }

  /**
   * Route one websocket message into authoritative runtime APIs.
   * Mirrors command intake dispatch intent from `SimCmd` in
   * `ref/micropolis/src/sim/w_sim.c`.
   * Parity note: `hello` lockstep and pre-hello command denial are intentional
   * bridge-v1 additions over legacy NET packet handling.
   */
  async handleWebSocketMessage(
    clientId: IntegrationClientId,
    message: DoWebSocketMessage,
  ): Promise<void> {
    let envelope: BridgeClientEnvelope<TCommandPayload>;
    try {
      envelope = this.decodeClientEnvelope(message);
    } catch {
      await this.sendProtocolError(clientId, 'invalid client envelope payload', 'INVALID_ENVELOPE');
      return;
    }

    if (envelope.roomId !== this.options.roomId) {
      await this.sendProtocolError(
        clientId,
        `room authority mismatch: expected ${this.options.roomId}, received ${envelope.roomId}`,
        'ROOM_AUTHORITY_MISMATCH',
      );
      return;
    }

    if (envelope.clientId !== clientId) {
      await this.sendProtocolError(
        clientId,
        `client authority mismatch: expected ${clientId}, received ${envelope.clientId}`,
        'CLIENT_AUTHORITY_MISMATCH',
      );
      return;
    }

    if (envelope.kind === 'hello') {
      await this.handleHelloEnvelope(clientId, envelope.payload);
      return;
    }

    if (!this.handshakenClientIds.has(clientId)) {
      await this.handlePreHelloEnvelope(clientId, envelope);
      return;
    }

    if (envelope.kind === 'command') {
      await this.runtime.receiveCommand(envelope);
      return;
    }

    if (envelope.kind === 'request_snapshot') {
      if (this.resyncRequiredClientIds.has(clientId)) {
        await this.sendReconnectBootstrap(clientId);
        this.resyncRequiredClientIds.delete(clientId);
      } else {
        const snapshot = await this.runtime.getSnapshot(this.options.roomId);
        this.sendToClient(clientId, snapshot);
      }
      return;
    }

    if (envelope.kind === 'ping') {
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
    const hadCompletedHello = this.handshakenClientIds.delete(clientId);
    this.socketsByClientId.delete(clientId);
    await this.runtime.disconnectClient(this.options.roomId, clientId);
    if (!hadCompletedHello) {
      return;
    }

    this.resyncRequiredClientIds.add(clientId);
    await this.emitPresenceEvent('leave', clientId);
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
    for (const [clientId, socket] of this.socketsByClientId.entries()) {
      if (!this.handshakenClientIds.has(clientId)) {
        continue;
      }
      socket.send(encoded);
    }
  }

  /**
   * Handle a client `hello` envelope with strict protocol/core lockstep checks.
   * Mirrors startup compatibility checks from bridge planning over NET flows in
   * `ref/micropolis/src/sim/w_net.c`.
   * Parity note: this handshake is intentionally additive versus C transport.
   */
  private async handleHelloEnvelope(
    clientId: IntegrationClientId,
    payload: BridgeHelloPayload,
  ): Promise<void> {
    if (this.handshakenClientIds.has(clientId)) {
      await this.sendResyncDirective(clientId, 'hello handshake already completed');
      await this.sendProtocolError(
        clientId,
        'hello handshake already completed for this connection',
        'HELLO_ALREADY_COMPLETED',
      );
      return;
    }

    if (!isStrictHelloMatch(payload, this.expectedHelloPayload)) {
      this.resyncRequiredClientIds.add(clientId);
      await this.sendResyncDirective(clientId, 'hello payload mismatch');
      await this.sendProtocolError(
        clientId,
        `hello payload mismatch: expected protocol=${this.expectedHelloPayload.protocolVersion}, core=${this.expectedHelloPayload.coreVersion}`,
        'HELLO_VERSION_MISMATCH',
      );
      return;
    }

    this.handshakenClientIds.add(clientId);
    this.knownClientIds.add(clientId);
    const position = await this.reserveEnvelopePosition();
    this.sendToClient(clientId, {
      kind: 'hello',
      roomId: this.options.roomId,
      clientId,
      tick: position.tick,
      serverSeq: position.serverSeq,
      payload: this.expectedHelloPayload,
    });
    await this.emitPresenceEvent('join', clientId);
    if (this.resyncRequiredClientIds.has(clientId)) {
      await this.sendResyncDirective(clientId, 'reconnect requires snapshot replay');
    }
  }

  /**
   * Route non-hello envelopes received before successful handshake completion.
   * Mirrors command gating intent from `SimCmd` routing in `w_sim.c` while
   * adding bridge-v1 handshake discipline.
   * Parity note: bridge `reject` is used for expected command denial; other
   * pre-hello envelopes map to bridge `error`.
   */
  private async handlePreHelloEnvelope(
    clientId: IntegrationClientId,
    envelope: Exclude<BridgeClientEnvelope<TCommandPayload>, { kind: 'hello' }>,
  ): Promise<void> {
    if (envelope.kind === 'command') {
      await this.sendCommandReject(
        clientId,
        envelope.commandId,
        'client must complete hello handshake before sending commands',
        'HELLO_REQUIRED',
      );
      return;
    }

    await this.sendProtocolError(
      clientId,
      `client must complete hello handshake before ${envelope.kind}`,
      'HELLO_REQUIRED',
    );
  }

  /**
   * Emit a bridge `reject` envelope for expected command-denial outcomes.
   * Mirrors expected command denial semantics from `SimCmd` pathways in
   * `ref/micropolis/src/sim/w_sim.c`, mapped to bridge envelopes.
   * Parity note: this reject is adapter-level pre-runtime gating.
   */
  private async sendCommandReject(
    clientId: IntegrationClientId,
    commandId: string,
    reason: string,
    code: string,
  ): Promise<void> {
    const position = await this.reserveEnvelopePosition();
    this.sendToClient(clientId, {
      kind: 'reject',
      roomId: this.options.roomId,
      tick: position.tick,
      serverSeq: position.serverSeq,
      payload: {
        commandId,
        reason,
        code,
      },
    });
  }

  /**
   * Emit a bridge `error` envelope for unexpected/runtime protocol failures.
   * Mirrors fatal transport fault surfacing intent from `ref/micropolis/src/sim/w_net.c`,
   * while separating expected denials into `reject`.
   * Parity note: this is structured bridge-v1 error metadata, not Tcl stderr.
   */
  private async sendProtocolError(
    clientId: IntegrationClientId,
    message: string,
    code: string,
  ): Promise<void> {
    const position = await this.reserveEnvelopePosition();
    this.sendToClient(clientId, {
      kind: 'error',
      roomId: this.options.roomId,
      tick: position.tick,
      serverSeq: position.serverSeq,
      payload: {
        message,
        code,
      },
    });
  }

  /**
   * Emit a server-initiated `resync` directive to force reconnect/bootstrap.
   * Mirrors authoritative recovery intent from bridge reconnect planning over
   * Micropolis transport flows in `ref/micropolis/spec/integration/SPEC.md`.
   * Parity note: explicit `resync` envelopes are additive bridge-v1 behavior.
   */
  private async sendResyncDirective(clientId: IntegrationClientId, reason: string): Promise<void> {
    const position = await this.reserveEnvelopePosition();
    this.sendToClient(clientId, {
      kind: 'resync',
      roomId: this.options.roomId,
      tick: position.tick,
      serverSeq: position.serverSeq,
      payload: {
        reason,
      },
    });
  }

  /**
   * Emit one room-scoped join/leave presence event for DO client churn.
   * Mirrors buddy appeared/disappeared lifecycle intent in
   * `ref/micropolis/micropolisactivity.py`.
   * Parity note: bridge presence payloads are intentionally room/client based.
   */
  private async emitPresenceEvent(
    kind: DoPresenceEventKind,
    clientId: IntegrationClientId,
  ): Promise<void> {
    if (!this.presenceEnabled) {
      return;
    }
    const position = await this.reserveEnvelopePosition();
    const connectedClientIds = [...this.handshakenClientIds].sort(compareText);
    this.sendToRoom({
      kind: 'presence',
      roomId: this.options.roomId,
      tick: position.tick,
      serverSeq: position.serverSeq,
      payload: this.createPresencePayload({
        kind,
        clientId,
        connectedClientIds,
      }),
    });
  }

  /**
   * Replay reconnect bootstrap events in deterministic order after a resync.
   * Mirrors snapshot-baseline + forward-update recovery intent from
   * `ref/micropolis/spec/integration/SPEC.md`.
   * Parity note: replay-tail sorting and stale/drop filtering are adapter-level
   * hardening over runtime/persistence guarantees.
   */
  private async sendReconnectBootstrap(clientId: IntegrationClientId): Promise<void> {
    const bootstrap = await this.runtime.bootstrapReplay(this.options.roomId, 0);
    this.sendToClient(clientId, bootstrap.snapshot);

    const sortedTail = [...bootstrap.replayTail].sort(compareReplayEventsByServerSeq);
    let priorServerSeq = bootstrap.snapshot.serverSeq;
    let priorTick = bootstrap.snapshot.tick;
    for (const event of sortedTail) {
      assertSameRoomAuthority(this.options.roomId, event.roomId);
      if (event.serverSeq <= priorServerSeq) {
        continue;
      }
      if (event.tick < priorTick) {
        continue;
      }
      priorServerSeq = event.serverSeq;
      priorTick = event.tick;
      this.sendToClient(clientId, event);
    }
  }

  /**
   * Reserve the next tick/sequence pair for one adapter-emitted envelope.
   * Mirrors monotonic outbound sequencing intent from `HandlePacket` stream
   * ordering in `ref/micropolis/src/sim/w_net.c`.
   * Parity note: this intentionally reuses runtime snapshot sequencing instead
   * of introducing a second sequence counter in the adapter.
   */
  private async reserveEnvelopePosition(): Promise<{ tick: number; serverSeq: number }> {
    const snapshot = await this.runtime.getSnapshot(this.options.roomId);
    return {
      tick: snapshot.tick,
      serverSeq: snapshot.serverSeq,
    };
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
  const raw: unknown = JSON.parse(normalizeSocketMessageToText(message));
  return decodeClientEnvelope(raw);
}

/**
 * Decode one unknown client payload into a validated bridge client envelope.
 * Mirrors strict dispatch-shape checks around `SimCmd` packet handling in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: bridge-v1 performs explicit object/field validation before
 * command routing, unlike C's Tcl argv parsing.
 */
export function decodeClientEnvelope<TCommandPayload>(
  payload: unknown,
): BridgeClientEnvelope<TCommandPayload> {
  const envelope = requireObjectRecord(payload, 'client envelope');
  const kind = requireStringField(envelope, 'kind', 'client envelope');
  const roomId = requireStringField(envelope, 'roomId', 'client envelope');
  const clientId = requireStringField(envelope, 'clientId', 'client envelope');

  if (kind === 'hello') {
    const helloPayload = requireObjectRecord(envelope.payload, 'hello payload');
    return {
      kind,
      roomId,
      clientId,
      payload: {
        protocolVersion: requireStringField(helloPayload, 'protocolVersion', 'hello payload'),
        coreVersion: requireStringField(helloPayload, 'coreVersion', 'hello payload'),
      },
    };
  }

  if (kind === 'command') {
    const commandId = requireStringField(envelope, 'commandId', 'command envelope');
    const sentAtMs = requireFiniteNumberField(envelope, 'sentAtMs', 'command envelope');
    if (!hasOwnProperty(envelope, 'payload')) {
      throw new Error('command envelope is missing payload');
    }
    return {
      kind,
      roomId,
      clientId,
      commandId,
      sentAtMs,
      payload: envelope.payload as TCommandPayload,
    };
  }

  if (kind === 'request_snapshot') {
    return {
      kind,
      roomId,
      clientId,
    };
  }

  if (kind === 'ping') {
    const sentAtMs = requireFiniteNumberField(envelope, 'sentAtMs', 'ping envelope');
    return {
      kind,
      roomId,
      clientId,
      sentAtMs,
    };
  }

  throw new Error(`unsupported client envelope kind: ${kind}`);
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

function isStrictHelloMatch(received: BridgeHelloPayload, expected: BridgeHelloPayload): boolean {
  return (
    received.protocolVersion === expected.protocolVersion &&
    received.coreVersion === expected.coreVersion
  );
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

function createDefaultPresencePayload<TPresencePayload>(
  payload: DoPresencePayload,
): TPresencePayload {
  return payload as TPresencePayload;
}

function compareReplayEventsByServerSeq<TPatchPayload, TSnapshotPayload>(
  left: IntegrationPatchTailEvent<TPatchPayload, TSnapshotPayload>,
  right: IntegrationPatchTailEvent<TPatchPayload, TSnapshotPayload>,
): number {
  const byServerSeq = left.serverSeq - right.serverSeq;
  if (byServerSeq !== 0) {
    return byServerSeq;
  }
  return left.tick - right.tick;
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * Enforce that outbound broadcaster envelopes stay inside this room authority.
 * Mirrors single-endpoint authority discipline from `net_listen_socket` in
 * `ref/micropolis/src/sim/w_net.c`.
 * Parity note: explicit room assertions are additive for bridge-v1 routing.
 */
function assertSameRoomAuthority(expectedRoomId: IntegrationRoomId, receivedRoomId: string): void {
  if (receivedRoomId !== expectedRoomId) {
    throw new Error(
      `room authority mismatch: expected ${expectedRoomId}, received ${receivedRoomId}`,
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
