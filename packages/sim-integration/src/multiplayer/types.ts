import type {
  BridgeClientCommandEnvelope,
  BridgeClientEnvelope,
  BridgeClientId,
  BridgeCommandId,
  BridgeHelloPayload,
  BridgeRoomId,
  BridgeServerEnvelope,
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
  _TPatchPayload = unknown,
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
