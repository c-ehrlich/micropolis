/**
 * Frozen bridge protocol identifier for Bridge V1 v1 contracts.
 * Mirrors the strict lockstep handshake intent documented in
 * `ref/micropolis/spec/integration/SPEC.md` and the command gateway mindset in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: intentionally different from Micropolis Tcl command strings by
 * using a typed transport-agnostic version token.
 */
export const CORE_BRIDGE_V1_PROTOCOL_VERSION = 'core-bridge/v1' as const;

/**
 * Frozen city payload namespace for v1 gameplay contracts.
 * Mirrors the integration boundary described in
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from C globals by introducing an explicit
 * payload namespace for TypeScript contracts.
 */
export const CORE_BRIDGE_V1_CITY_PAYLOAD_VERSION = 'city/v1' as const;

/**
 * Default authoritative snapshot cadence in ticks.
 * Mirrors the Bridge V1 lock in `/Users/cje/dev/city/MASTER_GAME_ALIGNMENT_PLAN.md`.
 * Parity note: intentionally different from legacy ad-hoc update cadence by
 * making the default interval explicit in the wire contract.
 */
export const CORE_BRIDGE_V1_DEFAULT_SNAPSHOT_CADENCE_TICKS = 64 as const;

/**
 * Deterministic local-mode room identifier.
 * Mirrors local host defaults in `/Users/cje/dev/city/MASTER_GAME_ALIGNMENT_PLAN.md`.
 * Parity note: intentionally different from Micropolis C, which does not expose
 * a room identity concept in `w_sim.c` networking hooks.
 */
export const CORE_BRIDGE_V1_LOCAL_ROOM_ID = 'local-room' as const;

/**
 * Deterministic local-mode client identifier.
 * Mirrors local host defaults in `/Users/cje/dev/city/MASTER_GAME_ALIGNMENT_PLAN.md`.
 * Parity note: intentionally different from Micropolis C, which does not expose
 * a typed client identity in `w_net.c`.
 */
export const CORE_BRIDGE_V1_LOCAL_CLIENT_ID = 'local-client' as const;

/**
 * Canonical v1 client-to-host envelope discriminants.
 * Mirrors inbound command categories in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: intentionally different from Tcl command-line parsing by using a
 * finite discriminated union for transport messages.
 */
export const CORE_BRIDGE_V1_CLIENT_ENVELOPE_KINDS = [
  'hello',
  'command',
  'request_snapshot',
  'ping',
] as const;

/**
 * Canonical v1 host-to-client envelope discriminants.
 * Mirrors outbound integration semantics from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from Micropolis stdout/UDP text payloads
 * by freezing explicit typed envelope kinds.
 */
export const CORE_BRIDGE_V1_SERVER_ENVELOPE_KINDS = [
  'hello',
  'ack',
  'reject',
  'patch',
  'snapshot',
  'resync',
  'presence',
  'error',
] as const;

/**
 * Room identity in v1 bridge envelopes.
 * Mirrors channel scoping intent from `ref/micropolis/src/sim/w_net.c`.
 * Parity note: intentionally different from C socket-level addressing by using a
 * stable string room identifier in every envelope.
 */
export type CoreBridgeRoomIdV1 = string;

/**
 * Client identity in v1 bridge envelopes.
 * Mirrors peer identity needs implied by Sugar/NET integration layers in
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from C integration, where identity is not
 * consistently represented as a required typed field.
 */
export type CoreBridgeClientIdV1 = string;

/**
 * Command idempotency key in v1 command lifecycle envelopes.
 * Mirrors deterministic command handling expectations from
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: intentionally different from C command execution, which does not
 * require an explicit idempotency token.
 */
export type CoreBridgeCommandIdV1 = string;

/**
 * Authoritative simulation tick index.
 * Mirrors simulation progression concepts in `ref/micropolis/src/sim/s_sim.c`.
 * Parity note: 1:1 with the concept of advancing simulation ticks, but exposed
 * as a required transport field.
 */
export type CoreBridgeTickV1 = number;

/**
 * Strictly monotonic server sequence number.
 * Mirrors ordered integration message expectations from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from legacy Micropolis NET hooks, which
 * do not provide a first-class monotonic sequence field.
 */
export type CoreBridgeServerSeqV1 = number;

/**
 * Client-to-host envelope kind discriminant union.
 * Mirrors command ingress categories in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: intentionally different from free-form Tcl commands by freezing
 * closed string literal kinds.
 */
export type CoreBridgeV1ClientEnvelopeKind = (typeof CORE_BRIDGE_V1_CLIENT_ENVELOPE_KINDS)[number];

/**
 * Host-to-client envelope kind discriminant union.
 * Mirrors update/feedback categories in `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from line-oriented legacy outputs by
 * freezing a closed discriminated union.
 */
export type CoreBridgeV1ServerEnvelopeKind = (typeof CORE_BRIDGE_V1_SERVER_ENVELOPE_KINDS)[number];

/**
 * Union of all v1 envelope kind discriminants.
 * Mirrors the full protocol inventory locked in Bridge V1 plans.
 * Parity note: intentionally different from the C integration path by centralizing
 * all envelope names under one typed union.
 */
export type CoreBridgeV1EnvelopeKind =
  | CoreBridgeV1ClientEnvelopeKind
  | CoreBridgeV1ServerEnvelopeKind;

type CoreBridgeV1Extensions = Readonly<Record<string, unknown>>;

interface CoreBridgeV1EnvelopeBase<TKind extends CoreBridgeV1EnvelopeKind> {
  readonly kind: TKind;
  readonly roomId: CoreBridgeRoomIdV1;
  readonly clientId: CoreBridgeClientIdV1;
}

interface CoreBridgeV1SequencedEnvelopeBase<
  TKind extends CoreBridgeV1ServerEnvelopeKind,
> extends CoreBridgeV1EnvelopeBase<TKind> {
  readonly tick: CoreBridgeTickV1;
  readonly serverSeq: CoreBridgeServerSeqV1;
}

/**
 * City build tool identifiers for v1 command payloads.
 * Mirrors major tool paths in `ref/micropolis/src/sim/w_tool.c` (`do_tool` dispatch).
 * Parity note: intentionally different from numeric `tool_state` enums by using
 * named string literals in the wire contract.
 */
export type CityToolV1 =
  | 'road'
  | 'rail'
  | 'wire'
  | 'bulldoze'
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'police_dept'
  | 'fire_dept'
  | 'stadium'
  | 'park'
  | 'seaport'
  | 'airport'
  | 'coal_power'
  | 'nuclear_power'
  | 'query';

/**
 * Simulation speed domain accepted by v1 commands and snapshots.
 * Mirrors `SimCmdSpeed` range checks in `ref/micropolis/src/sim/w_sim.c` (`0..7`).
 * Parity note: 1:1 numeric range parity with C speed constraints.
 */
export type CitySimSpeedV1 = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * Demand projection scalars included in snapshot and patch contracts.
 * Mirrors demand/valve reporting concepts in `ref/micropolis/src/sim/w_update.c`.
 * Parity note: intentionally different from scattered C globals by publishing one
 * stable grouped object in the bridge payload.
 */
export interface CityDemandV1 {
  readonly residential: number;
  readonly commercial: number;
  readonly industrial: number;
}

/**
 * Message feed entry carried by snapshot/patch payloads.
 * Mirrors `sendMes` / `sendMesAt` message stream behavior in
 * `ref/micropolis/src/sim/s_msg.c`.
 * Parity note: intentionally different from legacy numeric-only message channels
 * by exposing richer typed fields for UI clients.
 */
export interface CityMessageV1 {
  readonly messageId: number;
  readonly text: string;
  readonly tick: CoreBridgeTickV1;
}

/**
 * Authoritative map delta entry in v1 `patch` payloads.
 * Mirrors coordinate-addressed map mutations in `ref/micropolis/src/sim/w_con.c`
 * and `ref/micropolis/src/sim/w_tool.c` where tiles are applied as `Map[x][y]`.
 * Parity note: 1:1 coordinate addressing parity with C; intentionally disallows
 * ambiguous linear `index` deltas in the bridge contract.
 */
export interface CityMapDeltaV1 {
  readonly x: number;
  readonly y: number;
  readonly tile: number;
}

/**
 * Computes the canonical v1 snapshot tile index for one map coordinate.
 * Mirrors Micropolis map memory layout setup in `ref/micropolis/src/sim/s_alloc.c`
 * (`Map[i] = base + i * WORLD_Y`) and flat map load/save in
 * `ref/micropolis/src/sim/s_fileio.c` (`&Map[0][0]`, `WORLD_X * WORLD_Y` words).
 * Parity note: 1:1 index formula parity with C contiguous map storage
 * (`x * WORLD_Y + y` in the classic world); explicit truncation keeps TypeScript
 * numeric behavior aligned with C integer arithmetic if non-integer inputs leak in.
 */
export function getCoreBridgeV1SnapshotTileIndex(x: number, y: number, mapHeight: number): number {
  return Math.trunc(x) * Math.trunc(mapHeight) + Math.trunc(y);
}

/**
 * Authoritative map baseline payload carried in v1 `snapshot` payloads.
 * Mirrors contiguous `Map[WORLD_X][WORLD_Y]` storage in
 * `ref/micropolis/src/sim/s_alloc.c` and map serialization in
 * `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: 1:1 with C x-major/column-major map layout. `tiles` uses the
 * frozen linearization formula `index = x * height + y` (classic Micropolis:
 * `index = x * WORLD_Y + y`).
 */
export interface CityMapSnapshotV1 {
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly number[];
}

/**
 * Full concrete v1 command payload union for city gameplay.
 * Mirrors tool and runtime command classes from
 * `ref/micropolis/src/sim/w_tool.c` and `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: intentionally different from Tcl command strings by freezing one
 * typed discriminated union for tools, sim controls, lifecycle, persistence, and scenarios.
 */
export type CityCommandPayloadV1 =
  | {
      readonly type: 'tool_apply';
      readonly tool: CityToolV1;
      readonly x: number;
      readonly y: number;
      readonly dragTo?: Readonly<{
        readonly x: number;
        readonly y: number;
      }>;
      readonly extensions?: CoreBridgeV1Extensions;
    }
  | {
      readonly type: 'sim_pause';
      readonly extensions?: CoreBridgeV1Extensions;
    }
  | {
      readonly type: 'sim_resume';
      readonly extensions?: CoreBridgeV1Extensions;
    }
  | {
      readonly type: 'sim_set_speed';
      readonly speed: CitySimSpeedV1;
      readonly extensions?: CoreBridgeV1Extensions;
    }
  | {
      readonly type: 'city_new';
      readonly cityName: string;
      readonly difficulty: 'easy' | 'medium' | 'hard';
      readonly terrainSeed: number;
      readonly createIsland: boolean;
      readonly extensions?: CoreBridgeV1Extensions;
    }
  | {
      readonly type: 'city_load';
      readonly format: 'cty';
      readonly encoding: 'base64';
      readonly encodedCityData: string;
      readonly extensions?: CoreBridgeV1Extensions;
    }
  | {
      readonly type: 'city_save';
      readonly format: 'cty';
      readonly target: 'download' | 'autosave' | 'slot';
      readonly slotId?: string;
      readonly extensions?: CoreBridgeV1Extensions;
    }
  | {
      readonly type: 'scenario_start';
      readonly scenarioId: number;
      readonly extensions?: CoreBridgeV1Extensions;
    };

/**
 * Concrete v1 patch payload for ordered authoritative deltas.
 * Mirrors incremental world/head updates from `ref/micropolis/src/sim/w_update.c`.
 * Parity note: intentionally different from C callback fan-out by batching all
 * map/hud/message/lifecycle deltas in one typed payload envelope.
 */
export interface CityPatchPayloadV1 {
  readonly mapDeltas: readonly CityMapDeltaV1[];
  readonly hud: Readonly<{
    readonly funds?: number;
    readonly date?: Readonly<{
      readonly year: number;
      readonly month: number;
    }>;
    readonly demand?: CityDemandV1;
    readonly simSpeed?: CitySimSpeedV1;
  }>;
  readonly messageFeed: readonly CityMessageV1[];
  readonly lifecycle: readonly (
    | Readonly<{
        readonly kind: 'sim_paused';
      }>
    | Readonly<{
        readonly kind: 'sim_resumed';
      }>
    | Readonly<{
        readonly kind: 'city_reset';
        readonly cityName: string;
      }>
    | Readonly<{
        readonly kind: 'city_loaded';
        readonly cityName: string;
        readonly source: 'save' | 'scenario';
      }>
    | Readonly<{
        readonly kind: 'scenario_started';
        readonly scenarioId: number;
      }>
    | Readonly<{
        readonly kind: 'city_saved';
        readonly target: 'download' | 'autosave' | 'slot';
        readonly slotId?: string;
      }>
  )[];
  readonly extensions?: CoreBridgeV1Extensions;
}

/**
 * Concrete v1 snapshot payload for reconnect/bootstrap baselines.
 * Mirrors full-state bootstrap intent from `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from C in-memory globals by providing one
 * serializable authoritative projection with replay metadata.
 */
export interface CitySnapshotPayloadV1 {
  readonly map: CityMapSnapshotV1;
  readonly hud: Readonly<{
    readonly funds: number;
    readonly date: Readonly<{
      readonly year: number;
      readonly month: number;
    }>;
    readonly demand: CityDemandV1;
    readonly simSpeed: CitySimSpeedV1;
    readonly messageFeed: readonly CityMessageV1[];
  }>;
  readonly lifecycle: Readonly<{
    readonly mode: 'running' | 'paused';
    readonly cityName: string;
    readonly scenarioId: number | null;
  }>;
  readonly replay: Readonly<{
    readonly snapshotTick: CoreBridgeTickV1;
    readonly appliedServerSeq: CoreBridgeServerSeqV1;
    readonly patchTailStartServerSeq: CoreBridgeServerSeqV1;
  }>;
  readonly extensions?: CoreBridgeV1Extensions;
}

/**
 * Frozen v1 handshake payload shared by client and host `hello` envelopes.
 * Mirrors startup compatibility checks in `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from Micropolis process startup flags by
 * carrying explicit protocol/core versions in-band.
 */
export interface CoreBridgeV1HelloPayload {
  readonly protocolVersion: typeof CORE_BRIDGE_V1_PROTOCOL_VERSION;
  readonly cityPayloadVersion: typeof CORE_BRIDGE_V1_CITY_PAYLOAD_VERSION;
  readonly coreVersion: string;
  readonly snapshotCadenceTicks: number;
  readonly extensions?: CoreBridgeV1Extensions;
}

/**
 * `hello` envelope used during v1 lockstep negotiation.
 * Mirrors pre-command setup/identity intents from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from C startup glue by requiring explicit
 * room/client identity and version payload fields.
 */
export interface CoreBridgeV1HelloEnvelope extends CoreBridgeV1EnvelopeBase<'hello'> {
  readonly payload: CoreBridgeV1HelloPayload;
}

/**
 * `command` envelope carrying typed gameplay intent from client to host.
 * Mirrors command entry points in `ref/micropolis/src/sim/w_sim.c` and tools in
 * `ref/micropolis/src/sim/w_tool.c`.
 * Parity note: intentionally different from command-string evaluation because this
 * envelope freezes typed payload variants and idempotency key requirements.
 */
export interface CoreBridgeV1CommandEnvelope extends CoreBridgeV1EnvelopeBase<'command'> {
  readonly commandId: CoreBridgeCommandIdV1;
  readonly payload: CityCommandPayloadV1;
}

/**
 * `request_snapshot` envelope used for reconnect/resync snapshot pulls.
 * Mirrors reconnect baseline intent in `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from legacy Micropolis by making snapshot
 * replay requests explicit in the protocol.
 */
export interface CoreBridgeV1RequestSnapshotEnvelope extends CoreBridgeV1EnvelopeBase<'request_snapshot'> {
  readonly payload: Readonly<{
    readonly reason: 'reconnect' | 'sequence_gap' | 'manual';
    readonly afterServerSeq?: CoreBridgeServerSeqV1;
    readonly sentAtMs: number;
  }>;
}

/**
 * `ping` envelope for client->host liveness and latency checks.
 * Mirrors optional network liveness behavior implied by `w_net.c`.
 * Parity note: intentionally different from raw UDP packet polling by using an
 * explicit typed ping payload.
 */
export interface CoreBridgeV1PingEnvelope extends CoreBridgeV1EnvelopeBase<'ping'> {
  readonly payload: Readonly<{
    readonly pingId: string;
    readonly sentAtMs: number;
  }>;
}

/**
 * `ack` envelope for successful or idempotent command acceptance.
 * Mirrors command-result feedback expectations from
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: intentionally different from direct in-process command execution
 * by explicitly reporting dedupe state and command type.
 */
export interface CoreBridgeV1AckEnvelope extends CoreBridgeV1SequencedEnvelopeBase<'ack'> {
  readonly commandId: CoreBridgeCommandIdV1;
  readonly payload: Readonly<{
    readonly deduplicated: boolean;
    readonly commandType: CityCommandPayloadV1['type'];
    readonly extensions?: CoreBridgeV1Extensions;
  }>;
}

/**
 * Canonical reject reason codes for expected command denial paths.
 * Mirrors denial semantics around placement/funds/arguments in
 * `ref/micropolis/src/sim/w_tool.c` and `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: intentionally different from C integer return conventions by
 * exposing explicit symbolic reason identifiers.
 */
export type CoreBridgeV1RejectCode =
  | 'invalid_command'
  | 'invalid_placement'
  | 'insufficient_funds'
  | 'out_of_bounds'
  | 'version_mismatch';

/**
 * `reject` envelope for expected command denial outcomes.
 * Mirrors predictable validation/rule rejection pathways in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: intentionally different from C error strings by freezing typed
 * reject code/message/retryability fields.
 */
export interface CoreBridgeV1RejectEnvelope extends CoreBridgeV1SequencedEnvelopeBase<'reject'> {
  readonly commandId: CoreBridgeCommandIdV1;
  readonly payload: Readonly<{
    readonly code: CoreBridgeV1RejectCode;
    readonly message: string;
    readonly retryable: boolean;
    readonly extensions?: CoreBridgeV1Extensions;
  }>;
}

/**
 * `patch` envelope for ordered incremental authoritative updates.
 * Mirrors incremental update flows in `ref/micropolis/src/sim/w_update.c`.
 * Parity note: intentionally different from C UI callback fan-out by bundling
 * deterministic deltas into one transport payload.
 */
export interface CoreBridgeV1PatchEnvelope extends CoreBridgeV1SequencedEnvelopeBase<'patch'> {
  readonly payload: CityPatchPayloadV1;
}

/**
 * `snapshot` envelope carrying full authoritative baseline state.
 * Mirrors reconnect/load baseline expectations in
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from C global state pointers by using a
 * fully serializable snapshot projection.
 */
export interface CoreBridgeV1SnapshotEnvelope extends CoreBridgeV1SequencedEnvelopeBase<'snapshot'> {
  readonly payload: CitySnapshotPayloadV1;
}

/**
 * `resync` envelope directing client recovery when stream continuity is lost.
 * Mirrors gap-recovery intent in `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from Micropolis C, which has no explicit
 * typed resync control envelope.
 */
export interface CoreBridgeV1ResyncEnvelope extends CoreBridgeV1SequencedEnvelopeBase<'resync'> {
  readonly payload: Readonly<{
    readonly reason: 'sequence_gap' | 'manual' | 'server_restart';
    readonly expectedNextServerSeq: CoreBridgeServerSeqV1;
    readonly snapshotRequired: true;
    readonly extensions?: CoreBridgeV1Extensions;
  }>;
}

/**
 * `presence` envelope for room membership change broadcasts.
 * Mirrors Sugar buddy/presence integration intent in
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from Micropolis Sugar bridge Tcl commands
 * by publishing normalized typed client membership fields.
 */
export interface CoreBridgeV1PresenceEnvelope extends CoreBridgeV1SequencedEnvelopeBase<'presence'> {
  readonly payload: Readonly<{
    readonly connectedClientIds: readonly CoreBridgeClientIdV1[];
    readonly joinedClientId?: CoreBridgeClientIdV1;
    readonly leftClientId?: CoreBridgeClientIdV1;
    readonly extensions?: CoreBridgeV1Extensions;
  }>;
}

/**
 * Canonical unexpected fault codes for `error` envelopes.
 * Mirrors transport/runtime failure surfaces in `ref/micropolis/src/sim/w_net.c`.
 * Parity note: intentionally different from raw errno/perror strings by freezing
 * symbolic error categories.
 */
export type CoreBridgeV1ErrorCode = 'internal' | 'transport' | 'timeout' | 'protocol_violation';

/**
 * `error` envelope for unexpected transport/runtime/internal failures.
 * Mirrors unexpected failure paths surfaced by legacy integration layers in
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from C side-effect printing by requiring
 * typed code/message/retryability fields.
 */
export interface CoreBridgeV1ErrorEnvelope extends CoreBridgeV1SequencedEnvelopeBase<'error'> {
  readonly payload: Readonly<{
    readonly code: CoreBridgeV1ErrorCode;
    readonly message: string;
    readonly retryable: boolean;
    readonly extensions?: CoreBridgeV1Extensions;
  }>;
}

/**
 * Union of all canonical client->host v1 envelopes.
 * Mirrors command/control ingress paths in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: intentionally different from free-form command channels by freezing
 * a typed discriminated union.
 */
export type CoreBridgeV1ClientEnvelope =
  | CoreBridgeV1HelloEnvelope
  | CoreBridgeV1CommandEnvelope
  | CoreBridgeV1RequestSnapshotEnvelope
  | CoreBridgeV1PingEnvelope;

/**
 * Union of all canonical host->client v1 envelopes.
 * Mirrors host event categories from `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from heterogeneous C callbacks by freezing
 * one typed union for all authoritative outbound events.
 */
export type CoreBridgeV1ServerEnvelope =
  | CoreBridgeV1HelloEnvelope
  | CoreBridgeV1AckEnvelope
  | CoreBridgeV1RejectEnvelope
  | CoreBridgeV1PatchEnvelope
  | CoreBridgeV1SnapshotEnvelope
  | CoreBridgeV1ResyncEnvelope
  | CoreBridgeV1PresenceEnvelope
  | CoreBridgeV1ErrorEnvelope;

/**
 * Union of every canonical v1 bridge envelope.
 * Mirrors Bridge V1 protocol freeze scope in
 * `/Users/cje/dev/city/MASTER_GAME_ALIGNMENT_PLAN.md`.
 * Parity note: intentionally different from Micropolis C integration by exposing a
 * single strongly-typed envelope root for all transports.
 */
export type CoreBridgeV1Envelope = CoreBridgeV1ClientEnvelope | CoreBridgeV1ServerEnvelope;

/**
 * Sim-Core Authority mocked host envelope contracts.
 * Mirrors command-routing and NET bridge intent in
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_net.c`.
 * Parity note: intentionally coexists with frozen Bridge V1 `CoreBridgeV1*`
 * contracts during the staged bridge port.
 */

/**
 * Shared identity fields attached to bridge envelopes.
 * Mirrors the command-routing context in `ref/micropolis/src/sim/w_sim.c`
 * (`SimCmd`) and NET callback context from `ref/micropolis/src/sim/w_net.c`.
 * Parity note: this is intentionally different from C globals/Tcl state by
 * carrying explicit per-envelope identity fields.
 */
export interface BridgeEnvelopeIdentity {
  roomId: string;
  clientId: string;
}

/**
 * Sequencing fields for authoritative outbound ordering.
 * Mirrors ordered command/result flow assumptions from
 * `ref/micropolis/src/sim/w_sim.c` and packet-drain ordering in
 * `ref/micropolis/src/sim/w_net.c` (`udp_hear`).
 * Parity note: Micropolis does not expose `serverSeq`; this is an intentional
 * bridge contract addition for deterministic replay/resync.
 */
export interface BridgeEnvelopeSequence {
  tick: number;
  serverSeq: number;
}

/**
 * Handshake envelope sent from client to host.
 * Mirrors version exposure intent in `SimCmdVersion` from
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: explicit hello negotiation is intentionally different from C's
 * command-style version query.
 */
export interface ClientHelloEnvelope extends BridgeEnvelopeIdentity {
  kind: 'hello';
  protocolVersion: string;
  coreVersion: string;
}

/**
 * High-level gameplay command envelope sent from client to host.
 * Mirrors `sim` command dispatch entry in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this contract wraps the Tcl command surface into typed message
 * payloads instead of variadic argv parsing.
 */
export interface ClientCommandEnvelope extends BridgeEnvelopeIdentity {
  kind: 'command';
  commandId: string;
  command: CoreCommandPayload;
}

/**
 * Snapshot request envelope sent from client to host.
 * Mirrors recovery intent from C's command-driven host integration in
 * `ref/micropolis/src/sim/w_sim.c` while adding explicit replay metadata.
 * Parity note: there is no 1:1 C command for bridge snapshot replay.
 */
export interface ClientRequestSnapshotEnvelope extends BridgeEnvelopeIdentity {
  kind: 'request_snapshot';
  afterServerSeq?: number;
}

/**
 * Ping envelope sent from client to host.
 * Mirrors liveness expectations from stream/socket integration in
 * `ref/micropolis/src/sim/w_net.c`.
 * Parity note: this message type is intentionally new for bridge transport.
 */
export interface ClientPingEnvelope extends BridgeEnvelopeIdentity {
  kind: 'ping';
  sentAtMs: number;
}

/**
 * Host hello response envelope.
 * Mirrors version compatibility checks around `SimCmdVersion` in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: C does not perform strict hello lockstep as a first-class
 * protocol exchange; this is intentionally different.
 */
export interface HostHelloEnvelope extends BridgeEnvelopeIdentity {
  kind: 'hello';
  protocolVersion: string;
  coreVersion: string;
  accepted: boolean;
  message?: string;
}

/**
 * Successful command acknowledgement envelope.
 * Mirrors successful command completion after dispatch in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: explicit `ack` events are intentionally different from Tcl
 * command return strings in C.
 */
export interface HostAckEnvelope extends BridgeEnvelopeIdentity, BridgeEnvelopeSequence {
  kind: 'ack';
  commandId: string;
}

/**
 * Canonical host reject codes for expected command denials.
 * Mirrors tool return-code branches in `ref/micropolis/src/sim/w_tool.c`
 * (`-1`, `-2`, `-3`) and projects them into stable bridge identifiers.
 * Parity note: string codes are intentionally different from C integer returns
 * so clients can branch deterministically without transport-specific parsing.
 */
export const HOST_REJECT_CODE = {
  TOOL_OUT_OF_BOUNDS: 'tool/out-of-bounds',
  TOOL_NO_FUNDS: 'tool/no-funds',
  TOOL_RULE_REJECT: 'tool/reject',
  TOOL_PENDING_APPROVAL: 'tool/pending-approval',
  MOCK_REJECTED_COMMAND_TYPE: 'mock/rejected-command-type',
} as const;

/**
 * Canonical host reject reason tags for rollback UX.
 * Mirrors expected tool-denial classes in `ref/micropolis/src/sim/w_tool.c`
 * (bounds/funds/pending approval) while exposing typed UI-facing categories.
 * Parity note: these labels are bridge-level metadata, not a 1:1 C enum.
 */
export const HOST_REJECT_REASON = {
  OUT_OF_BOUNDS: 'out-of-bounds',
  INSUFFICIENT_FUNDS: 'insufficient-funds',
  RULES: 'rules',
  PENDING_APPROVAL: 'pending-approval',
  COMMAND_TYPE_REJECTED: 'command-type-rejected',
} as const;

/**
 * Union of canonical host reject code values.
 * Mirrors `HOST_REJECT_CODE` mapping and keeps envelope code branching strict.
 */
export type HostRejectCode = (typeof HOST_REJECT_CODE)[keyof typeof HOST_REJECT_CODE];

/**
 * Union of canonical host reject reason values.
 * Mirrors `HOST_REJECT_REASON` mapping for typed reject semantics.
 */
export type HostRejectReason = (typeof HOST_REJECT_REASON)[keyof typeof HOST_REJECT_REASON];

/**
 * Pending-visual rollback directive carried with expected command denials.
 * Mirrors pending-tool UX intent in `ToolDown`/`DoPendTool` from
 * `ref/micropolis/src/sim/w_tool.c`.
 * Parity note: this explicit payload is intentionally different from C's
 * direct UI callback side effect so host-driven bridge UIs can stay transport
 * agnostic.
 */
export interface HostRejectPendingVisualDirective {
  action: 'rollback';
  commandId: string;
}

/**
 * Structured reject payload for UI rollback and messaging semantics.
 * Mirrors expected command-denial handling from `ref/micropolis/src/sim/w_tool.c`
 * plus bridge-level pending visual coordination.
 */
export interface HostRejectPayload {
  reason: HostRejectReason;
  pendingVisual: HostRejectPendingVisualDirective;
}

/**
 * Expected command denial envelope.
 * Mirrors failure branches from command validation in `w_sim.c` command
 * handlers (argument/range checks returning `TCL_ERROR`).
 * Parity note: reject reason codes and rollback directives are a typed
 * bridge-layer projection.
 */
export interface HostRejectEnvelope extends BridgeEnvelopeIdentity, BridgeEnvelopeSequence {
  kind: 'reject';
  commandId: string;
  code: HostRejectCode;
  message: string;
  reject: HostRejectPayload;
}

/**
 * Incremental authoritative patch envelope.
 * Mirrors per-step state updates driven by simulation command paths in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: patch payload transport is intentionally different from C's
 * in-process memory mutation model.
 */
export interface HostPatchEnvelope extends BridgeEnvelopeIdentity, BridgeEnvelopeSequence {
  kind: 'patch';
  patch: CorePatchPayload;
}

/**
 * Full authoritative snapshot envelope.
 * Mirrors serialized state export intent from runtime command entry points in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: snapshot transport is intentionally different from C, where the
 * host and simulation live in the same process.
 */
export interface HostSnapshotEnvelope extends BridgeEnvelopeIdentity, BridgeEnvelopeSequence {
  kind: 'snapshot';
  snapshot: CoreSnapshotPayload;
}

/**
 * Resync instruction envelope emitted by host.
 * Mirrors reconnect/recovery needs implied by command and NET boundaries in
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_net.c`.
 * Parity note: explicit `resync` messaging is intentionally new.
 */
export interface HostResyncEnvelope extends BridgeEnvelopeIdentity, BridgeEnvelopeSequence {
  kind: 'resync';
  reason: string;
}

/**
 * Presence update envelope emitted by host.
 * Mirrors multiplayer-presence intent exposed through integration hooks in
 * `ref/micropolis/src/sim/w_sim.c` (multiplayer mode toggles).
 * Parity note: this envelope is intentionally bridge-specific.
 */
export interface HostPresenceEnvelope extends BridgeEnvelopeIdentity, BridgeEnvelopeSequence {
  kind: 'presence';
  joinedClientIds: ReadonlyArray<string>;
  leftClientIds: ReadonlyArray<string>;
}

/**
 * Unexpected host/runtime fault envelope.
 * Mirrors fatal/perror error surfaces in `ref/micropolis/src/sim/w_sim.c`
 * and `ref/micropolis/src/sim/w_net.c`.
 * Parity note: this typed envelope intentionally separates unexpected `error`
 * from expected command `reject`.
 */
export interface HostErrorEnvelope extends BridgeEnvelopeIdentity, BridgeEnvelopeSequence {
  kind: 'error';
  code: string;
  message: string;
  commandId?: string;
}

/**
 * Canonical command payload shape for Sim-Core Authority bridge contracts.
 * Mirrors the high-level command intent of `sim` handlers in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this is intentionally not a direct Tcl argv tuple.
 */
export interface CoreCommandPayload {
  type: string;
  payload?: unknown;
}

/**
 * Canonical patch payload shape for Sim-Core Authority bridge contracts.
 * Mirrors incremental simulation update intent from `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: concrete patch field unions are added in later contract tasks.
 */
export interface CorePatchPayload {
  type: string;
  payload?: unknown;
}

/**
 * Canonical snapshot payload shape for Sim-Core Authority bridge contracts.
 * Mirrors baseline state transfer intent from `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: concrete snapshot field schemas are added in later contract tasks.
 */
export interface CoreSnapshotPayload {
  type: string;
  payload?: unknown;
}

/**
 * Union of all client-to-host bridge envelopes.
 * Mirrors typed transport framing over command inputs from
 * `ref/micropolis/src/sim/w_sim.c`.
 */
export type CoreClientEnvelope =
  | ClientHelloEnvelope
  | ClientCommandEnvelope
  | ClientRequestSnapshotEnvelope
  | ClientPingEnvelope;

/**
 * Union of all host-to-client bridge envelopes.
 * Mirrors outbound integration signals derived from
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_net.c`.
 */
export type CoreHostEnvelope =
  | HostHelloEnvelope
  | HostAckEnvelope
  | HostRejectEnvelope
  | HostPatchEnvelope
  | HostSnapshotEnvelope
  | HostResyncEnvelope
  | HostPresenceEnvelope
  | HostErrorEnvelope;

/**
 * Multi-host Compatibility bridge envelope compatibility contracts retained for DO host/runtime work.
 * Mirrors bridge host/message routing behavior from `ref/micropolis/src/sim/w_sim.c` and
 * `ref/micropolis/src/sim/w_net.c` while coexisting with `CoreBridgeV1*` types above.
 */

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
