/**
 * Canonical room identity for bridge envelopes.
 * Mirrors room-scoped authority concepts behind NET command routing in
 * `ref/micropolis/src/sim/w_sim.c` and socket handling in
 * `ref/micropolis/src/sim/w_net.c`.
 * Parity note: Micropolis C transport has no explicit room id field; this is
 * an intentional TypeScript contract addition for host/runtime isolation.
 */
export type BridgeRoomId = string;

/**
 * Canonical client identity for bridge envelopes.
 * Mirrors per-peer transport identity intent from Micropolis NET command flow
 * (`ref/micropolis/src/sim/w_sim.c`, `ref/micropolis/src/sim/w_net.c`).
 * Parity note: this is intentionally explicit in TypeScript whereas C wiring
 * used implicit socket/process identity.
 */
export type BridgeClientId = string;

/**
 * Canonical idempotency key for mutating client commands.
 * Mirrors the command de-duplication intent documented for authoritative host
 * migration from Micropolis NET command pathways (`w_sim.c`, `w_net.c`).
 * Parity note: this key is a new bridge contract field and not a 1:1 C field.
 */
export type BridgeCommandId = string;

/**
 * Canonical handshake payload shared by client and host `hello` envelopes.
 * Mirrors strict version-lockstep intent for migration from Tcl/NET startup
 * behavior (`ref/micropolis/src/sim/w_sim.c`, `ref/micropolis/src/sim/w_net.c`).
 * Parity note: Micropolis C startup does not use a structured hello envelope;
 * this is an intentional bridge-v1 contract for local/DO host compatibility.
 */
export interface BridgeHelloPayload {
  protocolVersion: string;
  coreVersion: string;
}

/**
 * Canonical client `hello` envelope.
 * See parity note in `BridgeHelloPayload` for intentional TypeScript shaping.
 */
export interface BridgeClientHelloEnvelope {
  kind: 'hello';
  roomId: BridgeRoomId;
  clientId: BridgeClientId;
  payload: BridgeHelloPayload;
}

/**
 * Canonical mutating command envelope from client to host authority.
 * Mirrors command-dispatch intent from `sim` command handlers in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: payload is generic here so runtime packages can bind concrete
 * command unions while preserving one protocol definition source.
 */
export interface BridgeClientCommandEnvelope<TPayload = unknown> {
  kind: 'command';
  roomId: BridgeRoomId;
  clientId: BridgeClientId;
  commandId: BridgeCommandId;
  sentAtMs: number;
  payload: TPayload;
}

/**
 * Canonical client snapshot-request envelope.
 * Mirrors recovery-oriented snapshot fetch intent for authoritative transport.
 * Parity note: this is additive vs legacy Micropolis flows.
 */
export interface BridgeClientRequestSnapshotEnvelope {
  kind: 'request_snapshot';
  roomId: BridgeRoomId;
  clientId: BridgeClientId;
}

/**
 * Canonical client ping envelope for liveness/latency flows.
 * Parity note: additive versus legacy Micropolis transport commands.
 */
export interface BridgeClientPingEnvelope {
  kind: 'ping';
  roomId: BridgeRoomId;
  clientId: BridgeClientId;
  sentAtMs: number;
}

/**
 * Canonical client-to-host envelope union.
 * Mirrors incoming command/handshake message dispatch entrypoints from
 * `ref/micropolis/src/sim/w_sim.c`, with bridge-v1 additions for snapshot/ping.
 */
export type BridgeClientEnvelope<TCommandPayload = unknown> =
  | BridgeClientHelloEnvelope
  | BridgeClientCommandEnvelope<TCommandPayload>
  | BridgeClientRequestSnapshotEnvelope
  | BridgeClientPingEnvelope;

/**
 * Canonical host `hello` envelope.
 * See parity note in `BridgeHelloPayload` for intentional TypeScript shaping.
 */
export interface BridgeServerHelloEnvelope {
  kind: 'hello';
  roomId: BridgeRoomId;
  clientId: BridgeClientId;
  tick: number;
  serverSeq: number;
  payload: BridgeHelloPayload;
}

/**
 * Canonical host ack envelope for accepted client commands.
 * Mirrors command acknowledgement semantics around `sim` command handling in
 * `ref/micropolis/src/sim/w_sim.c` for bridge-host workflows.
 */
export interface BridgeServerAckEnvelope {
  kind: 'ack';
  roomId: BridgeRoomId;
  tick: number;
  serverSeq: number;
  payload: {
    commandId: BridgeCommandId;
  };
}

/**
 * Canonical host reject envelope for expected rule/validation denials.
 * Parity note: explicit reject payload is additive vs legacy Tcl error routing.
 */
export interface BridgeServerRejectEnvelope {
  kind: 'reject';
  roomId: BridgeRoomId;
  tick: number;
  serverSeq: number;
  payload: {
    commandId: BridgeCommandId;
    reason: string;
    code?: string;
  };
}

/**
 * Canonical host patch envelope for ordered incremental state updates.
 * Mirrors incremental command-triggered updates routed through Micropolis
 * integration callbacks (`ref/micropolis/src/sim/w_sim.c`, `w_net.c`).
 * Parity note: bridge payload is explicit and transport-agnostic.
 */
export interface BridgeServerPatchEnvelope<TPayload = unknown> {
  kind: 'patch';
  roomId: BridgeRoomId;
  tick: number;
  serverSeq: number;
  payload: TPayload;
}

/**
 * Canonical host snapshot envelope for reconnect/bootstrap baselines.
 * Parity note: additive explicit snapshot envelope for bridge-v1.
 */
export interface BridgeServerSnapshotEnvelope<TPayload = unknown> {
  kind: 'snapshot';
  roomId: BridgeRoomId;
  tick: number;
  serverSeq: number;
  payload: TPayload;
}

/**
 * Canonical host resync envelope for forced snapshot recovery flows.
 * Parity note: additive explicit recovery directive in bridge-v1.
 */
export interface BridgeServerResyncEnvelope {
  kind: 'resync';
  roomId: BridgeRoomId;
  tick: number;
  serverSeq: number;
  payload: {
    reason: string;
  };
}

/**
 * Canonical host presence envelope for join/leave updates.
 * Parity note: additive multiplayer-presence channel in bridge-v1.
 */
export interface BridgeServerPresenceEnvelope<TPayload = unknown> {
  kind: 'presence';
  roomId: BridgeRoomId;
  tick: number;
  serverSeq: number;
  payload: TPayload;
}

/**
 * Canonical host error envelope for unexpected runtime/transport failures.
 * Mirrors fatal transport error surfacing intent from legacy integration paths
 * (`ref/micropolis/src/sim/w_sim.c`, `ref/micropolis/src/sim/w_net.c`) while
 * separating expected `reject` outcomes.
 */
export interface BridgeServerErrorEnvelope {
  kind: 'error';
  roomId: BridgeRoomId;
  tick: number;
  serverSeq: number;
  payload: {
    message: string;
    code?: string;
    commandId?: BridgeCommandId;
  };
}

/**
 * Canonical host-to-client envelope union.
 * Mirrors outbound integration event streams from Micropolis NET/Tcl command
 * pathways while standardizing bridge-v1 envelope ownership.
 */
export type BridgeServerEnvelope<
  TPatchPayload = unknown,
  TSnapshotPayload = unknown,
  TPresencePayload = unknown,
> =
  | BridgeServerHelloEnvelope
  | BridgeServerAckEnvelope
  | BridgeServerRejectEnvelope
  | BridgeServerPatchEnvelope<TPatchPayload>
  | BridgeServerSnapshotEnvelope<TSnapshotPayload>
  | BridgeServerResyncEnvelope
  | BridgeServerPresenceEnvelope<TPresencePayload>
  | BridgeServerErrorEnvelope;
