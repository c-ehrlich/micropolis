import type {
  BridgeClientCommandEnvelope,
  BridgeClientEnvelope,
  BridgeClientId,
  BridgeCommandId,
  BridgeHelloPayload,
  BridgeRoomId,
  BridgeServerEnvelope,
  BridgeServerPatchEnvelope,
  BridgeServerSnapshotEnvelope,
} from '@city/core-bridge';

/**
 * Canonical runtime room identity consumed by `@city/sim-integration`.
 * Mirrors room-authority routing intent from NET command handling in
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_net.c`.
 * Parity note: this is a direct alias to `@city/core-bridge` and not a new
 * protocol definition.
 */
export type IntegrationRoomId = BridgeRoomId;

/**
 * Canonical runtime client identity consumed by `@city/sim-integration`.
 * Mirrors transport peer identity intent from Micropolis NET paths
 * (`ref/micropolis/src/sim/w_sim.c`, `ref/micropolis/src/sim/w_net.c`).
 * Parity note: direct alias to `@city/core-bridge`.
 */
export type IntegrationClientId = BridgeClientId;

/**
 * Canonical runtime command id consumed by `@city/sim-integration`.
 * Mirrors idempotency-key ownership required for authoritative command intake.
 * Parity note: direct alias to `@city/core-bridge`.
 */
export type IntegrationCommandId = BridgeCommandId;

/**
 * Canonical handshake payload for `hello` lockstep checks in integration host
 * orchestration, mapped from Micropolis startup/transport parity references
 * (`ref/micropolis/src/sim/w_sim.c`, `ref/micropolis/src/sim/w_net.c`).
 * Parity note: direct alias to `@city/core-bridge`.
 */
export type IntegrationHelloPayload = BridgeHelloPayload;

/**
 * Canonical inbound envelope contract consumed by integration runtime APIs.
 * Parity note: this is intentionally bridge-owned with no local envelope copy.
 */
export type IntegrationClientEnvelope<TCommandPayload = unknown> =
  BridgeClientEnvelope<TCommandPayload>;

/**
 * Canonical inbound mutating command envelope consumed by integration runtime
 * orchestration.
 * Parity note: direct alias to bridge-owned command envelope shape.
 */
export type IntegrationClientCommandEnvelope<TCommandPayload = unknown> =
  BridgeClientCommandEnvelope<TCommandPayload>;

/**
 * Canonical outbound envelope contract emitted by integration runtime APIs.
 * Parity note: this is intentionally bridge-owned with no local envelope copy.
 */
export type IntegrationServerEnvelope<
  TPatchPayload = unknown,
  TSnapshotPayload = unknown,
  TPresencePayload = unknown,
> = BridgeServerEnvelope<TPatchPayload, TSnapshotPayload, TPresencePayload>;

/**
 * Canonical snapshot envelope returned by integration runtime bootstrap APIs.
 * Parity note: direct alias to bridge-owned snapshot envelope shape.
 */
export type IntegrationServerSnapshotEnvelope<TSnapshotPayload = unknown> =
  BridgeServerSnapshotEnvelope<TSnapshotPayload>;

/**
 * Durable storage contract for authoritative room state used by
 * `@city/sim-integration` orchestration.
 * Mirrors persistence intent around city state lifecycle from
 * `ref/micropolis/src/sim/w_sim.c`, with storage details intentionally adapter-
 * scoped and not 1:1 with C globals/filesystem calls.
 */
export interface IntegrationPersistence {
  load(roomId: IntegrationRoomId): Promise<Uint8Array | null>;
  save(roomId: IntegrationRoomId, blob: Uint8Array): Promise<void>;
}

/**
 * Persisted snapshot checkpoint for reconnect/bootstrap.
 * Mirrors save/load checkpoint intent in `loadFile`/`saveFile` lifecycle
 * handling in `ref/micropolis/src/sim/s_fileio.c` and post-load runtime
 * bootstrap sequencing in `ref/micropolis/src/sim/s_init.c`.
 * Parity note: this is intentionally room-scoped and adapter-driven rather
 * than direct filesystem globals from C.
 */
export interface IntegrationPersistedSnapshot<TSnapshotPayload = unknown> {
  roomId: IntegrationRoomId;
  tick: number;
  serverSeq: number;
  payload: TSnapshotPayload;
}

/**
 * Persisted patch-tail patch event for reconnect replay.
 * Mirrors incremental post-baseline update intent from Micropolis simulation
 * progression (`ref/micropolis/src/sim/s_sim.c`) with bridge envelope shape.
 */
export type IntegrationPatchTailPatchEvent<TPatchPayload = unknown> =
  BridgeServerPatchEnvelope<TPatchPayload>;

/**
 * Persisted patch-tail snapshot event for reconnect replay.
 * Mirrors baseline refresh events in the same authoritative stream used for
 * replay (`ref/micropolis/src/sim/s_sim.c`), represented in bridge envelopes.
 */
export type IntegrationPatchTailSnapshotEvent<TSnapshotPayload = unknown> =
  BridgeServerSnapshotEnvelope<TSnapshotPayload>;

/**
 * Persisted patch-tail event union replayed after snapshot bootstrap.
 * Parity note: TypeScript replay storage is additive versus C, which keeps
 * live runtime buffers and file snapshots instead of explicit tail logs.
 */
export type IntegrationPatchTailEvent<TPatchPayload = unknown, TSnapshotPayload = unknown> =
  | IntegrationPatchTailPatchEvent<TPatchPayload>
  | IntegrationPatchTailSnapshotEvent<TSnapshotPayload>;

/**
 * Persistence adapter contract for snapshot checkpoint + patch-tail replay.
 * Mirrors Micropolis save/load lifecycle intent from `ref/micropolis/src/sim/s_fileio.c`,
 * but intentionally uses explicit room-scoped adapter hooks instead of direct
 * global file operations.
 */
export interface IntegrationSnapshotPatchTailPersistence<
  TPatchPayload = unknown,
  TSnapshotPayload = unknown,
> {
  loadSnapshot(
    roomId: IntegrationRoomId,
  ): Promise<IntegrationPersistedSnapshot<TSnapshotPayload> | null>;
  loadPatchTail(
    roomId: IntegrationRoomId,
    afterServerSeq: number,
  ): Promise<ReadonlyArray<IntegrationPatchTailEvent<TPatchPayload, TSnapshotPayload>>>;
  saveSnapshot(
    roomId: IntegrationRoomId,
    snapshot: IntegrationPersistedSnapshot<TSnapshotPayload>,
  ): Promise<void>;
  appendPatchTail(
    roomId: IntegrationRoomId,
    events: ReadonlyArray<IntegrationPatchTailEvent<TPatchPayload, TSnapshotPayload>>,
  ): Promise<void>;
  truncatePatchTail(roomId: IntegrationRoomId, throughServerSeq: number): Promise<void>;
}

/**
 * Snapshot + patch-tail bootstrap payload returned for reconnect recovery.
 * Mirrors `loadFile` checkpoint + subsequent simulated progression in
 * `ref/micropolis/src/sim/s_fileio.c` and `ref/micropolis/src/sim/s_sim.c`.
 * Parity note: explicit tail replay by `serverSeq` is additive for bridge-v1.
 */
export interface IntegrationReplayBootstrap<TPatchPayload = unknown, TSnapshotPayload = unknown> {
  snapshot: IntegrationServerSnapshotEnvelope<TSnapshotPayload>;
  replayTail: ReadonlyArray<IntegrationPatchTailEvent<TPatchPayload, TSnapshotPayload>>;
}

/**
 * Broadcast abstraction used by `@city/sim-integration` authority runtime.
 * Mirrors transport fanout intent from Micropolis NET integration pathways
 * (`ref/micropolis/src/sim/w_net.c`) while remaining adapter-driven.
 */
export interface IntegrationBroadcaster<
  TPatchPayload = unknown,
  TSnapshotPayload = unknown,
  TPresencePayload = unknown,
> {
  sendToClient(
    clientId: IntegrationClientId,
    event: IntegrationServerEnvelope<TPatchPayload, TSnapshotPayload, TPresencePayload>,
  ): void;
  sendToRoom(
    roomId: IntegrationRoomId,
    event: IntegrationServerEnvelope<TPatchPayload, TSnapshotPayload, TPresencePayload>,
  ): void;
}

/**
 * Transport-agnostic authoritative multiplayer runtime contract for
 * `@city/sim-integration`.
 * Mirrors command intake + ticked authority routing from Micropolis transport
 * entry points (`ref/micropolis/src/sim/w_sim.c`, `ref/micropolis/src/sim/w_net.c`).
 * Parity note: this is intentionally adapter-based and bridge-envelope driven
 * rather than a 1:1 port of Tcl command handler signatures.
 */
export interface IntegrationMultiplayerRuntime<
  TCommandPayload = unknown,
  TPatchPayload = unknown,
  TSnapshotPayload = unknown,
  _TPresencePayload = unknown,
> {
  connectClient(roomId: IntegrationRoomId, clientId: IntegrationClientId): Promise<void>;
  disconnectClient(roomId: IntegrationRoomId, clientId: IntegrationClientId): Promise<void>;
  receiveCommand(command: IntegrationClientCommandEnvelope<TCommandPayload>): Promise<void>;
  tick(nowMs: number): Promise<void>;
  getSnapshot(
    roomId: IntegrationRoomId,
  ): Promise<IntegrationServerSnapshotEnvelope<TSnapshotPayload>>;
  /**
   * Build reconnect bootstrap data by replaying persisted tail events newer
   * than the requested `serverSeq`.
   * Mirrors checkpoint+incremental recovery intent from `loadFile` bootstrap in
   * `ref/micropolis/src/sim/s_fileio.c`, with bridge replay semantics that are
   * intentionally additive versus C.
   */
  bootstrapReplay(
    roomId: IntegrationRoomId,
    afterServerSeq: number,
  ): Promise<IntegrationReplayBootstrap<TPatchPayload, TSnapshotPayload>>;
}

type _AssertExactType<TLeft, TRight> =
  (<TValue>() => TValue extends TLeft ? 1 : 2) extends <TValue>() => TValue extends TRight ? 1 : 2
    ? true
    : never;

// Compile-time contract guards: these fail if local aliases drift from bridge ownership.
type _assertClientEnvelopeBridgeAlias = _AssertExactType<
  IntegrationClientEnvelope,
  BridgeClientEnvelope
>;
type _assertServerEnvelopeBridgeAlias = _AssertExactType<
  IntegrationServerEnvelope,
  BridgeServerEnvelope
>;
